import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentView } from "../src/agent/agent-view";
import { buildDecision, resolveAnswer } from "../src/agent/decisions";
import { buildCardGlossary, normalizeCardText } from "../src/agent/glossary";
import { renderAgentViewText } from "../src/agent/render-text";
import { RawQuestion, ZoneView } from "../src/agent/types";
import type { CardCounter, KnowledgeSummary } from "../src/knowledge";
import { fixture, fixtures, optionIndex, view } from "./live-fixtures";

test("the pure projection reproduces every view the live bridge returned", () => {
  for (const item of fixtures) assert.deepEqual(view(item), item.liveView, item.source);
});

test("buy-phase answers stay within one branch of the client's OR question", () => {
  const item = fixture("GAME_BUY_PHASE", ["buy", "play", "button"]);
  const live = view(item);
  const root = item.rawQuestions[0]!;
  const buySilver = optionIndex(live, "buy", "Silver");
  const endBuys = optionIndex(live, "buy", "End Buys");
  const autoplay = optionIndex(live, "button", "Autoplay Treasures");
  const treasure = live.decision!.options.find((option) => live.decision!.groups[option.group]!.kind === "play")!.index;

  assert.deepEqual(resolveAnswer(root, item.decisionId, [buySilver]), {
    ok: true,
    plan: { leaves: [{ path: [0], action: "select", elements: [live.decision!.options[buySilver]!.index] }] }
  });
  assert.deepEqual(resolveAnswer(root, item.decisionId, [endBuys]), { ok: true, plan: { leaves: [{ path: [0], action: "decline" }] } });
  assert.deepEqual(resolveAnswer(root, item.decisionId, [autoplay]), { ok: true, plan: { leaves: [{ path: [2], action: "select", elements: [0] }] } });
  assert.equal(resolveAnswer(root, item.decisionId, [treasure]).ok, true);

  assert.match(errorOf(resolveAnswer(root, item.decisionId, [buySilver, treasure])), /different groups/);
  assert.match(errorOf(resolveAnswer(root, item.decisionId, [endBuys, buySilver])), /on its own/);
  assert.match(errorOf(resolveAnswer(root, item.decisionId, [])), /empty answer/);
  assert.match(errorOf(resolveAnswer(root, item.decisionId, [live.decision!.options.length])), /does not exist/);
});

test("exact-count prompts enforce the client's min and max", () => {
  const item = fixture("REMODEL_TRASH");
  const decision = buildDecision(item.rawQuestions[0]!, item.decisionId);
  assert.equal(decision.kind, "trash");
  assert.deepEqual([decision.min, decision.max], [1, 1]);
  assert.match(errorOf(resolveAnswer(item.rawQuestions[0]!, item.decisionId, [])), /empty answer/);
  if (decision.options.length > 1) {
    assert.match(errorOf(resolveAnswer(item.rawQuestions[0]!, item.decisionId, [0, 1])), /exactly 1/);
  }
  assert.equal(resolveAnswer(item.rawQuestions[0]!, item.decisionId, [0]).ok, true);
});

test("an ordering prompt takes every card once, bottom first, or keeps the client's order", () => {
  // The shape of a live Sentry prompt with a Copper and a Silver left on the deck.
  const root: RawQuestion = {
    questionClass: "choice",
    type: "ORDER_CARDS",
    questionId: "SENTRY_TOPDECK",
    prompt: "Topdeck in any order",
    path: [],
    min: 2,
    max: 2,
    elements: [
      { kind: "card", label: "Copper", card: "Copper" },
      { kind: "card", label: "Silver", card: "Silver" }
    ]
  };
  const decision = buildDecision(root, "d24");
  assert.deepEqual(decision.groups, [{ group: 0, kind: "order-cards", prompt: "Topdeck in any order", min: 2, max: 2, order: "bottom-to-top" }]);
  assert.deepEqual(
    decision.options.map((option) => option.label),
    ["Copper", "Silver", "Keep the current order"]
  );

  assert.deepEqual(resolveAnswer(root, "d24", [1, 0]), { ok: true, plan: { leaves: [{ path: [], action: "select", elements: [1, 0] }] } });
  assert.deepEqual(resolveAnswer(root, "d24", [2]), { ok: true, plan: { leaves: [{ path: [], action: "keep-order" }] } });
  assert.match(errorOf(resolveAnswer(root, "d24", [1])), /exactly 2/);
  assert.match(errorOf(resolveAnswer(root, "d24", [0, 2])), /on its own/);
  assert.match(renderAgentViewText({ ...view(fixture("REMODEL_GAIN")), decision }), /choose all 2 in order, bottom card first and top card last/);
});

