import { buildCardGlossary, CardDataEntry, renderGlossary, supplyCosts, viewCardNames } from "../../src/agent/glossary";
import { renderAgentViewDelta, renderAgentViewText, renderGameOverText } from "../../src/agent/render-text";
import type { AgentView, Decision, SessionState } from "../../src/agent/types";
import type { DominionClient, WaitResult } from "./dominion-client";
import type { Tool } from "./mcp-stdio";

export type DominionToolOptions = {
  /** Let `step` answer decisions in games that seat human opponents. */
  allowHumanOpponents?: boolean;
};

export const INSTRUCTIONS = [
  "Plays dominion.games through the Dominion Navigator browser extension, without screenshots.",
  "Call `state` first: it says which screen the client is on and, in a game, prints the whole table.",
  "A DECISION lists numbered options. Answer it with `step`, passing the decision id and the option numbers; `step` then waits for your next decision and returns only what changed since the view you were last shown.",
  "Each option group says how many options it takes. An empty `choose` selects nothing where a group allows 0.",
  "In the buy phase the buy list shows what the treasures in your hand can pay for, and choosing a card plays only the treasures it needs; the rest stay in hand. With more than one buy, choose Autoplay Treasures first so every buy can use all your money.",
  "Decisions with a single legal answer are answered for you and reported as AUTO lines.",
  "OPPONENT TURNS sums each opponent turn that ended within the LOG: the $ its log lines show it making, and what it bought and gained.",
  "Views never contain hidden information. A zone's `N unknown` counts cards you cannot identify, usually because they moved while face down, such as an opponent's hand being discarded; it is not an error. A line like `hand+discard hold 3 of: Copper, 2 Silver` means those cards are split between those zones in a way you cannot see; with `, 1 of them elsewhere`, one of the listed cards is in some other zone.",
  "`inspect` reads raw client state for debugging and can show more than a player may know, so do not use it to choose plays."
].join(" ");

/** Cards every Dominion player knows, left out of automatic card text. */
const BASIC_CARDS = new Set(["Copper", "Silver", "Gold", "Platinum", "Potion", "Estate", "Duchy", "Province", "Colony", "Curse"]);
const DEFAULT_WAIT_S = 60;
const MAX_WAIT_S = 300;
const START_GAME_TIMEOUT_MS = 90_000;
const DEFAULT_LOG_LIMIT = 50;
/** Log lines a delta carries before it points at the log tool instead. */
const MAX_LOG_LINES = 80;
/** Log lines a full view carries for context. */
const RECENT_LOG_LINES = 30;
const MAX_INSPECT_CHARS = 20_000;
/** Bound on forced decisions answered in one call, in case the client keeps reopening one. */
const MAX_AUTO_ANSWERS = 25;

function integer(args: Record<string, unknown>, name: string, bounds: { min: number; max: number }): number | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    throw new Error(`${name} must be an integer from ${bounds.min} to ${bounds.max}`);
  }
  return value;
}

function text(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || !value) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function list<T extends "string" | "number">(args: Record<string, unknown>, name: string, type: T): Array<T extends "string" ? string : number> {
  const value = args[name];
  if (!Array.isArray(value) || value.some((item) => typeof item !== type)) throw new Error(`${name} must be an array of ${type}s`);
  return value as Array<T extends "string" ? string : number>;
}

function describeSession(session: SessionState): string {
  const parts: string[] = [session.user ? `logged in as ${session.user}` : "not logged in"];
  if (session.table) {
    const seats = [...session.table.players, ...session.table.bots.map((bot) => `${bot} (bot)`)].join(", ");
    parts.push(`table ${session.table.id ?? "?"}: ${seats}${session.table.openSeats ? `, ${session.table.openSeats} open seat(s)` : ""}`);
  }
  if (session.game) parts.push(session.game.over ? "game finished" : session.game.opponentsAreBots ? "playing bots" : "playing humans");
  return `SCREEN ${session.screen} (${parts.join("; ")})`;
}

