import assert from "node:assert/strict";
import test from "node:test";
import { createDominionTools } from "../scripts/lib/dominion-tools";
import type { Tool } from "../scripts/lib/mcp-stdio";
import { inspectPath, inspectValue } from "../src/agent/inspect";
import { renderAgentViewDelta, renderAgentViewText } from "../src/agent/render-text";
import { tableNotes } from "../src/agent/table-notes";
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
  assert.match(second, new RegExp(`^DECISION ${secondBuy.decision!.id}: `, "m"));
  assert.doesNotMatch(second, /^CARDS$/m);
  assert.ok(second.length < renderAgentViewText(secondBuy).length);
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

test("table notes report expansion state the view has no field for, and nothing in a plain game", () => {
  const players = [
    { index: 0, name: "Ann", boughtProjects: [{ name: "Cathedral" }], activeReminders: [{ cardName: { name: "Bridge" } }] },
    { index: 1, name: "Bob" }
  ];
  const nobody = { index: -1 };
  const nowhere = { pileName: { name: "Back" } };
  const village = { pileName: { name: "Village" }, attachedTrait: { name: "Cheap" } };
  const plain = {
    players: [{ index: 0, name: "Ann" }, players[1]!],
    zones: [nowhere, { pileName: { name: "Village" }, attachedTrait: { name: "Back" } }],
    activeTurn: { ownerId: 0, controllerId: 0, turnType: 0 },
    tokens: [],
    counters: [
      { counterName: { name: "Coffers" }, owner: players[0]!, value: 2, associatedPile: nowhere, associatedCard: null },
      { counterName: { name: "Embargo Tokens" }, owner: nobody, value: 0, associatedPile: village, associatedCard: null }
    ]
  };
  const turnKinds = ["REGULAR", "BETWEEN", "POSSESSION", "MISSION", "OUTPOST"];
  assert.deepEqual(tableNotes(plain, turnKinds), []);

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
  assert.deepEqual(tableNotes(busy, turnKinds), [
    "This is an extra turn (possession).",
    "Bob controls this turn.",
    "Bob's +Action token is on Village.",
    "Embargo Tokens 1 on Village.",
    "VP Tokens 3 on Temple.",
    "Ann has bought Cathedral.",
    "Ann has reminders up for Bridge.",
    "Cheap is attached to Village."
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
  assert.match(renderAgentViewDelta(noted, firstBuy), /^ALSO nothing any more$/m);
});

test("inspect stops expanding a widely shared graph", () => {
  const leaf = { values: Array.from({ length: 50 }, (_, index) => ({ index })) };
  const wide = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`key${index}`, { leaf, again: { leaf } }]));
  const dump = JSON.stringify(inspectValue(wide, { depth: 6, maxEntries: 200 }));
  assert.ok(dump.length < 200_000, `dump is ${dump.length} characters`);
  assert.match(dump, /"key199":/);
});

test("the status says what the hand's treasures make and the score is always printed", () => {
  const view: AgentView = { ...firstBuy, turn: { ...firstBuy.turn, treasureInHand: { coins: 5, potions: 0, variable: ["Bank"] } } };
  const text = renderAgentViewText(view);
  assert.match(text, /^GAME .*, unplayed treasures in hand make \$5 plus Bank \(varies\)$/m);
  assert.match(text, new RegExp(`^SCORE you ${firstBuy.you!.points}, ${firstBuy.opponents[0]!.name} ${firstBuy.opponents[0]!.points}; Province 8 left$`, "m"));
  assert.match(renderAgentViewDelta(view, view), /^SCORE /m);
  const silver = firstBuy.decision!.options.find((option) => option.label === "Silver" && firstBuy.decision!.groups[option.group]!.kind === "buy")!;
  assert.match(text, new RegExp(`^ {4}${silver.index}: Silver \\$3$`, "m"));
});