function knowledgeZone(knowledge: KnowledgeSummary, playerIndex: number, zoneName: string): ZoneView {
  const zones = knowledge.players.find((player) => player.player.index === playerIndex)?.zones.filter((zone) => zone.zoneName === zoneName) ?? [];
  const known: CardCounter = {};
  for (const zone of zones) for (const [card, count] of Object.entries(zone.knownCards)) known[card] = (known[card] ?? 0) + count;
  return {
    count: zones.reduce((total, zone) => total + zone.totalCount, 0),
    known: Object.fromEntries(Object.entries(known).sort(([a], [b]) => a.localeCompare(b))),
    unknown: zones.reduce((total, zone) => total + zone.unknownCount + zone.ambiguousCount, 0)
  };
}

test("opponent zones only show identities the knowledge model knows", () => {
  for (const item of fixtures) {
    for (const opponent of view(item).opponents) {
      for (const [field, zoneName] of [["hand", "HandZone"], ["deck", "DrawZone"], ["discard", "DiscardZone"]] as const) {
        const { orderKnown: _orderKnown, ...zone } = { orderKnown: false, ...opponent[field] };
        assert.deepEqual(zone, knowledgeZone(item.knowledge, opponent.index, zoneName), `${item.source} ${opponent.name} ${field}`);
      }
    }
  }

  // Location candidates are possibilities, not knowledge: they must never become known cards.
  const item = fixtures.at(-1)!;
  const opponentIndex = view(item).opponents[0]!.index;
  const knowledge: KnowledgeSummary = structuredClone(item.knowledge);
  const opponent = knowledge.players.find((player) => player.player.index === opponentIndex)!;
  for (const zone of opponent.zones) {
    if (zone.zoneName !== "HandZone") continue;
    zone.unknownCount += Object.values(zone.knownCards).reduce((total, count) => total + count, 0);
    zone.knownCards = {};
  }
  opponent.ambiguousLocationGroups = [];
  opponent.locationCandidateGroups = [
    { zoneKeys: ["x"], zoneNames: ["HandZone"], knownCards: { "Secret Card": 2 }, totalCount: 2, outsideCount: 0 }
  ];
  const leaked = buildAgentView({ table: item.table, knowledge, decision: null, sinceLastDecision: [] }).opponents[0]!;
  assert.deepEqual(leaked.hand.known, {});
  assert.deepEqual(leaked.uncertain, [{ zones: ["hand"], count: 2, candidates: { "Secret Card": 2 }, outside: 0 }]);
});

test("a spectating account gets no seat and no decision", () => {
  const item = fixture("GAME_BUY_PHASE", ["buy"]);
  const { playerMeIndex: _playerMeIndex, ...table } = item.table;
  const spectated = buildAgentView({ table, knowledge: item.knowledge, decision: buildDecision(item.rawQuestions[0]!, item.decisionId), sinceLastDecision: [] });
  assert.equal(spectated.spectating, true);
  assert.equal(spectated.you, null);
  assert.equal(spectated.decision, null);
  assert.equal(spectated.opponents.length, item.table.players.length);
});

test("the text rendering lists the decision's options by index", () => {
  const live = view(fixture("REMODEL_GAIN"));
  const text = renderAgentViewText(live);
  assert.match(text, /^GAME \d+: turn \d+, your turn/);
  assert.match(text, new RegExp(`DECISION ${live.decision!.id}: `));
  for (const option of live.decision!.options) assert.ok(text.includes(`    ${option.index}: ${option.label}`), option.label);
  assert.doesNotMatch(text, /(Coffers|Villagers|VP Tokens|Debt|Favors) 0/);
});

test("card text markup is normalized for the glossary", () => {
  assert.equal(normalizeCardText("|+[2]|////Each other player discards//down to 3 cards in hand."), "+$2\nEach other player discards down to 3 cards in hand.");
  assert.equal(normalizeCardText("Worth {1} per 10 cards you//have (round down)."), "Worth 1 VP per 10 cards you have (round down).");
  assert.deepEqual(
    buildCardGlossary([{ name: "Witch", text: "|+2 Cards|////Each other player gains a Curse.", types: ["Action", "Attack"], expansion: "Base" }], ["Witch"], {
      Witch: { coins: 5 }
    }),
    { Witch: { name: "Witch", types: ["Action", "Attack"], expansion: "Base", cost: { coins: 5 }, text: "+2 Cards\nEach other player gains a Curse." } }
  );
});

function errorOf(result: { ok: boolean; error?: string }): string {
  assert.equal(result.ok, false);
  return result.error ?? "";
}