/** The only legal answer to a decision, when there is exactly one. */
function forcedAnswer(decision: Decision): number[] | undefined {
  const [group] = decision.groups;
  const [option] = decision.options;
  if (decision.groups.length !== 1 || decision.options.length !== 1 || !group || !option) return undefined;
  return group.min === 1 && group.max === 1 ? [option.index] : undefined;
}

const GAME_OVER = "The game is over. Call new_game to play again.";
const HUMAN_OPPONENTS = "This game seats human opponents, and this server only plays against bots unless it is started with --allow-human-opponents.";

export function createDominionTools(client: Pick<DominionClient, "call">, cardData: CardDataEntry[], options: DominionToolOptions = {}): Tool[] {
  /** What the caller was last shown, which deltas and new log lines are taken against. */
  let shown: { view: AgentView; logIndex: number } | undefined;
  /** Cards whose text the caller was given in the current game. */
  let described = new Set<string>();

  const cardLines = (view: AgentView): string[] => {
    const fresh = [...viewCardNames(view)].filter((name) => !described.has(name) && !BASIC_CARDS.has(name));
    if (fresh.length === 0) return [];
    for (const name of fresh) described.add(name);
    return ["CARDS", ...renderGlossary(buildCardGlossary(cardData, fresh, supplyCosts(view))).map((line) => `  ${line}`)];
  };

  /**
   * Renders a view for the caller and records it as shown. A delta needs an
   * earlier view of the same game; without one the view is printed in full.
   * The log comes from the game log by index, so no line is shown twice or lost
   * to an answer made in between.
   */
  const present = async (view: AgentView, mode: "full" | "delta", signal: AbortSignal): Promise<string[]> => {
    const number = view.game.number;
    const previous = mode === "delta" && shown && number !== undefined && shown.view.game.number === number ? shown : undefined;
    const log = await client.call("getLog", [previous ? { afterIndex: previous.logIndex, limit: MAX_LOG_LINES } : { limit: RECENT_LOG_LINES }]);
    // A cancelled call's result is never read, so it must not count as shown.
    signal.throwIfAborted();
    const lines = log.entries.map((entry) => entry.text);
    if (previous && log.entries.length === MAX_LOG_LINES) lines.unshift("(earlier lines left out; call log for them)");
    const current = { ...view, sinceLastDecision: lines };
    if (!previous) described = new Set();
    const body = previous ? renderAgentViewDelta(previous.view, current) : renderAgentViewText(current);
    shown = { view: current, logIndex: log.lastIndex };
    return [body, ...cardLines(current)];
  };

  /** Whether this server may act in the game on screen. Fails when there is no game. */
  const mayActInGame = async (): Promise<boolean> => {
    const session = await client.call("getSession", []);
    if (session.screen === "login") throw new Error("Nobody is logged in to dominion.games in that Chrome. Log in there first.");
    if (session.screen !== "game") throw new Error(`No game is running; the client is on the ${session.screen} screen. Call new_game.`);
    return Boolean(options.allowHumanOpponents || session.game?.opponentsAreBots);
  };

  /** Waits for the next decision that needs a choice, answering forced ones on the way when `autoAnswer` allows. */
  const settle = async (timeoutMs: number, mode: "full" | "delta", autoAnswer: boolean, signal: AbortSignal): Promise<string> => {
    const lines: string[] = [];
    let wait: WaitResult;
    for (let answered = 0; ; answered += 1) {
      wait = await client.call("waitForDecision", [{ timeoutMs }], { timeoutMs });
      signal.throwIfAborted();
      const decision = wait.status === "decision" ? wait.view.decision : null;
      const forced = decision && autoAnswer && answered < MAX_AUTO_ANSWERS ? forcedAnswer(decision) : undefined;
      if (!decision || !forced) break;
      const result = await client.call("answer", [decision.id, forced]);
      if (!result.ok) break;
      lines.push(`AUTO ${decision.id}: ${decision.prompt} -> ${decision.options[0]!.label}`);
    }
    lines.push(...(await present(wait.view, mode, signal)));
    if (wait.status === "timeout") lines.push("No decision for you yet. Call wait to keep waiting.");
    if (wait.status === "game-over") lines.push(GAME_OVER);
    if (wait.status === "spectating") lines.push("This account is spectating this game, so there is nothing to answer.");
    if (wait.status === "decision" && !autoAnswer) lines.push(HUMAN_OPPONENTS);
    if (wait.knowledgeLag > 0 && wait.status === "decision") {
      lines.push(`Card tracking had not caught up with ${wait.knowledgeLag} card move(s) when this view was taken, so card locations may be out of date.`);
    }
    return lines.join("\n");
  };

  const waitMs = (args: Record<string, unknown>): number => (integer(args, "timeout_s", { min: 1, max: MAX_WAIT_S }) ?? DEFAULT_WAIT_S) * 1000;
  const timeoutProperty = { type: "integer", description: `Seconds to wait for your next decision (default ${DEFAULT_WAIT_S}, max ${MAX_WAIT_S}).` };

  return [
    {
      name: "state",
      description:
        "Where the client is (login, lobby, table or game) and, in a game, the whole table: turn, both players' zones as far as this player can know them, supply, trash, recent log, the open decision, and the text of every card in the game. A finished game shows only its result and each player's cards.",
      inputSchema: { type: "object", properties: {} },
      async run(_args, signal) {
        const session = await client.call("getSession", []);
        let view: AgentView;
        try {
          view = await client.call("getAgentView", []);
        } catch {
          return [describeSession(session), "No game to show. Call new_game to start one against bots."].join("\n");
        }
        if (!view.game.running && view.game.result) {
          return [describeSession(session), renderGameOverText(view, view.game.result), GAME_OVER].join("\n");
        }
        return [describeSession(session), ...(await present(view, "full", signal))].join("\n");
      }
    },
    {
      name: "step",
      description:
        "Answers the open decision, then waits for your next one and returns what changed: new log lines, players and piles that differ, and the next decision. Fails without acting if the decision id is stale or the choice is illegal.",
      inputSchema: {
        type: "object",
        properties: {
          decision: { type: "string", description: "Id of the open decision, e.g. d12." },
          choose: { type: "array", items: { type: "integer" }, description: "Option numbers to choose. Empty selects nothing." },
          timeout_s: timeoutProperty
        },
        required: ["decision", "choose"]
      },
      async run(args, signal) {
        const decision = text(args, "decision");
        const choose = list(args, "choose", "number");
        const timeoutMs = waitMs(args);
        if (!(await mayActInGame())) throw new Error(HUMAN_OPPONENTS);
        const result = await client.call("answer", [decision, choose]);
        if (!result.ok) {
          const current = await present(await client.call("getAgentView", []), "delta", signal);
          throw new Error([`Answer rejected: ${result.error}`, ...current].join("\n"));
        }
        return settle(timeoutMs, "delta", true, signal);
      }
    },
    {
      name: "wait",
      description: "Waits for your next decision without answering anything, then returns what changed. Use it after a timeout or while an opponent is playing.",
      inputSchema: { type: "object", properties: { timeout_s: timeoutProperty } },
      async run(args, signal) {
        const timeoutMs = waitMs(args);
        return settle(timeoutMs, "delta", await mayActInGame(), signal);
      }
    },
    {
      name: "new_game",
      description:
        "Starts an unrated game against bots, from the lobby, a table, or a finished game. The kingdom is random unless `kingdom` names cards or landscapes it must contain. Fails while a game is still in progress.",
      inputSchema: {
        type: "object",
        properties: {
          bots: { type: "integer", description: "Number of bot opponents, 1 to 3 (default 1). A chosen kingdom needs 1." },
          kingdom: { type: "array", items: { type: "string" }, description: "Card and landscape names to require; the rest is filled at random." }
        }
      },
      async run(args, signal) {
        const bots = integer(args, "bots", { min: 1, max: 3 }) ?? 1;
        const kingdom = args.kingdom === undefined ? undefined : list(args, "kingdom", "string");
        const result = await client.call("startBotGame", [{ bots, ...(kingdom ? { kingdom } : {}) }], { timeoutMs: START_GAME_TIMEOUT_MS });
        if (!result.ok) throw new Error(`Could not start a game: ${result.error}`);
        return settle(DEFAULT_WAIT_S * 1000, "full", await mayActInGame(), signal);
      }
    },
    {
      name: "resign",
      description: "Resigns the game in progress.",
      inputSchema: { type: "object", properties: {} },
      async run(_args, signal) {
        const result = await client.call("resign", [], { timeoutMs: START_GAME_TIMEOUT_MS });
        if (!result.ok) throw new Error(`Could not resign: ${result.error}`);
        return (await present(await client.call("getAgentView", []), "delta", signal)).join("\n");
      }
    },
    {
      name: "log",
      description: "The game log, oldest first, each line prefixed with its index. `step` already returns new lines; use this to reread history.",
      inputSchema: {
        type: "object",
        properties: {
          after: { type: "integer", description: "Only lines with an index above this." },
          limit: { type: "integer", description: `Keep only the newest lines (default ${DEFAULT_LOG_LIMIT}).` }
        }
      },
      async run(args) {
        const afterIndex = integer(args, "after", { min: -1, max: Number.MAX_SAFE_INTEGER });
        const limit = integer(args, "limit", { min: 1, max: 2000 }) ?? DEFAULT_LOG_LIMIT;
        const page = await client.call("getLog", [{ ...(afterIndex !== undefined ? { afterIndex } : {}), limit }]);
        if (page.entries.length === 0) return `No log lines${afterIndex !== undefined ? ` after ${afterIndex}` : ""} (newest index ${page.lastIndex}).`;
        return page.entries.map((entry) => `${entry.index}${"  ".repeat(entry.depth + 1)}${entry.text}`).join("\n");
      }
    },
    {
      name: "cards",
      description: "The text, types and current cost of the named cards.",
      inputSchema: { type: "object", properties: { names: { type: "array", items: { type: "string" } } }, required: ["names"] },
      async run(args) {
        const names = list(args, "names", "string");
        return renderGlossary(buildCardGlossary(cardData, names, shown ? supplyCosts(shown.view) : {})).join("\n");
      }
    },
    {
      name: "inspect",
      description:
        "Debugging only: dumps raw client or tracker state at a dotted path, e.g. game.state.zones.3 or knowledge.players.0. Roots: game, table, meta, knowledge (the card tracker's model), probe, window. Not limited to what the player may know.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          depth: { type: "integer", description: "Levels to expand below the path (default 2, max 6)." },
          max_entries: { type: "integer", description: "Keys or elements kept per container (default 40, max 200)." }
        },
        required: ["path"]
      },
      async run(args) {
        const depth = integer(args, "depth", { min: 0, max: 6 });
        const maxEntries = integer(args, "max_entries", { min: 1, max: 200 });
        const result = await client.call("inspect", [
          text(args, "path"),
          { ...(depth !== undefined ? { depth } : {}), ...(maxEntries !== undefined ? { maxEntries } : {}) }
        ]);
        if (!result.ok) throw new Error(result.error);
        const dump = JSON.stringify(result.value, null, 1) ?? "undefined";
        return dump.length > MAX_INSPECT_CHARS ? `${dump.slice(0, MAX_INSPECT_CHARS)}\n… truncated; narrow the path or lower depth` : dump;
      }
    }
  ];
}
