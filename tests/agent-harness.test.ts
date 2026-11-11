import assert from "node:assert/strict";
import test from "node:test";
import { createDominionTools } from "../scripts/lib/dominion-tools";
import type { Tool } from "../scripts/lib/mcp-stdio";
import { inspectPath, inspectValue } from "../src/agent/inspect";
import { renderAgentViewDelta, renderAgentViewText, renderGameOverText } from "../src/agent/render-text";
import { extraTurnKind, tableNotes } from "../src/agent/table-notes";
import type { AgentView, SessionState } from "../src/agent/types";
import { fixtures } from "./live-fixtures";

const [startGame, firstBuy, secondBuy] = fixtures.map((item) => item.liveView) as [AgentView, AgentView, AgentView];
const cardData = [{ name: "Remodel", text: "Trash a card from your hand.", types: ["Action"], expansion: "Base" }];

/**
 * A page whose decisions are the queued views, recording the answers it is sent.
 * Its log grows by each view's lines as that view becomes the open decision.
 */
function fakeClient(views: AgentView[], opponentsAreBots = true) {
  const answers: Array<[string, number[]]> = [];
  const session: SessionState = { screen: "game", user: "me", game: { over: false, opponentsAreBots } };
  const log = views[0]!.sinceLastDecision.map((text, index) => ({ index, depth: 0, text }));
  const call = async (method: string, params: unknown[]): Promise<unknown> => {
    switch (method) {
      case "getSession":
        return session;
      case "getAgentView":
        return views[0];
      case "waitForDecision":
        return { status: "decision", view: views[0], knowledgeLag: 0 };
      case "getLog": {
        const { afterIndex = -1, limit } = params[0] as { afterIndex?: number; limit: number };
        return { entries: log.filter((entry) => entry.index > afterIndex).slice(-limit), lastIndex: log.length - 1 };
      }
      case "answer":
        answers.push(params as [string, number[]]);
        if (params[0] !== views[0]!.decision!.id) return { ok: false, error: `decision ${String(params[0])} is not open` };
        views.shift();
        for (const text of views[0]?.sinceLastDecision ?? []) log.push({ index: log.length, depth: 0, text });
        return { ok: true, decisionId: params[0] };
      default:
        throw new Error(`unexpected call ${method}`);
    }
  };
  return { answers, client: { call } as Parameters<typeof createDominionTools>[0] };
}

const live = new AbortController().signal;

function tool(tools: Tool[], name: string): Tool {
  const found = tools.find((item) => item.name === name);
  assert.ok(found, name);
  return found;
}

test("a delta repeats the status and decision but only the parts of the table that changed", () => {
  const next: AgentView = {
    ...firstBuy,
    supply: firstBuy.supply.map((pile) => (pile.card === "Silver" ? { ...pile, count: pile.count - 1 } : pile)),
    nonSupply: []
  };
  const previous: AgentView = { ...firstBuy, nonSupply: [{ card: "Spoils", count: 15, types: ["Treasure"] }] };
  const delta = renderAgentViewDelta(previous, next);

  assert.match(delta, /^GAME \d+: turn/);
  assert.match(delta, /^SUPPLY \(changed\) Silver \$3 x39$/m);
  assert.match(delta, /^NON-SUPPLY \(changed\) Spoils gone$/m);
  assert.match(delta, new RegExp(`^DECISION ${firstBuy.decision!.id}: `, "m"));
  assert.doesNotMatch(delta, /^(YOU|OPPONENT|TRASH)/m);

  const otherGame = { ...next, game: { ...next.game, number: "1" } };
  assert.equal(renderAgentViewDelta(previous, otherGame), renderAgentViewText(otherGame));
});

