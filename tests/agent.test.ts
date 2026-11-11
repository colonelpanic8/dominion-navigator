import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentView } from "../src/agent/agent-view";
import { buildDecision, resolveAnswer } from "../src/agent/decisions";
import { buildCardGlossary, normalizeCardText, viewCardNames } from "../src/agent/glossary";
import { resolveKingdomNames, splitPiles } from "../src/agent/split-piles";
import { renderAgentViewText } from "../src/agent/render-text";
import { completedTurns } from "../src/agent/turn-summary";
import { RawQuestion, ZoneView } from "../src/agent/types";
import { neutralZoneKind } from "../src/probe/zone-kind";
import cardData from "../data/dominion-card-shaped-objects.json" with { type: "json" };
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
  const silverElement = root.subquestions![0]!.elements!.findIndex((element) => element.card === "Silver");
  const endBuys = optionIndex(live, "buy", "End Buys");
  const autoplay = optionIndex(live, "button", "Autoplay Treasures");
  const treasure = live.decision!.options.find((option) => live.decision!.groups[option.group]!.kind === "play")!.index;

  assert.deepEqual(resolveAnswer(root, item.decisionId, [buySilver]), {
    ok: true,
    plan: { leaves: [{ path: [0], action: "select", elements: [silverElement] }] }
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

test("hand cards list by cost, then name, whatever order the client sends them in", () => {
  const card = (name: string, coins: number) => ({ kind: "card" as const, label: name, card: name, cost: { coins } });
  const hand = [card("Gold", 6), card("Curse", 0), card("Silver", 3), card("Copper", 0)];
  const prompt = (elements: NonNullable<RawQuestion["elements"]>): RawQuestion => ({
    questionClass: "choice",
    type: "TRASH",
    questionId: "CRUCIBLE",
    prompt: "Trash a card",
    path: [],
    min: 1,
    max: 1,
    declineLabel: "Trash nothing",
    elements
  });
  const shuffled = [hand[2]!, hand[0]!, hand[3]!, hand[1]!];
  for (const elements of [hand, shuffled]) {
    const root = prompt(elements);
    const decision = buildDecision(root, "d60");
    assert.deepEqual(
      decision.options.map((option) => option.label),
      ["Copper", "Curse", "Silver", "Gold", "Trash nothing"]
    );
    for (const option of decision.options.slice(0, 4)) {
      const plan = resolveAnswer(root, "d60", [option.index]);
      assert.ok(plan.ok);
      const [leaf] = plan.plan.leaves;
      assert.equal(leaf?.action === "select" && elements[leaf.elements[0]!]!.card, option.card);
    }
  }
  const text = renderAgentViewText({ ...view(fixture("REMODEL_TRASH")), decision: buildDecision(prompt(shuffled), "d60") });
  assert.match(text, /^ {4}2: Silver \$3$/m);
  assert.match(text, /^ {4}4: Trash nothing \(decline\)$/m);
});

test("the groups of an OR question are shown as alternatives", () => {
  // The shape of a live Wayfarer gain: either group answers it.
  const root: RawQuestion = {
    questionClass: "complex",
    type: "COMPLEX_OR",
    questionId: "WAYFARER",
    prompt: "Gain a Silver",
    path: [],
    subquestions: [
      { questionClass: "choice", type: "GAIN", questionId: "WAYFARER", prompt: "Gain a Silver", path: [0], min: 1, max: 1, declineLabel: "Don't Gain", elements: [{ kind: "card", label: "Silver", card: "Silver" }] },
      { questionClass: "choice", type: "CHOOSE_MODE", questionId: "WAYFARER", prompt: "Choose", path: [1], min: 1, max: 1, elements: [{ kind: "mode", label: "Gain Silver" }] }
    ]
  };
  const decision = buildDecision(root, "d70");
  assert.deepEqual(decision.alternatives, [[0], [1]]);
  const text = renderAgentViewText({ ...view(fixture("REMODEL_GAIN")), decision });
  assert.match(text, /^DECISION d70: Gain a Silver\n {2}answer from ONE of these, never mixing them: \[gain\] \| \[choose-mode\]\n {2}\[gain\]/m);
  assert.match(errorOf(resolveAnswer(root, "d70", [0, 2])), /different groups/);

  const buyPhase = view(fixture("GAME_BUY_PHASE", ["buy", "play", "button"])).decision!;
  assert.deepEqual(buyPhase.alternatives, [[0], [1], [2]]);
  const andRoot: RawQuestion = { ...root, type: "COMPLEX_AND" };
  assert.equal(buildDecision(andRoot, "d71").alternatives, undefined);
  const nested: RawQuestion = { ...root, subquestions: [{ ...andRoot, path: [0], subquestions: root.subquestions!.map((sub, index) => ({ ...sub, path: [0, index] })) }, { ...root.subquestions![1]!, path: [1] }] };
  const together = buildDecision(nested, "d72");
  assert.deepEqual(together.alternatives, [[0, 1], [2]]);
  assert.match(renderAgentViewText({ ...view(fixture("REMODEL_GAIN")), decision: together }), /never mixing them: \[gain\]\+\[choose-mode\] \| \[choose-mode\]$/m);
});

test("alternatives follow a nested OR, so a buy is never offered alongside treasures", () => {
  // The shape of a live buy phase with an Ally whose ability may be resolved instead.
  const choice = (type: string, path: number[]): RawQuestion => ({
    questionClass: "choice",
    type,
    questionId: "GAME_BUY_PHASE",
    prompt: type,
    path,
    min: 0,
    max: 1,
    elements: [{ kind: "card", label: "Copper", card: "Copper" }]
  });
  const complex = (type: string, path: number[], subquestions: RawQuestion[]): RawQuestion => ({
    questionClass: "complex",
    type,
    questionId: "GAME_BUY_PHASE",
    prompt: "You may buy cards",
    path,
    subquestions
  });
  const root = complex("COMPLEX_OR", [], [
    complex("COMPLEX_OR", [0], [choice("BUY", [0, 0]), complex("COMPLEX_AND", [0, 1], [choice("PLAY", [0, 1, 0]), choice("WAY", [0, 1, 1])]), choice("BUTTON", [0, 2])]),
    complex("COMPLEX_AND", [1], [choice("RESOLVE_ABILITY", [1, 0]), choice("WAY", [1, 1])])
  ]);
  const decision = buildDecision(root, "d2");
  assert.deepEqual(decision.alternatives, [[0], [1, 2], [3], [4, 5]]);
  assert.match(errorOf(resolveAnswer(root, "d2", [0, 1])), /different groups/);
  assert.equal(resolveAnswer(root, "d2", [1, 2]).ok, true);
});

test("a split pile names the cards under its top card", () => {
  const piles = splitPiles(cardData.cardShapedObjects);
  assert.deepEqual(piles.get("Tent"), ["Garrison", "Hill Fort", "Stronghold", "Tent"]);
  assert.deepEqual(piles.get("Rocks"), ["Catapult", "Rocks"]);
  assert.equal(piles.get("Sir Martin")?.length, 10);
  assert.equal(piles.get("Village"), undefined);

  const live = view(fixture("REMODEL_GAIN"));
  const forts = { card: "Tent", count: 16, cost: { coins: 3 }, types: ["Action", "Fort"], kingdom: true, others: ["Garrison", "Hill Fort", "Stronghold"] };
  const withForts = { ...live, supply: [...live.supply, forts] };
  assert.match(renderAgentViewText(withForts), /Tent \$3 x16 \(pile also holds Garrison, Hill Fort, Stronghold\)/);
  for (const card of ["Tent", "Garrison", "Hill Fort", "Stronghold"]) assert.ok(viewCardNames(withForts).has(card), card);
});

test("a kingdom names a split or paired pile by its randomizer, whichever of its names is given", () => {
  const resolve = (...names: string[]) => resolveKingdomNames(names, cardData.cardShapedObjects);
  assert.deepEqual(resolve("forts", "Tent", "Garrison", "Fort Pile"), { cards: ["Fort Pile"], unknown: [] });
  assert.deepEqual(resolve("Knights", "Sir Martin", "Castles", "Humble Castle", "Augurs", "Clashes", "Odysseys", "Townsfolk", "Wizards").cards, [
    "Knights",
    "Castles",
    "Augur Pile",
    "Clash Pile",
    "Odyssey Pile",
    "Townsfolk Pile",
    "Wizard Pile"
  ]);
  assert.deepEqual(resolve("Plunder", "Rocks", "Witch", "Borrow").cards, ["Encampment", "Catapult", "Witch", "Borrow"]);
  assert.deepEqual(resolve("Witch", "Wotch"), { cards: ["Witch"], unknown: ["Wotch"] });
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
  assert.match(text, /^ {2}owns 11 cards: 7 Copper, 2 Estate, Remodel, Silver$/m);
  const hidden = { ...live, you: { ...live.you!, owned: { known: { Copper: 7 }, unknown: 4 } } };
  assert.match(renderAgentViewText(hidden), /^ {2}owns 11 cards: 7 Copper; 4 unknown$/m);
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

test("landscapes and non-supply piles stay out of the supply", () => {
  // The classes each zone was an instance of in a live game with expansions.
  const kind = (...classes: string[]) => neutralZoneKind((className) => classes.includes(className));
  assert.equal(kind("SupplyZone"), "supply");
  assert.equal(kind("SupplyZone", "SupplyCardZone"), "supply");
  assert.equal(kind("SupplyZone", "SingleLandscapeZone"), "landscape");
  assert.equal(kind("SupplyZone", "NonSupplyZone"), "non-supply");
  assert.equal(kind("TrashZone"), "trash");
});

test("an opponent's finished turns are summarized from the log", () => {
  const lines = [
    "Bot plays a Silver. (+$2)",
    "Turn 6 - me",
    "me plays a Witch.",
    "Bot gains a Curse.",
    "Turn 6 - Bot",
    "Bot plays a Market.",
    "Bot draws a card.",
    "me reveals a Moat. (+$1)",
    "Bot plays 3 Coppers and a Gold. (+$6)",
    "Bot buys and gains a Gold.",
    "Bot buys Sea Trade.",
    "Bot gains 2 Silvers.",
    "Bot draws 5 cards.",
    "Turn 7 - me",
    "me plays 5 Coppers. (+$5)",
    "Turn 7 - Bot",
    "Bot plays 2 Coppers. (+$2)"
  ];
  assert.deepEqual(completedTurns(lines, ["Bot"]), [{ turn: 6, player: "Bot", coins: 6, bought: ["Gold", "Sea Trade"], gained: ["2 Silvers"] }]);
  assert.match(renderAgentViewText(view(fixtures.find((item) => item.source.endsWith("#8"))!)), /^OPPONENT TURNS\n {2}turn 3 Lord Rattington: made \$5, bought Silver$/m);
});

function errorOf(result: { ok: boolean; error?: string }): string {
  assert.equal(result.ok, false);
  return result.error ?? "";
}
