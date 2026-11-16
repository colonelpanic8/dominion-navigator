import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildMatchPrompt } from "../src/agent/advisor";
import { AgentRunner } from "./lib/agent-runner";
import { loadConfig } from "./lib/config.mjs";
import { DominionClient } from "./lib/dominion-client";

const { values: args } = parseArgs({
  options: { model: { type: "string" }, effort: { type: "string" }, cwd: { type: "string" } }
});
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runner = new AgentRunner(root);
const token = `match-${randomBytes(16).toString("hex")}`;

async function main(): Promise<void> {
  const session = await new DominionClient().call("getSession", []);
  if (session.screen === "login") throw new Error("Log in to dominion.games in npm run launch:chrome first.");
  if (session.screen === "game" && !session.game?.over && session.game?.opponentsAreBots) {
    throw new Error("A bot game is in progress; finish or resign it before matchmaking.");
  }
  const started = runner.start("play", token, buildMatchPrompt(session.user ? { player: session.user } : {}), {
    model: args.model ?? loadConfig().agent?.model ?? "gpt-6.1-sol",
    ...(args.effort ? { effort: args.effort } : {}),
    ...(args.cwd ? { cwd: args.cwd } : {})
  });
  if (!started.ok) throw new Error(started.error);
  let last = "";
  for (;;) {
    const status = runner.list(token)[0]!;
    const summary = JSON.stringify(status);
    if (summary !== last) {
      console.log(summary);
      last = summary;
    }
    if (status.state !== "running") {
      if (status.state !== "done") process.exitCode = 1;
      return;
    }
    await setTimeout(1000);
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    runner.stopAll();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
