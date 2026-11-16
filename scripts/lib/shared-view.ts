import type { AgentView, CardGlossary, Decision, DecisionOption, LogEntry, PileView, PlayerView } from "../../src/agent/types";

export const SHARED_VIEW_SCHEMA = "dominion/agent-view@2";

export type SharedLogEntry = { seq: number; type: string; text: string };
export type SharedAction =
  | "play"
  | "buy"
  | "buy-landscape"
  | "spend-coffers"
  | "spend-villager"
  | "pay-debt"
  | "end-phase"
  | "select"
  | "pile"
  | "decline"
  | "yes"
  | "no"
  | "mode"
  | "player"
  | "trigger"
  | "name"
  | "number";

function player({ points, ...rest }: PlayerView) {
  return { ...rest, ...(points !== undefined ? { vp: points } : {}) };
}

function pile({ others, trait, ...rest }: PileView) {
  const members = [...new Set([rest.card, ...(others ?? [])])];
  return { ...rest, ...(members.length > 1 ? { members } : {}), ...(trait ? { traits: [trait] } : {}) };
}

function action(option: DecisionOption, kind: string, view: AgentView): SharedAction {
  if (option.kind === "decline") return /^End (Actions|Buys|Turn)$/i.test(option.label) ? "end-phase" : "decline";
  if (option.kind === "number") return "number";
  if (option.kind === "card-name") return "name";
  if (option.kind === "mode") return "mode";
  if (option.kind === "ability") return "trigger";
  if (option.kind === "accept" && option.label === "Yes") return "yes";
  if (kind === "buy" && option.card) return view.landscapes.some((item) => item.card === option.card) ? "buy-landscape" : "buy";
  if (kind === "play" && option.card) return "play";
  if (kind === "pile") return "pile";
  // Client buttons and card-shaped choices do not always reveal their semantics.
  return "select";
}

const PURPOSES = new Set([
  "discard",
  "trash",
  "gain",
  "top-deck",
  "move",
  "play",
  "set-aside",
  "reveal",
  "reaction",
  "trigger",
  "exile",
  "return",
  "pass",
  "overpay",
  "name"
]);

export function sharedDecision(decision: Decision, view: AgentView) {
  const turn = /(?:ACTION|BUY)_PHASE/.test(decision.questionId);
  const ordered = decision.groups.some((group) => group.order === "bottom-to-top");
  const purpose = turn ? "turn" : PURPOSES.has(decision.kind) ? decision.kind : decision.kind === "choose-mode" ? "mode" : "other";
  const kind = turn
    ? "turn"
    : ordered
      ? "cards"
      : decision.options.every((option) => option.kind === "card-name")
        ? "name"
        : decision.options.every((option) => option.kind === "number")
          ? "number"
          : decision.kind;
  const alternatives = decision.alternatives
    ?.map((set) => set.map((id) => `[${decision.groups.find((group) => group.group === id)?.kind ?? id}]`).join("+"))
    .join(" | ");
  return {
    id: decision.id,
    ...(view.you ? { player: view.you.index } : {}),
    kind,
    purpose,
    prompt: decision.prompt,
    ...(turn && view.turn.phase ? { phase: view.turn.phase } : {}),
    ordered,
    nameAny: false,
    ...(decision.min !== undefined ? { min: decision.min } : {}),
    ...(decision.max !== undefined ? { max: decision.max } : {}),
    groups: decision.groups.map(({ order, ...group }) => ({
      ...group,
      prompt: [
        group.prompt,
        alternatives ? `Answer from ONE of these group sets only: ${alternatives}.` : "",
        order ? "With indices, give the top card first; legacy choose gives the bottom card first." : ""
      ]
        .filter(Boolean)
        .join(" ")
    })),
    options: decision.options.map((option) => {
      const group = decision.groups.find((item) => item.group === option.group);
      const optionAction = action(option, group?.kind ?? "", view);
      const cost = option.cost ?? [...view.supply, ...view.nonSupply, ...view.landscapes].find((item) => item.card === option.card)?.cost;
      return {
        index: option.index,
        group: option.group,
        action: optionAction,
        label: option.label,
        ...(option.card ? { card: option.card } : {}),
        ...(optionAction === "play" ? { zone: "hand" } : {}),
        ...(cost && ["buy", "buy-landscape"].includes(optionAction) ? { cost } : {}),
        ...(option.value !== undefined ? { value: option.value } : {})
      };
    })
  };
}

