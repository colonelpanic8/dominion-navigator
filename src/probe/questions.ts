import { buildDecision, LeafAnswer, resolveAnswer } from "../agent/decisions";
import { Decision, RawQuestion, RawQuestionElement } from "../agent/types";
import { dominion, enumKey, isRuntimeInstance, RuntimeGame, RuntimeQuestion, RuntimeZone } from "./runtime-types";

export type OpenDecision = {
  question: RuntimeQuestion;
  raw: RawQuestion;
  decision: Decision;
};

export type AnswerResult = { ok: true; decisionId: string } | { ok: false; error: string };

const decisionIds = new WeakMap<RuntimeQuestion, string>();
let decisionSerial = 0;

function decisionId(question: RuntimeQuestion): string {
  let id = decisionIds.get(question);
  if (!id) {
    decisionSerial += 1;
    id = `d${decisionSerial}`;
    decisionIds.set(question, id);
  }
  return id;
}

function questionClass(question: RuntimeQuestion): RawQuestion["questionClass"] | undefined {
  if (isRuntimeInstance(question, "ComplexQuestion")) return "complex";
  if (isRuntimeInstance(question, "ChoiceQuestion")) return "choice";
  if (isRuntimeInstance(question, "NumberQuestion")) return "number";
  if (isRuntimeInstance(question, "NameQuestion")) return "name";
  if (isRuntimeInstance(question, "DelayedQuestion")) return "delayed";
  return undefined;
}