test("step answers forced decisions itself and then reports only what changed", async () => {
  const { answers, client } = fakeClient([startGame, firstBuy, secondBuy]);
  const tools = createDominionTools(client, cardData);

  const first = await tool(tools, "wait").run({}, live);
  assert.deepEqual(answers, [[startGame.decision!.id, [0]]]);
  assert.match(first, new RegExp(`^AUTO ${startGame.decision!.id}: .* -> Start Game$`, "m"));
  for (const line of startGame.sinceLastDecision) assert.ok(first.includes(line), line);
  assert.match(first, /^YOU: /m);
  assert.match(first, /^ {2}Remodel \(\$4, Action\): Trash a card from your hand\.$/m);

  const buy = firstBuy.decision!.options.find((option) => option.label === "Silver")!.index;
  const second = await tool(tools, "step").run({ decision: firstBuy.decision!.id, choose: [buy] }, live);
  assert.deepEqual(answers.at(-1), [firstBuy.decision!.id, [buy]]);
  assert.ok(second.startsWith(`CHOSE ${firstBuy.decision!.id}: [buy] Silver\n`), second.split("\n")[0]);
  assert.match(second, new RegExp(`^DECISION ${secondBuy.decision!.id}: `, "m"));
  assert.doesNotMatch(second, /^CARDS$/m);
  assert.ok(second.length < renderAgentViewText(secondBuy).length);
});

test("state summarizes a finished game instead of printing its table", async () => {
  const result = { players: [{ name: "colonelpanic8", rank: 1, points: 30, turns: 18, resigned: false }, { name: "Lord Rattington", rank: 2, points: 24, turns: 18, resigned: false }] };
  const over: AgentView = { ...secondBuy, game: { ...secondBuy.game, running: false, result }, decision: null };
  const { client } = fakeClient([over]);
  const text = await tool(createDominionTools(client, cardData), "state").run({}, live);
  assert.match(text, /^GAME \d+ \(over\)$/m);
  assert.match(text, /^RESULT 1\. colonelpanic8 30 VP in 18 turns, 2\. Lord Rattington 24 VP in 18 turns$/m);
  assert.match(text, /^YOU: colonelpanic8 \(\d+ VP\) owns \d+ cards: /m);
  assert.match(text, /^OPPONENT: Lord Rattington \(\d+ VP\) owns \d+ cards: /m);
  assert.match(text, /Call new_game/);
  assert.doesNotMatch(text, /^( {2}hand |SUPPLY |LOG$)/m);
});

test("step refuses a stale decision and shows the one that is open", async () => {
  const { client } = fakeClient([firstBuy]);
  const tools = createDominionTools(client, cardData);
  await assert.rejects(tool(tools, "step").run({ decision: "d999", choose: [0] }, live), (error: Error) => {
    assert.match(error.message, /^Answer rejected: decision d999 is not open/);
    assert.match(error.message, new RegExp(`^DECISION ${firstBuy.decision!.id}: `, "m"));
    return true;
  });
  await assert.rejects(tool(tools, "step").run({ decision: "d2", choose: ["Silver"] }, live), /choose must be an array of numbers/);
});

test("step does not act against human opponents unless that is allowed", async () => {
  const guarded = fakeClient([firstBuy], false);
  await assert.rejects(tool(createDominionTools(guarded.client, cardData), "step").run({ decision: firstBuy.decision!.id, choose: [] }, live), /human opponents/);
  assert.deepEqual(guarded.answers, []);

  const allowed = fakeClient([firstBuy, secondBuy], false);
  const buy = firstBuy.decision!.options.find((option) => option.label === "Silver")!.index;
  await tool(createDominionTools(allowed.client, cardData, { allowHumanOpponents: true }), "step").run({ decision: firstBuy.decision!.id, choose: [buy] }, live);
  assert.equal(allowed.answers.length, 1);
});

test("inspect bounds cyclic client objects and follows paths through maps", () => {
  const copper = { name: "Copper", isTreasure: () => true };
  const state: Record<string, unknown> = { cards: [{ id: 0, cardName: copper }], costs: new Map([[copper, { coin: 0 }]]), node: { nodeType: 1, nodeName: "DIV" } };
  state.self = state;

  assert.deepEqual(inspectValue(state, { depth: 2 }), {
    cards: [{ id: 0, cardName: "(Copper)" }],
    costs: { $map: [["(Copper)", { coin: 0 }]] },
    node: "<div>",
    self: "[circular]"
  });
  assert.deepEqual(inspectPath({ game: () => state }, "game.costs.Copper"), { ok: true, path: "game.costs.Copper", value: { coin: 0 } });
  assert.deepEqual(inspectPath({ game: () => state }, "game.cards.3.cardName"), { ok: false, error: "game.cards.3 is undefined" });
  assert.match((inspectPath({ game: () => state }, "nope") as { error: string }).error, /roots are game/);
});