export function sharedLog(entries: LogEntry[]): SharedLogEntry[] {
  // The browser log is prose; do not invent parsed event kinds or actors.
  return entries.map(({ index, text }) => ({ seq: index, type: "message", text }));
}

export function sharedGlossary(glossary: CardGlossary) {
  return Object.fromEntries(Object.entries(glossary).map(([key, { expansion, ...entry }]) => [key, { ...entry, ...(expansion ? { set: expansion } : {}) }]));
}

/** A conservative projection of the visible tracker snapshot, never raw client state. */
export function sharedView(view: AgentView, log: SharedLogEntry[]) {
  const players = [view.you, ...view.opponents].filter((item): item is PlayerView => item !== null);
  const byName = (name: string | undefined) => {
    const matches = players.filter((item) => item.name === name);
    return matches.length === 1 ? matches[0]!.index : undefined;
  };
  const results = view.game.result?.players.map(({ points, ...result }) => ({ ...result, index: byName(result.name), vp: points }));
  const seat = view.you?.index ?? null;
  const active = byName(view.turn.activePlayer);
  const { phaseSource: _phaseSource, treasureInHand: _treasures, ...turn } = view.turn;
  const landscapeKinds = new Set(["event", "landmark", "project", "way", "ally", "trait", "prophecy", "study"]);
  return {
    schema: SHARED_VIEW_SCHEMA,
    game: {
      ...(view.game.number ? { id: view.game.number } : {}),
      running: view.game.running,
      kingdom: view.supply.filter((item) => item.kingdom).map((item) => item.card),
      landscapes: view.landscapes.map((item) => item.card),
      ...(results?.every((result) => result.index !== undefined) ? { result: { players: results } } : {})
    },
    seat,
    spectating: view.spectating,
    turn: { ...turn, ...(active !== undefined ? { player: active } : {}) },
    you: view.you ? player(view.you) : null,
    opponents: [...view.opponents]
      .sort((a, b) =>
        seat === null ? a.index - b.index : ((a.index - seat + players.length) % players.length) - ((b.index - seat + players.length) % players.length)
      )
      .map(player),
    supply: view.supply.map((item) => ({ ...pile(item), kingdom: item.kingdom })),
    nonSupply: view.nonSupply.map(pile),
    landscapes: view.landscapes.map((item) => ({
      card: item.card,
      kind: item.types.map((type) => type.toLowerCase()).find((type) => landscapeKinds.has(type)) ?? "other",
      types: item.types,
      ...(item.cost ? { cost: item.cost } : {})
    })),
    trash: {
      count: Object.values(view.trash.cards).reduce((sum, count) => sum + count, view.trash.unknown),
      known: view.trash.cards,
      unknown: view.trash.unknown
    },
    decision: view.decision ? sharedDecision(view.decision, view) : null,
    sinceLastDecision: log
  };
}

/** Only the common indices answer uses the shared top-first ordering. */
export function internalIndices(decision: Decision, indices: number[]): number[] {
  const result = [...indices];
  for (const group of decision.groups.filter((item) => item.order === "bottom-to-top")) {
    const positions = indices.flatMap((index, position) =>
      decision.options.find((option) => option.index === index)?.group === group.group ? [position] : []
    );
    const reversed = positions.map((position) => indices[position]!).reverse();
    positions.forEach((position, index) => {
      result[position] = reversed[index]!;
    });
  }
  return result;
}

export function sharedTextView(view: AgentView): AgentView {
  return {
    ...view,
    decision: view.decision
      ? { ...view.decision, groups: view.decision.groups.map((group) => (group.order ? { ...group, order: "top-to-bottom" } : group)) }
      : null
  };
}