function text(parts: Array<{ text?: string }>): string {
  return parts
    .map((part) => part.text ?? "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** "GAME_PLAY_ALL_TREASURES" -> "Play all treasures". */
function humanizeQuestionId(questionId: string): string {
  const words = questionId.replace(/^GAME_/, "").toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function parser(game: RuntimeGame) {
  const Parser = dominion.LogLineParser;
  return Parser && game.state ? new Parser(game.state, game.state.players, true) : undefined;
}

function cardNameOf(game: RuntimeGame, cardId: unknown): string | undefined {
  return typeof cardId === "number" ? game.state?.cards?.[cardId]?.cardName?.name : undefined;
}

function zoneLabel(zone: RuntimeZone | undefined): string {
  if (!zone) return "zone";
  const owner = zone.owner && (zone.owner.index ?? -1) >= 0 ? `${zone.owner.name ?? "player"}'s ` : "";
  return `${owner}${zone.pileName?.name ?? zone.zoneName ?? "zone"}`;
}

function readElement(game: RuntimeGame, content: unknown, element: unknown): RawQuestionElement {
  const language = dominion.LANGUAGE;
  if (isRuntimeInstance(content, "QuestionCardElements")) {
    const card = cardNameOf(game, element);
    return card ? { kind: "card", label: card, card } : { kind: "other", label: "Unknown card" };
  }
  if (isRuntimeInstance(content, "QuestionBuyableCardElements") || isRuntimeInstance(content, "QuestionCardWithExplanationElements")) {
    const card = cardNameOf(game, (element as { id?: unknown } | null)?.id);
    return card ? { kind: "card", label: card, card } : { kind: "other", label: "Unknown card" };
  }
  if (isRuntimeInstance(content, "QuestionGameButtonElements")) {
    return { kind: "button", label: language?.getGameButton?.[String(element)] ?? String(element) };
  }
  if (isRuntimeInstance(content, "QuestionCardModeElements")) {
    return { kind: "mode", label: language?.getCardMode?.[String(element)] ?? String(element) };
  }
  if (isRuntimeInstance(content, "QuestionCardNameElements")) {
    const card = (element as { name?: string } | null)?.name;
    return card ? { kind: "card-name", label: card, card } : { kind: "other", label: String(element) };
  }
  if (isRuntimeInstance(content, "QuestionAbilityElements")) {
    try {
      return { kind: "ability", label: text(parser(game)?.parseStory(element) ?? []) || "ability" };
    } catch {
      return { kind: "ability", label: "ability" };
    }
  }
  if (isRuntimeInstance(content, "QuestionZoneElements")) {
    return { kind: "zone", label: zoneLabel(typeof element === "number" ? game.state?.zones?.[element] : undefined) };
  }
  return { kind: "other", label: String(element) };
}

function supplyCardNames(game: RuntimeGame): string[] {
  const names = new Set<string>();
  for (const zone of game.state?.zones ?? []) {
    if (!zone || !isRuntimeInstance(zone, "SupplyZone")) continue;
    for (const stack of zone.cardStacks ?? []) {
      const name = stack?.topCard?.cardName?.name;
      if (name) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function readQuestion(game: RuntimeGame, question: RuntimeQuestion, path: number[]): RawQuestion {
  const questionClassName = questionClass(question) ?? "choice";
  const declineId = question.declineButtonId ?? -1;
  const declineEnum = declineId > -1 && dominion.DeclineButtonIds ? dominion.getByOrdinal?.(dominion.DeclineButtonIds, declineId) : undefined;
  const declineLabel = declineEnum ? dominion.LANGUAGE?.getDeclineButtonText?.[String(declineEnum)] : undefined;
  let prompt = "";
  try {
    prompt = text(parser(game)?.parseStory(question.story) ?? []);
  } catch {
    // Fall back to the question id below.
  }
  const questionId = enumKey(dominion.QuestionIds, question.story?.questionId) ?? "UNKNOWN";
  const raw: RawQuestion = {
    questionClass: questionClassName,
    type: enumKey(dominion.QuestionTypes, question.type) ?? "UNKNOWN",
    questionId,
    prompt: prompt && prompt !== questionId ? prompt : humanizeQuestionId(questionId),
    path,
    ...(question.min !== undefined ? { min: question.min } : {}),
    ...(question.max !== undefined ? { max: question.max } : {}),
    ...(declineLabel ? { declineLabel } : {})
  };

  switch (questionClassName) {
    case "complex":
      raw.subquestions = (question.subquestions ?? []).map((sub, index) => readQuestion(game, sub, [...path, index]));
      break;
    case "choice":
      raw.elements = (question.content?.elements ?? []).map((element) => readElement(game, question.content, element));
      break;
    case "delayed": {
      const cardName = typeof question.association === "number" ? game.state?.cards?.[question.association]?.cardName : undefined;
      raw.acceptLabel = (cardName && dominion.LANGUAGE?.getDelayedQuestionButton?.[String(cardName)]) || "Yes";
      break;
    }
    case "name":
      raw.nameChoices = supplyCardNames(game);
      break;
    case "number":
      break;
  }
  return raw;
}

export function openDecisions(game: RuntimeGame): OpenDecision[] {
  return (game.questionModel?.openQuestions ?? []).map((question) => {
    const raw = readQuestion(game, question, []);
    return { question, raw, decision: buildDecision(raw, decisionId(question)) };
  });
}

/** Raw question data for debugging and fixtures. */
export function readOpenQuestions(game: RuntimeGame): RawQuestion[] {
  return openDecisions(game).map((open) => open.raw);
}

function nodeAt(root: RuntimeQuestion, path: number[]): RuntimeQuestion | undefined {
  let node: RuntimeQuestion | undefined = root;
  for (const step of path) node = node?.subquestions?.[step];
  return node;
}

function cardNameOrdinal(card: string): number | undefined {
  const cardName = Object.values(dominion.CardNames ?? {}).find((value) => value?.name === card);
  return cardName && dominion.getOrdinal && dominion.CardNames ? dominion.getOrdinal(dominion.CardNames, cardName) : undefined;
}

function execute(root: RuntimeQuestion, leaves: LeafAnswer[]): void {
  const nodes = leaves.map((leaf) => {
    const node = nodeAt(root, leaf.path);
    if (!node) throw new Error(`question path ${leaf.path.join(".")} no longer exists`);
    return { leaf, node };
  });

  const [first] = nodes;
  if (!first) return;
  const { leaf, node } = first;
  switch (leaf.action) {
    case "select":
      for (const item of nodes) {
        if (item.leaf.action === "select") item.node.accumulatedAnswers = [...item.leaf.elements];
      }
      node.send?.();
      return;
    case "decline":
      if (node.answerDecline) {
        node.answerDecline();
      } else {
        node.accumulatedAnswers = [];
        node.send?.();
      }
      return;
    case "number":
      node.answer?.(leaf.value);
      return;
    case "name": {
      const ordinal = cardNameOrdinal(leaf.card);
      if (ordinal === undefined) throw new Error(`unknown card name ${leaf.card}`);
      node.answer?.(ordinal);
      return;
    }
    case "accept":
      node.answer?.(1);
      return;
    case "keep-order":
      node.send?.();
      return;
  }
}

/** Answers an open decision with option indices, refusing stale or illegal answers. */
export function answerDecision(game: RuntimeGame, decisionIdToAnswer: string, indices: number[]): AnswerResult {
  if (!game.playerModel?.playerMe) return { ok: false, error: "spectating: this account is not a player in this game" };
  const open = openDecisions(game);
  const target = open.find((item) => item.decision.id === decisionIdToAnswer);
  if (!target) {
    const current = open.map((item) => item.decision.id).join(", ") || "none";
    return { ok: false, error: `decision ${decisionIdToAnswer} is not open (open decisions: ${current})` };
  }
  const resolution = resolveAnswer(target.raw, decisionIdToAnswer, indices);
  if (!resolution.ok) return resolution;
  try {
    execute(target.question, resolution.plan.leaves);
  } catch (error) {
    return { ok: false, error: `the client rejected the answer: ${String(error)}` };
  }
  return { ok: true, decisionId: decisionIdToAnswer };
}