test("table notes give a pile's counters to the pile and a player's to the player", () => {
  const ann = { index: 0, name: "Ann" };
  const nobody = { index: -1 };
  const temple = { pileName: { name: "Temple" } };
  const state = {
    players: [ann],
    counters: [
      { counterName: { name: "VP Tokens" }, owner: nobody, value: 1, associatedPile: temple, associatedCard: null },
      { counterName: { name: "Debt Tokens" }, owner: ann, value: 2, associatedPile: temple, associatedCard: null }
    ]
  };
  assert.deepEqual(tableNotes(state), ["The Temple pile has 1 VP token.", "Ann has 2 Debt tokens on the Temple pile."]);
});

test("table notes report expansion state the view has no field for, and nothing in a plain game", () => {
  const players = [
    { index: 0, name: "Ann", boughtProjects: [{ name: "Cathedral" }], activeReminders: [{ cardName: { name: "Bridge" } }] },
    { index: 1, name: "Bob" }
  ];
  const nobody = { index: -1 };
  const nowhere = { pileName: { name: "Back" } };
  const village = { pileName: { name: "Village" } };
  const plain = {
    players: [{ index: 0, name: "Ann" }, players[1]!],
    zones: [nowhere, village],
    activeTurn: { ownerId: 0, controllerId: 0, turnType: 0 },
    tokens: [],
    counters: [
      { counterName: { name: "Coffers" }, owner: players[0]!, value: 2, associatedPile: nowhere, associatedCard: null },
      { counterName: { name: "Embargo Tokens" }, owner: nobody, value: 0, associatedPile: village, associatedCard: null }
    ]
  };
  assert.deepEqual(tableNotes(plain), []);

  const busy = {
    ...plain,
    players,
    zones: [nowhere, village],
    activeTurn: { ownerId: 0, controllerId: 1, turnType: 2 },
    tokens: [{ tokenName: { name: "+Action token" }, owner: players[1]!, zone: village, isFlipped: false }],
    counters: [
      ...plain.counters,
      { counterName: { name: "Embargo Tokens" }, owner: nobody, value: 1, associatedPile: village, associatedCard: null },
      { counterName: { name: "VP Tokens" }, owner: nobody, value: 3, associatedPile: nowhere, associatedCard: { cardName: { name: "Temple" } } }
    ]
  };
  assert.deepEqual(tableNotes(busy), [
    "Bob controls this turn.",
    "Bob's +Action token is on Village.",
    "The Village pile has 1 Embargo token.",
    "The Temple pile has 3 VP tokens.",
    "Ann has bought Cathedral.",
    "Ann has reminders for Bridge (a reminder is a card whose effect is still pending for that player)."
  ]);
});

test("table notes name landscape piles by their card and say when a token is on no pile", () => {
  const ann = { index: 0, name: "Ann" };
  const nobody = { index: -1 };
  const battlefield = { pileName: { name: "Back" }, cardStacks: [{ topCard: { cardName: { name: "Battlefield" } } }] };
  const setAside = { zoneName: "SetAsideZone", pileName: { name: "Back" }, cardStacks: [{ topCard: { cardName: { name: "Village" } } }] };
  const tavern = { zoneName: "TavernZone", owner: ann };
  const state = {
    players: [ann],
    tokens: [
      { tokenName: { name: "-Card token" }, owner: ann, zone: setAside },
      { tokenName: { name: "Journey token" }, owner: nobody, zone: setAside, isFlipped: true },
      { tokenName: { name: "Estate token" }, owner: ann, zone: tavern }
    ],
    counters: [{ counterName: { name: "VP Tokens" }, owner: nobody, value: 12, associatedPile: battlefield, associatedCard: null }]
  };
  assert.deepEqual(tableNotes(state, new Set([battlefield])), [
    "Ann has their -Card token, not on a pile.",
    "Journey token (face down) is not on a pile.",
    "Ann's Estate token is on their Tavern mat.",
    "Battlefield has 12 VP tokens."
  ]);
});

