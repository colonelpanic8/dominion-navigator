import assert from "node:assert/strict";
import test from "node:test";
import { createDominionTools } from "../scripts/lib/dominion-tools";
import type { Tool } from "../scripts/lib/mcp-stdio";
import { inspectPath, inspectValue } from "../src/agent/inspect";
import { renderAgentViewDelta, renderAgentViewText } from "../src/agent/render-text";
import type { AgentView, SessionState } from "../src/agent/types";
import { fixtures } from "./live-fixtures";

const [startGame, firstBuy, secondBuy] = fixtures.map((item) => item.liveView) as [AgentView, AgentView, AgentView];
const cardData = [{ name: "Remodel", text: "Trash a card from your hand.", types: ["Action"], expansion: "Base" }];

/** A page whose decisions are the queued views, recording the answers it is sent. */
function fakeClient(views: AgentView[], opponentsAreBots = true) {
  const answers: Array<[string, number[]]> = [];
  const session: SessionState = { screen: "game", user: "me", game: { over: false, opponentsAreBots } };
  const call = async (method: string, params: unknown[]): Promise<unknown> => {
    switch (method) {
      case "getSession":
        return session;
      case "getAgentView":
        return views[0];
      case "waitForDecision":
        return { status: "decision", view: views[0], knowledgeLag: 0 };
      case "answer":
        answers.push(params as [string, number[]]);
        if (params[0] !== views[0]!.decision!.id) return { ok: false, error: `decision ${String(params[0])} is not open` };
        views.shift();
        return { ok: true, decisionId: params[0] };
      default:
        throw new Error(`unexpected call ${method}`);
    }
  };
  return { answers, client: { call } as Parameters<typeof createDominionTools>[0] };
}

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

  const first = await tool(tools, "wait").run({});
  assert.deepEqual(answers, [[startGame.decision!.id, [0]]]);
  assert.match(first, new RegExp(`^AUTO ${startGame.decision!.id}: .* -> Start Game$`, "m"));
  for (const line of startGame.sinceLastDecision) assert.ok(first.includes(line), line);
  assert.match(first, /^YOU: /m);
  assert.match(first, /^ {2}Remodel \(\$4, Action\): Trash a card from your hand\.$/m);

  const buy = firstBuy.decision!.options.find((option) => option.label === "Silver")!.index;
  const second = await tool(tools, "step").run({ decision: firstBuy.decision!.id, choose: [buy] });
  assert.deepEqual(answers.at(-1), [firstBuy.decision!.id, [buy]]);
  assert.match(second, new RegExp(`^DECISION ${secondBuy.decision!.id}: `, "m"));
  assert.doesNotMatch(second, /^CARDS$/m);
  assert.ok(second.length < renderAgentViewText(secondBuy).length);
});

test("step refuses a stale decision and shows the one that is open", async () => {
  const { client } = fakeClient([firstBuy]);
  const tools = createDominionTools(client, cardData);
  await assert.rejects(tool(tools, "step").run({ decision: "d999", choose: [0] }), (error: Error) => {
    assert.match(error.message, /^Answer rejected: decision d999 is not open/);
    assert.match(error.message, new RegExp(`^DECISION ${firstBuy.decision!.id}: `, "m"));
    return true;
  });
  await assert.rejects(tool(tools, "step").run({ decision: "d2", choose: ["Silver"] }), /choose must be an array of numbers/);
});

test("step does not act against human opponents unless that is allowed", async () => {
  const guarded = fakeClient([firstBuy], false);
  await assert.rejects(tool(createDominionTools(guarded.client, cardData), "step").run({ decision: firstBuy.decision!.id, choose: [] }), /human opponents/);
  assert.deepEqual(guarded.answers, []);

  const allowed = fakeClient([firstBuy, secondBuy], false);
  const buy = firstBuy.decision!.options.find((option) => option.label === "Silver")!.index;
  await tool(createDominionTools(allowed.client, cardData, { allowHumanOpponents: true }), "step").run({ decision: firstBuy.decision!.id, choose: [buy] });
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
