import { Cost, Decision, DecisionGroup, DecisionOption, RawQuestion } from "./types";

/** How to answer one leaf question of the client's question tree. */
export type LeafAnswer =
  | { path: number[]; action: "select"; elements: number[] }
  | { path: number[]; action: "decline" }
  | { path: number[]; action: "number"; value: number }
  | { path: number[]; action: "name"; card: string }
  | { path: number[]; action: "accept" }
  | { path: number[]; action: "keep-order" };

export type AnswerPlan = {
  /** Every leaf is sent together; for more than one, they share a COMPLEX_AND parent. */
  leaves: LeafAnswer[];
};

export type AnswerResolution = { ok: true; plan: AnswerPlan } | { ok: false; error: string };

type Leaf = { question: RawQuestion; group: DecisionGroup };

type OptionTarget =
  | { action: "select"; element: number }
  | { action: "decline" }
  | { action: "number"; value: number }
  | { action: "name"; card: string }
  | { action: "accept" }
  | { action: "keep-order" };

const MAX_NUMBER_OPTIONS = 100;

function kebab(value: string): string {
  return value.toLowerCase().replace(/_/g, "-");
}

function leavesOf(question: RawQuestion): RawQuestion[] {
  if (question.questionClass !== "complex") return [question];
  return (question.subquestions ?? []).flatMap(leavesOf);
}

function nodeAt(root: RawQuestion, path: number[]): RawQuestion | undefined {
  let node: RawQuestion | undefined = root;
  for (const step of path.slice(root.path.length)) node = node?.subquestions?.[step];
  return node;
}

type LeafOption = { option: Omit<DecisionOption, "index" | "group">; target: OptionTarget };

function costKey(cost: Cost | undefined): number[] {
  return cost ? [cost.coins, cost.potions ?? 0, cost.debt ?? 0] : [Infinity, 0, 0];
}

function compareCards(a: LeafOption, b: LeafOption): number {
  const [left, right] = [costKey(a.option.cost), costKey(b.option.cost)];
  const byCost = left.findIndex((value, index) => value !== right[index]);
  return byCost >= 0 ? left[byCost]! - right[byCost]! : a.option.label.localeCompare(b.option.label);
}

/**
 * Card options by cost, then name, in the slots cards held, so the same cards
 * list alike from one decision to the next whatever order the client sends.
 */
function sortCards(options: LeafOption[]): LeafOption[] {
  const cards = options.filter((item) => item.option.kind === "card").sort(compareCards);
  let next = 0;
  return options.map((item) => (item.option.kind === "card" ? cards[next++]! : item));
}

/** Options for one leaf, with the action each option maps to. */
function leafOptions(question: RawQuestion): LeafOption[] {
  const options: LeafOption[] = [];
  switch (question.questionClass) {
    case "choice": {
      const elements = (question.elements ?? []).map(
        (element, index): LeafOption => ({
          option: {
            kind: element.kind,
            label: element.label,
            ...(element.card ? { card: element.card } : {}),
            ...(element.cost ? { cost: element.cost } : {})
          },
          target: { action: "select", element: index }
        })
      );
      // An order's "keep the current order" refers to the client's order, so it stays.
      options.push(...(question.type === "ORDER_CARDS" ? elements : sortCards(elements)));
      if (question.type === "ORDER_CARDS") {
        options.push({ option: { kind: "keep-order", label: "Keep the current order" }, target: { action: "keep-order" } });
      }
      break;
    }
    case "number": {
      const min = question.min ?? 0;
      const max = Math.min(question.max ?? min, min + MAX_NUMBER_OPTIONS - 1);
      for (let value = min; value <= max; value += 1) {
        options.push({ option: { kind: "number", label: String(value), value }, target: { action: "number", value } });
      }
      break;
    }
    case "name":
      for (const card of question.nameChoices ?? []) {
        options.push({ option: { kind: "card-name", label: card, card }, target: { action: "name", card } });
      }
      break;
    case "delayed":
      options.push({ option: { kind: "accept", label: question.acceptLabel ?? "Yes" }, target: { action: "accept" } });
      break;
    case "complex":
      break;
  }
  if (question.declineLabel) {
    options.push({ option: { kind: "decline", label: question.declineLabel }, target: { action: "decline" } });
  }
  return options;
}

function selectionBounds(question: RawQuestion): { min: number; max: number } {
  if (question.questionClass !== "choice") return { min: 1, max: 1 };
  const count = question.elements?.length ?? 0;
  // An order names every card once; the client reads the answer as bottom to top.
  if (question.type === "ORDER_CARDS") return { min: count, max: count };
  return { min: Math.min(question.min ?? 0, count), max: Math.min(question.max ?? 1, count) };
}

type Indexed = {
  decision: Decision;
  leaves: Leaf[];
  targets: Array<{ leaf: number; target: OptionTarget }>;
};