test("wait shows a forced decision without answering it in a game against people", async () => {
  const { answers, client } = fakeClient([startGame, firstBuy], false);
  const shownView = await tool(createDominionTools(client, cardData), "wait").run({}, live);
  assert.deepEqual(answers, []);
  assert.match(shownView, new RegExp(`^DECISION ${startGame.decision!.id}: `, "m"));
  assert.match(shownView, /human opponents/);
});

test("a view is only a delta base once it was delivered, and log lines are shown once", async () => {
  const { client } = fakeClient([firstBuy]);
  const tools = createDominionTools(client, cardData);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(tool(tools, "wait").run({}, cancelled.signal));

  const first = await tool(tools, "wait").run({}, live);
  assert.match(first, /^YOU: /m);
  assert.match(first, /^LOG$/m);

  const again = await tool(tools, "wait").run({}, live);
  assert.doesNotMatch(again, /^(YOU: |LOG$)/m);
  assert.match(again, new RegExp(`^DECISION ${firstBuy.decision!.id}: `, "m"));
});

test("a delta says when the notes no longer apply", () => {
  const noted: AgentView = { ...firstBuy, notes: ["This is an extra turn (outpost)."] };
  assert.match(renderAgentViewDelta(firstBuy, noted), /^ALSO\n {2}This is an extra turn \(outpost\)\.$/m);
  assert.match(renderAgentViewDelta(noted, firstBuy), /^ALSO \(none of the earlier notes apply any more\)$/m);
});

test("inspect stops expanding a widely shared graph", () => {
  const leaf = { values: Array.from({ length: 50 }, (_, index) => ({ index })) };
  const wide = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`key${index}`, { leaf, again: { leaf } }]));
  const dump = JSON.stringify(inspectValue(wide, { depth: 6, maxEntries: 200 }));
  assert.ok(dump.length < 200_000, `dump is ${dump.length} characters`);
  assert.match(dump, /"key199":/);
});

test("the status totals played and unplayed money and the score is always printed", () => {
  const view: AgentView = { ...firstBuy, turn: { ...firstBuy.turn, coins: 2, treasureInHand: { coins: 5, potions: 0, variable: ["Bank"] } } };
  const text = renderAgentViewText(view);
  assert.match(text, /^GAME .*, coins 2, \$7 available \(\$2 played \+ \$5 in unplayed treasures\), plus unplayed Bank \(value or effect: see card\)$/m);
  assert.match(text, new RegExp(`^SCORE you ${firstBuy.you!.points}, ${firstBuy.opponents[0]!.name} ${firstBuy.opponents[0]!.points}; Province 8 left$`, "m"));
  assert.match(renderAgentViewDelta(view, view), /^SCORE /m);
  const silver = firstBuy.decision!.options.find((option) => option.label === "Silver" && firstBuy.decision!.groups[option.group]!.kind === "buy")!;
  assert.match(text, new RegExp(`^ {4}${silver.index}: Silver \\$3$`, "m"));
});

test("a buy with more than one Buy points at Autoplay Treasures", () => {
  const autoplay = firstBuy.decision!.options.find((option) => option.label === "Autoplay Treasures")!;
  const note = new RegExp(`^ {2}NOTE buying a card plays only the treasures that card needs .* With 2 buys, choose ${autoplay.index} \\(Autoplay Treasures\\) first\\.$`, "m");
  assert.match(renderAgentViewText({ ...firstBuy, turn: { ...firstBuy.turn, buys: 2 } }), note);
  assert.doesNotMatch(renderAgentViewText(firstBuy), /^ {2}NOTE /m);
  const played = { ...firstBuy.decision!, options: firstBuy.decision!.options.filter((option) => option !== autoplay) };
  assert.doesNotMatch(renderAgentViewText({ ...firstBuy, turn: { ...firstBuy.turn, buys: 2 }, decision: played }), /^ {2}NOTE /m);
});

