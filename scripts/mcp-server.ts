// MCP server (stdio) that lets an agent play dominion.games through Dominion Navigator.
// Usage: node --import tsx scripts/mcp-server.ts [--allow-human-opponents] [--game-log-dir <dir>]
// It attaches to the Chrome started by `npm run launch:chrome` (DOMINION_NAVIGATOR_DEBUG_PORT).
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { CardDataEntry } from "../src/agent/glossary";
import { DominionClient } from "./lib/dominion-client";
import { createDominionTools, INSTRUCTIONS } from "./lib/dominion-tools";
import { GameLog } from "./lib/game-log";
import { serveTools } from "./lib/mcp-stdio";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values: args } = parseArgs({
  options: { "allow-human-opponents": { type: "boolean", default: false }, "game-log-dir": { type: "string" } }
});
const gameLogDir = args["game-log-dir"] ?? process.env.DOMINION_GAME_LOG_DIR;

const { version } = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as { version: string };
const { cardShapedObjects } = JSON.parse(await readFile(resolve(root, "data/dominion-card-shaped-objects.json"), "utf8")) as {
  cardShapedObjects: CardDataEntry[];
};

serveTools({
  name: "dominion-navigator",
  version,
  instructions: INSTRUCTIONS,
  tools: createDominionTools(new DominionClient(), cardShapedObjects, {
    allowHumanOpponents: args["allow-human-opponents"],
    ...(gameLogDir ? { gameLog: new GameLog(resolve(gameLogDir)) } : {})
  })
});
