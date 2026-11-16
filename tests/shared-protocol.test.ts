import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { createDominionTools, INSTRUCTIONS } from "../scripts/lib/dominion-tools";
import type { ToolResult } from "../scripts/lib/mcp-stdio";
import { internalIndices, sharedDecision, sharedGlossary, sharedLog, sharedView } from "../scripts/lib/shared-view";
import { buildAskPrompt, buildMatchPrompt, buildPlayPrompt } from "../src/agent/advisor";
import type { AgentView, Decision, LogEntry } from "../src/agent/types";
import { fixtures } from "./live-fixtures";

const schema = JSON.parse(readFileSync(new URL("../protocol/agent-view.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validate = ajv.compile(schema);
const validateGlossary = ajv.compile({ ...schema, $ref: "#/$defs/glossaryEntry", $id: "glossary" });
const base = fixtures[1]!.liveView;
const signal = new AbortController().signal;

function valid(view: unknown): void {
  assert.ok(validate(view), JSON.stringify(validate.errors, null, 2));
}

function harness(initial: AgentView = base) {
  let view = structuredClone(initial);
  let status = "decision";
  let hasGame = true;
  let tokenActive = true;
  const log: LogEntry[] = view.sinceLastDecision.map((text, index) => ({ index, text, depth: 0 }));
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const answers: number[][] = [];
  const client = {
    async join() {
      return { ok: true, gameNumber: view.game.number };
    },
    async call(method: string, params: unknown[]) {
      calls.push({ method, params });
      switch (method) {
        case "getSession":
          return { screen: hasGame ? "game" : "lobby", user: "me", game: { over: !view.game.running, opponentsAreBots: true } };
        case "getAgentView":
          if (!hasGame) throw new Error("no game");
          return view;
        case "agentJoin":
          return { ok: tokenActive };
        case "waitForDecision":
          return { status, view, knowledgeLag: 0 };
        case "getLog": {
          const { afterIndex = -1, limit } = params[0] as { afterIndex?: number; limit?: number };
          const entries = log.filter((entry) => entry.index > afterIndex);
          return { entries: limit === undefined ? entries : entries.slice(Math.max(0, entries.length - limit)), lastIndex: log.length - 1 };
        }
        case "answer":
          answers.push(params[1] as number[]);
          view = { ...view, decision: { ...view.decision!, id: `${view.decision!.id}-next` } };
          log.push({ index: log.length, text: "You answered.", depth: 0 });
          return { ok: true };
        case "resign":
          view = {
            ...view,
            game: {
              ...view.game,
              running: false,
              result: {
                players: [view.you!, ...view.opponents].map((player, index) => ({
                  name: player.name,
                  points: 3,
                  turns: 1,
                  rank: index + 1,
                  resigned: index === 0
                }))
              }
            },
            decision: null
          };
          return { ok: true };
        case "startBotGame":
        case "findMatch":
          return { ok: true };
        default:
          throw new Error(`unexpected ${method}`);
      }
    }
  } as Parameters<typeof createDominionTools>[0];
  const tools = createDominionTools(client, [
    { name: "Remodel", text: "Trash a card from your hand.", types: ["Action"], expansion: "Base" },
    { name: "Fountain", text: "", types: ["Landmark"], expansion: "Empires" }
  ]);
  return {
    tools,
    calls,
    answers,
    log,
    setView(next: AgentView) {
      view = next;
    },
    setStatus(next: string) {
      status = next;
    },
    setHasGame(next: boolean) {
      hasGame = next;
    },
    takeBack() {
      tokenActive = false;
    },
    async run(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
      const result = await tools.find((tool) => tool.name === name)!.run(args, signal);
      return typeof result === "string" ? { content: [{ type: "text", text: result }] } : result;
    }
  };
}

function projected(result: ToolResult): ReturnType<typeof sharedView> {
  const view = result.structuredContent?.view;
  valid(view);
  return view as ReturnType<typeof sharedView>;
}

const text = (result: ToolResult) => result.content.map((item) => item.text).join("\n");

test("all recorded live views project to the canonical shared schema without changing the tracker", () => {
  for (const fixture of fixtures) {
    const before = JSON.stringify(fixture.liveView);
    const view = sharedView(fixture.liveView, sharedLog([{ index: 19, depth: 1, text: "A public line" }]));
    valid(view);
    assert.equal(view.schema, "dominion/agent-view@2");
    assert.equal(view.game.id, fixture.liveView.game.number);
    assert.equal(view.you?.vp, fixture.liveView.you?.points);
    assert.deepEqual(view.sinceLastDecision, [{ seq: 19, type: "message", text: "A public line" }]);
    assert.equal(JSON.stringify(fixture.liveView), before);
    assert.ok(!Object.hasOwn(view.turn, "treasureInHand"));
    assert.ok(!Object.hasOwn(view, "producer"));
  }
  const glossary = sharedGlossary({ Remodel: { name: "Remodel", expansion: "Base", types: ["Action"], text: "Trash a card." } });
  assert.ok(validateGlossary(glossary.Remodel), JSON.stringify(validateGlossary.errors));
  assert.equal(glossary.Remodel!.set, "Base");
});

test("projection preserves uncertainty, maps trash and traits, and orders opponents from the seat's left", () => {
  const you = { ...base.you!, index: 1 };
  const view: AgentView = {
    ...base,
    you,
    opponents: [
      { ...base.opponents[0]!, index: 0 },
      { ...base.opponents[0]!, index: 2, name: "third" }
    ],
    trash: { cards: { Estate: 2 }, unknown: 1 },
    supply: [{ card: "Catapult", types: ["Action", "Attack"], count: 10, kingdom: true, others: ["Rocks"], trait: "Reckless" }]
  };
  const projected = sharedView(view, []);
  valid(projected);
  assert.deepEqual(
    projected.opponents.map((player) => player.index),
    [2, 0]
  );
  assert.deepEqual(projected.you!.uncertain, you.uncertain);
  assert.deepEqual(projected.trash, { count: 3, known: { Estate: 2 }, unknown: 1 });
  assert.deepEqual(projected.supply[0]!.members, ["Catapult", "Rocks"]);
  assert.deepEqual(projected.supply[0]!.traits, ["Reckless"]);
  assert.ok(!Object.hasOwn(projected.supply[0]!, "structure"));
});

const ordering: Decision = {
  id: "order-1",
  prompt: "Order these cards",
  questionId: "ORDER_CARDS",
  kind: "order-cards",
  min: 2,
  max: 2,
  groups: [{ group: 0, kind: "order-cards", prompt: "Order cards", min: 2, max: 2, order: "bottom-to-top" }],
  options: [
    { index: 0, group: 0, kind: "card", label: "Copper", card: "Copper" },
    { index: 1, group: 0, kind: "card", label: "Estate", card: "Estate" }
  ]
};

test("incomplete result seat mappings are omitted rather than invented", () => {
  const view: AgentView = {
    ...base,
    game: { ...base.game, running: false, result: { players: [{ name: "unavailable seat", points: 20, rank: 1, turns: 12, resigned: false }] } },
    decision: null
  };
  const result = sharedView(view, []);
  valid(result);
  assert.ok(!Object.hasOwn(result.game, "result"));
});

test("common indices use top-first ordering while legacy choose labels retain bottom-first ordering", async () => {
  const view = { ...base, decision: ordering };
  const common = harness(view);
  const state = await common.run("state");
  assert.equal(projected(state).decision!.ordered, true);
  assert.match(text(state), /indices top card first/);
  await common.run("step", { decision: ordering.id, indices: [0, 1], expect: ["Copper", "Estate"] });
  assert.deepEqual(common.answers, [[1, 0]]);
  const legacy = harness(view);
  await legacy.run("step", { decision: ordering.id, choose: ["Copper", "Estate"] });
  assert.deepEqual(legacy.answers, [[0, 1]]);
  assert.deepEqual(internalIndices(ordering, [1, 0]), [0, 1]);
});

test("structured decisions describe alternative groups and common buy/play actions without enabling arbitrary names", () => {
  const decision = sharedDecision(base.decision!, base);
  const silver = base.decision!.options.find((option) => option.label === "Silver")!;
  assert.equal(decision.options[silver.index]!.action, "buy");
  assert.equal(decision.options.find((option) => option.label === "End Buys")!.action, "end-phase");
  assert.equal(decision.options.find((option) => option.label === "Copper" && option.action === "play")!.zone, "hand");
  assert.equal(decision.nameAny, false);
  if (base.decision!.alternatives) assert.match(decision.groups[0]!.prompt, /ONE of these group sets/);
});

test("views stay full in structured responses while text becomes a delta; all log seqs survive text truncation", async () => {
  const h = harness();
  const state = await h.run("state", { token: "ignored-hosted-token" });
  projected(state);
  assert.match(text(state), /^STATUS game /);
  const old = h.log.length;
  for (let n = 0; n < 105; n++) h.log.push({ index: h.log.length, depth: 0, text: `Public event ${n}` });
  const delta = await h.run("wait", { timeout_s: 300, token: "ignored" });
  const view = projected(delta);
  assert.ok(!text(delta).includes("YOU:"));
  assert.match(text(delta), /earlier lines left out; call log/);
  assert.deepEqual(
    view.sinceLastDecision.slice(old).map((entry) => entry.seq),
    Array.from({ length: 105 }, (_, n) => old + n)
  );
  assert.deepEqual(view.you!.hand, base.you!.hand);
  const repeated = projected(await h.run("wait"));
  assert.deepEqual(repeated.sinceLastDecision, view.sinceLastDecision);
  const silver = base.decision!.options.find((option) => option.label === "Silver")!.index;
  const next = projected(await h.run("step", { decision: base.decision!.id, indices: [silver], expect: ["BUY: silver!"] }));
  assert.deepEqual(
    next.sinceLastDecision.map((entry) => entry.text),
    ["You answered."]
  );
  const page = await h.run("log", { after: old - 1, limit: 200 });
  assert.equal((page.structuredContent!.log as unknown[]).length, 106);
});

test("card introductions are once per game and a reconstructed log resets the shared answer cursor", async () => {
  const h = harness();
  assert.match(text(await h.run("state")), /^CARDS$/m);
  assert.doesNotMatch(text(await h.run("state")), /^CARDS$/m);
  const silver = base.decision!.options.find((option) => option.label === "Silver")!.index;
  await h.run("step", { decision: base.decision!.id, indices: [silver] });
  h.log.splice(0, h.log.length, { index: 0, text: "Reconstructed log", depth: 0 });
  const reset = await h.run("wait");
  assert.deepEqual(projected(reset).sinceLastDecision, [{ seq: 0, type: "message", text: "Reconstructed log" }]);
  assert.match(text(reset), /^STATUS game /);
});

test("all gameplay entry points carry shared views, finished scores and a schema-valid glossary", async () => {
  const h = harness();
  for (const [name, args] of [
    ["new_game", { players: 2, bots: 1, kingdom: ["Remodel"], landscapes: ["Fountain"] }],
    ["find_match", {}],
    ["join", { token: "dn-handoff" }]
  ] as const) {
    projected(await h.run(name, args));
  }
  assert.deepEqual(h.calls.find((call) => call.method === "startBotGame")!.params, [{ bots: 1, kingdom: ["Remodel", "Fountain"] }]);
  const glossary = (await h.run("cards", { names: ["Remodel"] })).structuredContent!.glossary as Record<string, unknown>;
  assert.ok(validateGlossary(glossary.Remodel));
  const other = harness();
  projected(await other.run("resign"));
  const finished = projected(await other.run("state"));
  assert.equal(finished.game.result!.players[0]!.vp, 3);
  assert.equal(finished.game.result!.players[0]!.index, base.you!.index);
  assert.match(text(await other.run("state")), /GAME OVER/);
});

test("illegal, stale, unsupported, and unknown arguments refuse before a move, with the current decision on rejection", async () => {
  const h = harness();
  for (const args of [{ indices: [999] }, { indices: [0, 0] }, { indices: [0], expect: ["Wrong card"] }, { name: "Gold" }]) {
    await assert.rejects(h.run("step", { decision: base.decision!.id, ...args }), (error: Error) => {
      assert.match(error.message, /^REJECTED:/);
      assert.ok(error.message.includes(`DECISION ${base.decision!.id}:`));
      return true;
    });
  }
  await h.run("state");
  h.setView({ ...base, decision: { ...base.decision!, id: "new-decision" } });
  await assert.rejects(h.run("step", { decision: base.decision!.id, indices: [0] }), /new-decision/);
  assert.deepEqual(h.answers, []);
  for (const [name, args] of [
    ["new_game", { seed: 7 }],
    ["new_game", { landscapes: ["Remodel"] }],
    ["new_game", { bots: 2, landscapes: ["Fountain"] }],
    ["new_game", { players: 3, bots: 1 }],
    ["state", { toString: "not an argument" }],
    ["step", { decision: "d", indices: ["Silver"] }],
    ["step", { decision: "d", indices: [], choose: [] }]
  ] as const) {
    await assert.rejects(h.run(name, args));
  }
  assert.ok(!h.calls.some((call) => call.method === "startBotGame"));
});

test("waiting, spectating and no-game statuses are explicit; handoff take-back still stops both step and wait", async () => {
  const h = harness();
  h.setStatus("timeout");
  h.setView({ ...base, decision: null });
  assert.match(text(await h.run("wait")), /WAITING: no decision for you yet; call wait\./);
  h.setStatus("spectating");
  h.setView({ ...base, you: null, spectating: true, decision: null });
  assert.equal(projected(await h.run("wait")).seat, null);
  assert.match(text(await h.run("wait")), /SPECTATING: nothing to answer\./);
  h.setHasGame(false);
  assert.match(text(await h.run("state")), /^STATUS no game/);
  await assert.rejects(h.run("wait"), /^Error: NO_GAME:/);
  const handed = harness();
  await handed.run("join", { token: "dn-token" });
  handed.takeBack();
  await assert.rejects(handed.run("wait"), /REFUSED:.*took this game back/);
  await assert.rejects(handed.run("step", { decision: base.decision!.id, indices: [0] }), /REFUSED:.*took this game back/);
  assert.deepEqual(handed.answers, []);
});

test("startup and launcher prompts use common gameplay tools and preserve advice-only and takeover protections", () => {
  for (const prompt of [INSTRUCTIONS, buildPlayPrompt({ token: "dn-1" }), buildMatchPrompt()]) {
    for (const name of ["state", "step", "wait", "cards", "log", "indices", "expect"]) assert.ok(prompt.includes(name), name);
    assert.match(prompt, /top card first/);
    assert.match(prompt, /dominion.games/);
    assert.match(prompt, /took the game back|take the game back/);
  }
  const advice = buildAskPrompt("Should I buy Gold?", { token: "dn-1" });
  assert.match(advice, /Do not make moves/);
  assert.match(advice, /use only `state`, `log` and `cards`/);
  assert.match(advice, /do not call step, wait, new_game, find_match or resign/);
});

test("stdio transports structured results, legacy text and MCP errors without stringifying the view", () => {
  const module = new URL("../scripts/lib/mcp-stdio.ts", import.meta.url).href;
  const script = `import {serveTools, toolResult} from ${JSON.stringify(module)}; serveTools({name:'test', version:'1', instructions:'test', tools:[{name:'structured', description:'test', inputSchema:{}, async run(){return toolResult('table', {view:{schema:'dominion/agent-view@2'}})}}, {name:'text',description:'test',inputSchema:{},async run(){return 'legacy'}}, {name:'reject',description:'test',inputSchema:{},async run(){throw new Error('REJECTED: stale')}}]});`;
  const input =
    ["structured", "text", "reject"]
      .map((name, id) => JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } }))
      .join("\n") + "\n";
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { input, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  const results = child.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).result);
  assert.deepEqual(results[0].structuredContent.view, { schema: "dominion/agent-view@2" });
  assert.equal(results[0].content[0].text, "table");
  assert.equal(results[1].content[0].text, "legacy");
  assert.equal(results[2].isError, true);
  assert.equal(results[2].content[0].text, "REJECTED: stale");
});