function index(root: RawQuestion, id: string): Indexed {
  const groups: DecisionGroup[] = [];
  const options: DecisionOption[] = [];
  const leaves: Leaf[] = [];
  const targets: Indexed["targets"] = [];

  for (const question of leavesOf(root)) {
    const leafOpts = leafOptions(question);
    if (leafOpts.length === 0) continue;
    const group: DecisionGroup = {
      group: groups.length,
      kind: kebab(question.type),
      prompt: question.prompt,
      ...selectionBounds(question),
      ...(question.type === "ORDER_CARDS" ? { order: "bottom-to-top" as const } : {})
    };
    groups.push(group);
    leaves.push({ question, group });
    for (const { option, target } of leafOpts) {
      options.push({ index: options.length, group: group.group, ...option });
      targets.push({ leaf: leaves.length - 1, target });
    }
  }

  const single = groups.length === 1 ? groups[0] : undefined;
  const branches = new Map<number, number[]>();
  if (root.type === "COMPLEX_OR") {
    for (const { question, group } of leaves) {
      const branch = question.path[root.path.length]!;
      branches.set(branch, [...(branches.get(branch) ?? []), group.group]);
    }
  }
  return {
    decision: {
      id,
      prompt: root.prompt,
      questionId: root.questionId,
      kind: single ? single.kind : kebab(root.type),
      ...(single ? { min: single.min, max: single.max } : {}),
      groups,
      ...(branches.size > 1 ? { alternatives: [...branches.values()] } : {}),
      options
    },
    leaves,
    targets
  };
}

export function buildDecision(root: RawQuestion, id: string): Decision {
  return index(root, id).decision;
}

/** The COMPLEX_AND node that can bundle answers to all `paths`, if there is one. */
function sharedAndAncestor(root: RawQuestion, paths: number[][]): RawQuestion | undefined {
  const [first, ...rest] = paths;
  if (!first) return undefined;
  let prefix = first.length;
  for (const path of rest) {
    let common = 0;
    while (common < prefix && common < path.length && path[common] === first[common]) common += 1;
    prefix = common;
  }
  const ancestor = nodeAt(root, first.slice(0, prefix));
  if (ancestor?.type !== "COMPLEX_AND") return undefined;
  for (const path of paths) {
    for (let depth = prefix + 1; depth < path.length; depth += 1) {
      if (nodeAt(root, path.slice(0, depth))?.type === "COMPLEX_OR") return undefined;
    }
  }
  return ancestor;
}

/**
 * Turns option indices into a plan for the client's question objects. An empty
 * list selects nothing, which is only allowed for a single group with min 0.
 */
export function resolveAnswer(root: RawQuestion, id: string, indices: number[]): AnswerResolution {
  const { decision, leaves, targets } = index(root, id);
  if (!Array.isArray(indices) || indices.some((value) => !Number.isInteger(value))) {
    return { ok: false, error: "indices must be an array of integers" };
  }
  if (new Set(indices).size !== indices.length) return { ok: false, error: "indices must not repeat" };
  const outOfRange = indices.find((value) => value < 0 || value >= decision.options.length);
  if (outOfRange !== undefined) {
    return { ok: false, error: `option ${outOfRange} does not exist (decision has ${decision.options.length} options)` };
  }

  if (indices.length === 0) {
    const onlyLeaf = leaves.length === 1 ? leaves[0] : undefined;
    if (!onlyLeaf || onlyLeaf.group.min > 0 || onlyLeaf.question.questionClass !== "choice") {
      return { ok: false, error: "an empty answer is only allowed for a single optional selection; pick an option (or the decline option)" };
    }
    return { ok: true, plan: { leaves: [{ path: onlyLeaf.question.path, action: "select", elements: [] }] } };
  }

  const chosen = indices.map((value) => targets[value]!);
  const exclusive = chosen.find((item) => item.target.action !== "select");
  if (exclusive) {
    if (chosen.length > 1) return { ok: false, error: `option "${decision.options[indices[0]!]!.label}" must be chosen on its own` };
    const path = leaves[exclusive.leaf]!.question.path;
    const target = exclusive.target;
    switch (target.action) {
      case "decline":
        return { ok: true, plan: { leaves: [{ path, action: "decline" }] } };
      case "number":
        return { ok: true, plan: { leaves: [{ path, action: "number", value: target.value }] } };
      case "name":
        return { ok: true, plan: { leaves: [{ path, action: "name", card: target.card }] } };
      case "accept":
        return { ok: true, plan: { leaves: [{ path, action: "accept" }] } };
      case "keep-order":
        return { ok: true, plan: { leaves: [{ path, action: "keep-order" }] } };
      case "select":
        break;
    }
  }

  const byLeaf = new Map<number, number[]>();
  for (const item of chosen) {
    if (item.target.action !== "select") continue;
    byLeaf.set(item.leaf, [...(byLeaf.get(item.leaf) ?? []), item.target.element]);
  }

  if (byLeaf.size > 1) {
    const paths = [...byLeaf.keys()].map((leaf) => leaves[leaf]!.question.path);
    const ancestor = sharedAndAncestor(root, paths);
    if (!ancestor) return { ok: false, error: "options from different groups cannot be combined in this decision" };
    const missing = leaves.find(
      (leaf, leafIndex) =>
        !byLeaf.has(leafIndex) && leaf.group.min > 0 && leaf.question.path.slice(0, ancestor.path.length).join(".") === ancestor.path.join(".")
    );
    if (missing) return { ok: false, error: `group ${missing.group.group} (${missing.group.prompt}) needs at least ${missing.group.min} option(s)` };
  }

  const plan: LeafAnswer[] = [];
  for (const [leafIndex, elements] of byLeaf) {
    const leaf = leaves[leafIndex]!;
    if (elements.length < leaf.group.min || elements.length > leaf.group.max) {
      const bounds = leaf.group.min === leaf.group.max ? `exactly ${leaf.group.min}` : `${leaf.group.min}-${leaf.group.max}`;
      return { ok: false, error: `group ${leaf.group.group} (${leaf.group.prompt}) takes ${bounds} option(s), got ${elements.length}` };
    }
    plan.push({ path: leaf.question.path, action: "select", elements });
  }
  return { ok: true, plan: { leaves: plan } };
}
