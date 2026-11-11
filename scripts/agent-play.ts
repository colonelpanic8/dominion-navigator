// Plays the current dominion.games game through window.__dominionNavigator with a policy.
// Usage: npm run agent:play -- [--policy big-money] [--terminal Remodel] [--record decisions.jsonl]
//                              [--max-decisions 500] [--decision-timeout-ms 120000]
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildCardGlossary, CardDataEntry } from "../src/agent/glossary";
import { createPolicy } from "../src/agent/policies";
import { renderAgentViewText } from "../src/agent/render-text";
import type { DecidableView } from "../src/agent/policy";
import type { AgentView, CardGlossary, Cost } from "../src/agent/types";
import { CdpClient, connectCdp, debugPort, debugUrl, evaluate, fetchJson } from "./lib/cdp.mjs";

type WaitResult = { status: "decision" | "game-over" | "spectating" | "timeout"; view: AgentView; knowledgeLag: number };
type AnswerResult = { ok: true; decisionId: string } | { ok: false; error: string };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values: args } = parseArgs({
  options: {
    policy: { type: "string", default: "big-money" },
    terminal: { type: "string" },
    record: { type: "string" },
    "max-decisions": { type: "string", default: "1000" },
    "decision-timeout-ms": { type: "string", default: "120000" }
  }
});

const policy = createPolicy(args.policy!, args.terminal ? { terminal: args.terminal } : {});
const maxDecisions = Number(args["max-decisions"]);
const decisionTimeoutMs = Number(args["decision-timeout-ms"]);

async function dominionPage(port: number): Promise<CdpClient> {
  const targets = (await fetchJson(debugUrl(port, "/json/list"))) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const page = targets.find((target) => target.type === "page" && target.url.startsWith("https://dominion.games/"));
  if (!page) throw new Error(`No dominion.games tab on debug port ${port}. Start one with npm run launch:chrome.`);
  return connectCdp(page.webSocketDebuggerUrl, { timeoutMs: decisionTimeoutMs + 30_000 });
}

function call<T>(client: CdpClient, method: string, ...params: unknown[]): Promise<T> {
  const args = params.map((param) => JSON.stringify(param)).join(", ");
  return evaluate(client, `window.__dominionNavigator.${method}(${args})`) as Promise<T>;
}

function cardNames(view: AgentView): Set<string> {
  const names = new Set<string>();
  for (const pile of [...view.supply, ...view.nonSupply, ...view.landscapes]) names.add(pile.card);
  for (const player of [view.you, ...view.opponents]) {
    if (!player) continue;
    for (const card of Object.keys(player.owned.known)) names.add(card);
  }
  for (const option of view.decision?.options ?? []) if (option.card) names.add(option.card);
  return names;
}

async function main(): Promise<void> {
  const cardData = (JSON.parse(await readFile(resolve(root, "data/dominion-card-shaped-objects.json"), "utf8")) as { cardShapedObjects: CardDataEntry[] })
    .cardShapedObjects;
  const client = await dominionPage(debugPort());
  const glossary: CardGlossary = {};
  const record = args.record ? resolve(args.record) : undefined;
  if (record) await writeFile(record, "");

  const stats = { decisions: 0, kinds: new Map<string, number>(), questionIds: new Map<string, number>(), rejected: [] as string[] };
  const bump = (map: Map<string, number>, key: string): void => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  try {
    for (;;) {
      const wait = await call<WaitResult>(client, "waitForDecision", { timeoutMs: decisionTimeoutMs });
      const { view } = wait;
      if (wait.status === "spectating") throw new Error("This account is spectating, not playing; refusing to act.");
      if (wait.status === "timeout") throw new Error(`No decision within ${decisionTimeoutMs}ms.`);
      if (wait.status === "game-over" || !view.decision) {
        if (record) await appendFile(record, `${JSON.stringify({ final: true, view, text: renderAgentViewText(view) })}\n`);
        console.log(`Game ${view.game.number ?? "?"} over after ${stats.decisions} decisions.`);
        const result = view.game.result;
        if (result) {
          console.log(`Result: ${result.players.map((player) => `${player.rank}. ${player.name} ${player.points} VP in ${player.turns} turns${player.resigned ? " (resigned)" : ""}`).join("; ")}`);
        }
        break;
      }
      if (stats.decisions >= maxDecisions) throw new Error(`Stopped after ${maxDecisions} decisions.`);

      const missing = [...cardNames(view)].filter((name) => !glossary[name]);
      if (missing.length > 0) {
        const costs: Record<string, Cost> = Object.fromEntries(view.supply.filter((pile) => pile.cost).map((pile) => [pile.card, pile.cost!]));
        Object.assign(glossary, buildCardGlossary(cardData, missing, costs));
      }

      const decision = view.decision;
      const debugState = record ? await call<unknown>(client, "debugState") : undefined;
      const choice = await policy.decide(view as DecidableView, { glossary });
      const result = await call<AnswerResult>(client, "answer", decision.id, choice.indices);
      stats.decisions += 1;
      bump(stats.questionIds, decision.questionId);
      for (const group of decision.groups) bump(stats.kinds, group.kind);
      const labels = choice.indices.map((index) => decision.options[index]?.label ?? `#${index}`).join(", ") || "(nothing)";
      console.log(`${stats.decisions}. [${decision.questionId}] ${decision.prompt} -> ${labels}${result.ok ? "" : ` REJECTED: ${result.error}`}`);
      if (!result.ok) stats.rejected.push(`${decision.questionId}: ${result.error}`);
      if (record) {
        await appendFile(record, `${JSON.stringify({ n: stats.decisions, knowledgeLag: wait.knowledgeLag, view, text: renderAgentViewText(view), choice, result, debugState })}\n`);
      }
      if (stats.rejected.length >= 5) throw new Error("Too many rejected answers.");
    }
  } finally {
    client.close();
    console.log(`Decision kinds: ${[...stats.kinds].map(([kind, count]) => `${kind} ${count}`).join(", ")}`);
    console.log(`Question ids: ${[...stats.questionIds].map(([id, count]) => `${id} ${count}`).join(", ")}`);
    if (stats.rejected.length) console.log(`Rejected answers:\n  ${stats.rejected.join("\n  ")}`);
    if (record) await writeFile(`${record}.glossary.json`, `${JSON.stringify(glossary, null, 2)}\n`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