test("a buy list labels Events and Projects and warns that buying one ends treasure play", () => {
  const decision = firstBuy.decision!;
  const buyGroup = decision.groups.find((group) => group.kind === "buy")!.group;
  const borrow = { index: decision.options.length, group: buyGroup, kind: "card" as const, label: "Borrow", card: "Borrow" };
  const view: AgentView = {
    ...firstBuy,
    landscapes: [{ card: "Borrow", count: 1, cost: { coins: 0 }, types: ["Event"] }],
    turn: { ...firstBuy.turn, treasureInHand: { coins: 3, potions: 0, variable: [] } },
    decision: { ...decision, options: [...decision.options, borrow] }
  };
  const text = renderAgentViewText(view);
  assert.match(text, new RegExp(`^ {4}${borrow.index}: Borrow \\$0 \\[Event\\]$`, "m"));
  const autoplay = decision.options.find((option) => option.label === "Autoplay Treasures")!;
  assert.match(text, new RegExp(`^ {2}NOTE buying an Event or Project.*choose ${autoplay.index} \\(Autoplay Treasures\\) first\\.$`, "m"));
  const { treasureInHand: _treasureInHand, ...played } = view.turn;
  assert.doesNotMatch(renderAgentViewText({ ...view, turn: played }), /NOTE buying an Event/);
});

test("a buy decision says that ending buys leads to the Night phase when Night cards are in hand", () => {
  const view: AgentView = {
    ...secondBuy,
    supply: [...secondBuy.supply, { card: "Monastery", count: 10, cost: { coins: 2 }, types: ["Night"], kingdom: true }],
    you: { ...secondBuy.you!, hand: { ...secondBuy.you!.hand, known: { ...secondBuy.you!.hand.known, Monastery: 1 } } }
  };
  const endBuys = secondBuy.decision!.options.find((option) => option.kind === "decline")!;
  assert.match(renderAgentViewText(view), new RegExp(`^ {2}NOTE Night cards .* To play Monastery, choose ${endBuys.index} \\(End Buys\\) when done buying; .*Night phase\\.$`, "m"));
  assert.doesNotMatch(renderAgentViewText(secondBuy), /NOTE Night/);
});

test("a buy decision says which treasures the buy list leaves out or would never play", () => {
  const decision = firstBuy.decision!;
  const playGroup = decision.groups.find((group) => group.kind === "play")!.group;
  const extra = ["Bank", "Venture"].map((card, offset) => ({ index: decision.options.length + offset, group: playGroup, kind: "card" as const, label: card, card }));
  const [bank, venture] = extra as [(typeof extra)[0], (typeof extra)[0]];
  const view: AgentView = {
    ...firstBuy,
    turn: { ...firstBuy.turn, treasureInHand: { coins: 4, potions: 0, variable: ["Bank"] } },
    decision: { ...decision, options: [...decision.options, ...extra] }
  };
  const text = renderAgentViewText(view);
  assert.match(text, new RegExp(`^ {2}NOTE the buy list only counts treasures with a fixed value.* Bank must be played first, one at a time, before buying: ${bank.index} \\(Bank\\)\\.$`, "m"));
  assert.match(text, new RegExp(`^ {2}NOTE buying a card plays only .*, so Venture may never be played\\. To play it, choose ${venture.index} \\(Venture\\) before buying\\.$`, "m"));
  assert.doesNotMatch(renderAgentViewText(firstBuy), /^ {2}NOTE /m);
});

test("a treasure to play shows what it makes, not what it costs", () => {
  const decision = firstBuy.decision!;
  const playGroup = decision.groups.find((group) => group.kind === "play")!.group;
  const extra = ["Bank", "Remodel"].map((card, offset) => ({ index: decision.options.length + offset, group: playGroup, kind: "card" as const, label: card, card }));
  const view: AgentView = {
    ...firstBuy,
    turn: { ...firstBuy.turn, treasureInHand: { coins: 5, potions: 0, variable: ["Bank"], made: { Copper: { coins: 1, potions: 0 } } } },
    decision: { ...decision, options: [...decision.options, ...extra] }
  };
  const text = renderAgentViewText(view);
  const copper = decision.options.find((option) => option.group === playGroup && option.card === "Copper")!;
  assert.match(text, new RegExp(`^ {4}${copper.index}: Copper \\+\\$1$`, "m"));
  assert.match(text, new RegExp(`^ {4}${extra[0]!.index}: Bank$`, "m"));
  assert.match(text, new RegExp(`^ {4}${extra[1]!.index}: Remodel \\$4$`, "m"));
  const silver = decision.options.find((option) => option.card === "Silver")!;
  assert.match(text, new RegExp(`^ {4}${silver.index}: Silver \\$3$`, "m"));
});

test("a result says how the game ended when the supply or a resignation shows it", () => {
  const players = [
    { name: "colonelpanic8", rank: 1, points: 48, turns: 17, resigned: false },
    { name: "Lord Rattington", rank: 2, points: 18, turns: 16, resigned: false }
  ];
  const over = (supply: AgentView["supply"], result = { players }): string =>
    renderGameOverText({ ...secondBuy, supply, game: { ...secondBuy.game, running: false, result } }, result).split("\n")[1]!;
  const emptied = (...cards: string[]) => secondBuy.supply.map((pile) => (cards.includes(pile.card) ? { ...pile, count: 0 } : pile));

  assert.equal(over(emptied("Province")), "RESULT 1. colonelpanic8 48 VP in 17 turns, 2. Lord Rattington 18 VP in 16 turns; ended because the Province pile ran out");
  assert.match(over(emptied("Curse", "Moat", "Cellar")), /; ended because 3 supply piles ran out \(Curse, Moat, Cellar\)$/);
  assert.doesNotMatch(over(emptied("Curse", "Moat")), /ended/);
  const resigned = { players: [players[0]!, { ...players[1]!, resigned: true }] };
  assert.match(over(secondBuy.supply, resigned), /Lord Rattington 18 VP in 16 turns \(resigned\); ended because Lord Rattington resigned$/);
});

test("an extra turn is marked on the status line", () => {
  const turnKinds = ["REGULAR", "POSSESSION", "MISSION", "OUTPOST", "SEIZE_THE_DAY"];
  assert.equal(extraTurnKind(0, turnKinds), undefined);
  assert.equal(extraTurnKind(4, turnKinds), "seize the day");
  assert.equal(extraTurnKind(9, turnKinds), "type 9");
  const extra: AgentView = { ...firstBuy, turn: { ...firstBuy.turn, number: 12, extra: "seize the day" } };
  assert.match(renderAgentViewText(extra), /^GAME \d+: turn 12 \(extra turn: seize the day\), your turn, /);
});

test("a pile's Trait is shown on the pile and on every option for its cards", () => {
  const view: AgentView = { ...firstBuy, supply: firstBuy.supply.map((pile) => (pile.card === "Witch" ? { ...pile, trait: "Reckless" } : pile)) };
  const text = renderAgentViewText(view);
  assert.match(text, /^SUPPLY .*, Witch \$5 x10 \[trait: Reckless\], /m);
  const witch = view.decision!.options.find((option) => option.card === "Witch")!;
  assert.match(text, new RegExp(`^ {4}${witch.index}: Witch \\$5 \\[trait: Reckless\\]$`, "m"));
  assert.match(renderAgentViewDelta(firstBuy, view), /^SUPPLY \(changed\) Witch \$5 x10 \[trait: Reckless\]$/m);
});

test("a log the client rebuilt shorter, as after a reload, gets a full view instead of a delta", async () => {
  const { client } = fakeClient([firstBuy]);
  const call = client.call as (method: string, params: unknown[]) => Promise<unknown>;
  let rebuilt = false;
  const reloading = {
    call: async (method: string, params: unknown[]) => {
      const result = await call(method, params);
      if (method !== "getLog" || !rebuilt) return result;
      const { entries } = result as { entries: Array<{ index: number }> };
      return { entries: entries.filter((entry) => entry.index < 2), lastIndex: 1 };
    }
  } as Parameters<typeof createDominionTools>[0];
  const tools = createDominionTools(reloading, cardData);
  await tool(tools, "wait").run({}, live);
  rebuilt = true;
  const again = await tool(tools, "wait").run({}, live);
  assert.match(again, /^YOU: /m);
  assert.match(again, /^LOG$/m);
});
