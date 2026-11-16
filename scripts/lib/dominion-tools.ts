import { COMMON_GAMEPLAY_INSTRUCTIONS } from "../../src/agent/gameplay-instructions";
import { buildCardGlossary, CardDataEntry, renderGlossary, supplyCosts, viewCardNames } from "../../src/agent/glossary";
import { renderAgentViewDelta, renderAgentViewText, renderGameOverText } from "../../src/agent/render-text";
import type { AgentView, Decision, SessionState } from "../../src/agent/types";
import { resolveChoose } from "./choose-labels";
import type { DominionClient, WaitResult } from "./dominion-client";
import type { GameLog } from "./game-log";
import { toolResult, type Tool, type ToolResult } from "./mcp-stdio";
import { internalIndices, sharedGlossary, sharedLog, sharedTextView, sharedView } from "./shared-view";

export type DominionToolOptions = {
  /** Where answered decisions and results are recorded, when set. */
  gameLog?: GameLog;
};

export const INSTRUCTIONS = [
  `Shared Dominion gameplay (dominion/play@1): ${COMMON_GAMEPLAY_INSTRUCTIONS}`,
  "Navigator backend (dominion.games):",
  "Plays dominion.games through the Dominion Navigator browser extension, without screenshots.",
  "Call `state` first: it says which screen the client is on and, in a game, prints the whole table.",
  "Use `find_match` to search for a human opponent when the operator asked for one, or `new_game` to start a bot game.",
  "When a player hands you a game with an agent token, call `join` with it instead: it ties this session to their tab and prints the table. Once they take the game back, `step` and `wait` fail and you must stop.",
  "Responses carrying a game also include a conservative `dominion/agent-view@2` projection in structuredContent.view, even when the text is a delta. Browser-specific limitations are documented in the README. `step` first prints CHOSE, naming what you selected; check it.",
  'Navigator extras: `choose` also accepts option labels instead of indices (ordered choose remains bottom card first); `reason` records your reasoning. `join` binds an overlay agent token to its browser tab; it is not a hosted seat token. Choose options by label when convenient: option numbers change from one decision to the next. A label matches without case, e.g. "Silver"; when a label is in more than one group, prefix the group kind, as in "buy:Silver" or "play:Copper". Repeat a label to take several options with it: ["Copper", "Copper"] plays two Coppers. A label that matches nothing, or matches options in different groups, fails without acting and lists the options. Numbers still work, and both can be mixed.',
  "Each option group says how many options it takes. An empty `choose` selects nothing where a group allows 0. When a decision says to answer from ONE of a list of group sets, take options from one set only (groups joined by + may be answered together); the other groups need no answer.",
  "In the buy phase the buy list shows what the treasures in your hand can pay for, and choosing a card plays only the treasures it needs; the rest stay in hand. With more than one buy, choose Autoplay Treasures first so every buy can use all your money. The buy list does not count treasures whose value is not fixed, such as Bank, and Autoplay may skip them; play those, and treasures that do more than make money, one at a time before buying.",
  "Decisions with a single legal answer are answered for you and reported as AUTO lines.",
  "OPPONENT TURNS sums each opponent turn that ended within the LOG: the $ its log lines show it making, and what it bought and gained.",
  "Views never contain hidden information. A zone's `N unknown` counts cards you cannot identify, usually because they moved while face down, such as an opponent's hand being discarded; it is not an error. A line like `hand+discard hold 3 of: Copper, 2 Silver` means those cards are split between those zones in a way you cannot see; with `, 1 of them elsewhere`, one of the listed cards is in some other zone.",
  "`inspect` reads raw client state for debugging and can show more than a player may know, so do not use it to choose plays."
].join("\n\n");

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

function optionalText(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

/** Option numbers and labels, as `step` accepts them (`choose`, or `indices` for dominion/play@1). */
function choices(args: Record<string, unknown>): Array<number | string> {
  if (args.choose !== undefined && args.indices !== undefined) throw new Error("Give either indices or choose, not both");
  if (
    args.indices !== undefined &&
    (!Array.isArray(args.indices) || args.indices.some((item) => typeof item !== "number" || !Number.isInteger(item) || item < 0))
  )
    throw new Error("indices must be an array of non-negative integers");
  const value = args.choose ?? args.indices;
  const valid = (item: unknown): boolean => (typeof item === "number" && Number.isInteger(item)) || (typeof item === "string" && item.trim() !== "");
  if (!Array.isArray(value) || !value.every(valid)) throw new Error("choose must be an array of option numbers or option labels");
  return value as Array<number | string>;
}

/** Checks optional `expect` labels against the options chosen by `indices`. */
function verifyExpect(decision: Decision, indices: number[], expect: string[]): void {
  if (expect.length !== indices.length) {
    throw new Error(`expect has ${expect.length} label(s), but ${indices.length} option(s) were chosen`);
  }
  const normalize = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  for (let i = 0; i < indices.length; i += 1) {
    const option = decision.options[indices[i]!];
    const expected = normalize(expect[i]!);
    if (!option) continue;
    const label = normalize(option.label);
    const groupKind = normalize(decision.groups[option.group]?.kind ?? "");
    const candidates = new Set([
      label,
      normalize(option.label.replace(/\s*\([^)]*\)\s*$/, "")),
      `${groupKind}${label}`,
      ...(option.card ? [normalize(option.card), `${groupKind}${normalize(option.card)}`] : [])
    ]);
    if (!candidates.has(expected)) {
      throw new Error(`option ${option.index} is "${option.label}" ([${groupKind}]), not "${expect[i]}"`);
    }
  }
}

function list<T extends "string" | "number">(args: Record<string, unknown>, name: string, type: T): Array<T extends "string" ? string : number> {
  const value = args[name];
  if (!Array.isArray(value) || value.some((item) => typeof item !== type)) throw new Error(`${name} must be an array of ${type}s`);
  return value as Array<T extends "string" ? string : number>;
}

function describeSession(session: SessionState): string {
  const parts: string[] = [session.user ? `logged in as ${session.user}` : "not logged in"];
  if (session.searching) parts.push("searching automatch");
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

/** What an answer chose, by label, so a wrong option number shows at once. */
function describeChoice(decision: Decision, choose: number[]): string {
  const byGroup = new Map<number, string[]>();
  for (const index of choose) {
    const option = decision.options[index];
    if (option) byGroup.set(option.group, [...(byGroup.get(option.group) ?? []), option.label]);
  }
  const parts = [...byGroup].map(([group, labels]) => `[${decision.groups[group]?.kind ?? "?"}] ${labels.join(", ")}`);
  return `CHOSE ${decision.id}: ${parts.join("; ") || "nothing"}`;
}

const GAME_OVER = "GAME OVER. Call new_game to play again.";
const TAKEN_BACK = "REFUSED: The player took this game back, or it is over. Stop: make no more dominion tool calls for it.";
const PLAYERS_GAME = "REFUSED: This session joined a player's game, and only the player starts or resigns games.";

export function createDominionTools(client: Pick<DominionClient, "call" | "join">, cardData: CardDataEntry[], options: DominionToolOptions = {}): Tool[] {
  const { gameLog } = options;
  /** What the caller was last shown, which deltas and new log lines are taken against. */
  let shown: { view: AgentView; logIndex: number } | undefined;
  /** Cards whose text the caller was given in the current game. */
  let described = new Set<string>();
  let lastAnswer: { game: string | undefined; logIndex: number } | undefined;
  /** The agent token this session joined a player's game with. */
  let joined: string | undefined;

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
  const present = async (view: AgentView, mode: "full" | "delta", signal: AbortSignal): Promise<ToolResult> => {
    const number = view.game.number;
    const sameGame = shown && number !== undefined && shown.view.game.number === number;
    let previous = mode === "delta" && sameGame ? shown : undefined;
    const log = await client.call("getLog", [{}]);
    if (previous && log.lastIndex < previous.logIndex) {
      // The client rebuilt a shorter log, as after a reload, so a delta against it would skip lines.
      previous = undefined;
    }
    // A cancelled call's result is never read, so it must not count as shown.
    signal.throwIfAborted();
    const newEntries = previous ? log.entries.filter((entry) => entry.index > previous.logIndex) : log.entries;
    const lines = newEntries.slice(-(previous ? MAX_LOG_LINES : RECENT_LOG_LINES)).map((entry) => entry.text);
    if (previous && newEntries.length > MAX_LOG_LINES) lines.unshift("(earlier lines left out; call log for them)");
    const current = { ...view, sinceLastDecision: lines };
    if (lastAnswer && (lastAnswer.game !== number || log.lastIndex < lastAnswer.logIndex)) lastAnswer = undefined;
    const entries = sharedLog(log.entries.filter((entry) => entry.index > (lastAnswer?.logIndex ?? -1)));
    if (!sameGame) described = new Set();
    const body = previous ? renderAgentViewDelta(sharedTextView(previous.view), sharedTextView(current)) : renderAgentViewText(sharedTextView(current));
    shown = { view: current, logIndex: log.lastIndex };
    const status = `STATUS game ${number ?? "?"}, ${view.you ? `seat ${view.you.index} of ${view.opponents.length + 1}` : "spectating"}`;
    return toolResult([...(previous ? [] : [status]), body, ...cardLines(current)].join("\n"), {
      view: sharedView(view, entries),
      glossary: sharedGlossary(buildCardGlossary(cardData, viewCardNames(view), supplyCosts(view)))
    });
  };

  /** Fails unless there is a game on screen that this session may act in. */
  const requireGame = async (): Promise<void> => {
    if (joined && !(await client.call("agentJoin", [joined])).ok) throw new Error(TAKEN_BACK);
    const session = await client.call("getSession", []);
    if (session.screen === "login") throw new Error("Nobody is logged in to dominion.games in that Chrome. Log in there first.");
    if (session.screen !== "game") throw new Error(`NO_GAME: No game is running; the client is on the ${session.screen} screen. Call new_game.`);
  };

  /** Waits for the next decision that needs a choice, answering forced ones on the way. */
  const settle = async (timeoutMs: number, mode: "full" | "delta", signal: AbortSignal): Promise<ToolResult> => {
    const lines: string[] = [];
    let wait: WaitResult;
    for (let answered = 0; ; answered += 1) {
      wait = await client.call("waitForDecision", [{ timeoutMs }], { timeoutMs });
      signal.throwIfAborted();
      const decision = wait.status === "decision" ? wait.view.decision : null;
      const forced = decision && answered < MAX_AUTO_ANSWERS ? forcedAnswer(decision) : undefined;
      if (!decision || !forced) break;
      await requireGame();
      const result = await client.call("answer", [decision.id, forced]);
      if (!result.ok) break;
      gameLog?.decision(wait.view, decision, forced, undefined, "auto");
      lines.push(`AUTO ${decision.id}: ${decision.prompt} -> ${decision.options[0]!.label}`);
    }
    gameLog?.result(wait.view);
    const result = await present(wait.view, mode, signal);
    lines.push(...result.content.map((item) => item.text));
    if (wait.status === "timeout") lines.push("WAITING: no decision for you yet; call wait.");
    if (wait.status === "game-over") lines.push(GAME_OVER);
    if (wait.status === "spectating") lines.push("SPECTATING: nothing to answer.");
    if (wait.knowledgeLag > 0 && wait.status === "decision") {
      lines.push(`Card tracking had not caught up with ${wait.knowledgeLag} card move(s) when this view was taken, so card locations may be out of date.`);
    }
    return toolResult(lines.join("\n"), result.structuredContent);
  };

  const showState = async (signal: AbortSignal): Promise<ToolResult> => {
    const session = await client.call("getSession", []);
    let view: AgentView;
    try {
      view = await client.call("getAgentView", []);
    } catch {
      return toolResult(["STATUS no game", describeSession(session), "No game to show. Call new_game to start one against bots."].join("\n"));
    }
    if (!view.game.running && view.game.result) {
      gameLog?.result(view);
      const result = await present(view, "full", signal);
      return toolResult(
        [`STATUS game ${view.game.number ?? "?"}, finished`, describeSession(session), renderGameOverText(view, view.game.result), GAME_OVER].join("\n"),
        result.structuredContent
      );
    }
    const result = await present(view, "full", signal);
    return toolResult([...result.content.map((item) => item.text), describeSession(session)].join("\n"), result.structuredContent);
  };

  const waitMs = (args: Record<string, unknown>): number => (integer(args, "timeout_s", { min: 1, max: MAX_WAIT_S }) ?? DEFAULT_WAIT_S) * 1000;
  const timeoutProperty = { type: "integer", description: `Seconds to wait for your next decision (default ${DEFAULT_WAIT_S}, max ${MAX_WAIT_S}).` };

  const tools: Tool[] = [
    {
      name: "state",
      description:
        "Where the client is (login, lobby, table or game) and, in a game, the whole table: turn, both players' zones as far as this player can know them, supply, trash, recent log, the open decision, and the text of every card in the game. A finished game shows only its result and each player's cards.",
      inputSchema: {
        type: "object",
        properties: { token: { type: "string", description: "Ignored: Navigator has one logged-in browser account; use join for overlay handoffs." } }
      },
      run: (_args, signal) => showState(signal)
    },
    {
      name: "join",
      description:
        "Ties this session to the game of the player whose agent token this is, then prints that game as `state` does. Use the token from the prompt the player gave you. It works until the player takes the game back or the game ends.",
      inputSchema: { type: "object", properties: { token: { type: "string", description: "The agent token, e.g. dn-1f0c…" } }, required: ["token"] },
      async run(args, signal) {
        const token = text(args, "token");
        const result = await client.join(token);
        if (!result.ok) throw new Error(`NOT_SEATED: Could not join: ${result.error} Ask the player for a new prompt.`);
        joined = token;
        shown = undefined;
        const state = await showState(signal);
        return toolResult(
          [`JOINED${result.gameNumber ? ` game ${result.gameNumber}` : ""}`, ...state.content.map((item) => item.text)].join("\n"),
          state.structuredContent
        );
      }
    },
    {
      name: "step",
      description:
        "Answers the open decision, then waits for your next one and returns what changed: new log lines, players and piles that differ, and the next decision. Fails without acting if the decision id is stale, a label does not name exactly one kind of option, or the choice is illegal. Give expect labels with indices to catch stale option numbers.",
      inputSchema: {
        type: "object",
        properties: {
          decision: { type: "string", description: "Id of the open decision, e.g. d12." },
          choose: {
            type: "array",
            items: { anyOf: [{ type: "string" }, { type: "integer" }] },
            description:
              'Options to choose, by label (safer: numbers change between decisions) or number. A label matches without case and may be prefixed by its group kind, as in "buy:Silver" or "play:Copper"; repeat a label to take several options with it. Empty selects nothing.'
          },
          indices: {
            type: "array",
            items: { type: "integer", minimum: 0 },
            description: "Common answer indices, top card first when ordered. Give matching expect labels to catch stale indices."
          },
          expect: {
            type: "array",
            items: { type: "string" },
            description:
              "Give expected labels or card names in the same order as indices / choose; case, punctuation, whitespace and trailing label parentheses are ignored."
          },
          name: { type: "string", description: "Only legal when nameAny is true. Navigator currently exposes only listed name options (nameAny false)." },
          token: { type: "string", description: "Ignored: one logged-in account per Navigator server." },
          reason: { type: "string", description: "Optional: why you chose this, kept in the game log." },
          timeout_s: timeoutProperty
        },
        required: ["decision"]
      },
      async run(args, signal) {
        const decision = text(args, "decision");
        const choose = args.name === undefined ? choices(args) : [];
        const expect = args.expect === undefined ? undefined : list(args, "expect", "string");
        const reason = optionalText(args, "reason");
        const timeoutMs = waitMs(args);
        await requireGame();
        const openView = await client.call("getAgentView", []);
        const open = openView.decision?.id === decision ? openView.decision : undefined;
        const rejected = async (error: string): Promise<Error> => {
          const current = await present(await client.call("getAgentView", []), "delta", signal);
          return new Error([`REJECTED: Answer rejected: ${error}`, ...current.content.map((item) => item.text)].join("\n"));
        };
        if (args.name !== undefined) throw await rejected("nameAny is false; answer with listed option indices instead");
        if (!open) throw await rejected(`decision ${decision} is not open`);
        let indices: number[];
        try {
          indices = resolveChoose(open, choose);
          if (new Set(indices).size !== indices.length) throw new Error("indices must not repeat");
          for (const index of indices) {
            if (!open.options.some((option) => option.index === index)) throw new Error(`option ${index} does not exist`);
          }
          if (expect) verifyExpect(open, indices, expect);
        } catch (error) {
          throw await rejected(error instanceof Error ? error.message : String(error));
        }
        const selected = indices;
        if (args.indices !== undefined) indices = internalIndices(open, indices);
        const beforeAnswer = await client.call("getLog", [{ limit: 0 }]);
        await requireGame();
        const result = await client.call("answer", [decision, indices]);
        if (!result.ok) throw await rejected(result.error);
        gameLog?.decision(openView, open, indices, reason);
        lastAnswer = { game: openView.game.number, logIndex: beforeAnswer.lastIndex };
        const next = await settle(timeoutMs, "delta", signal);
        return toolResult([describeChoice(open, selected), ...next.content.map((item) => item.text)].join("\n"), next.structuredContent);
      }
    },
    {
      name: "wait",
      description:
        "Waits for your next decision without a caller choice, automatically answers forced decisions, then returns what changed. Use it after a timeout or while an opponent is playing.",
      inputSchema: { type: "object", properties: { timeout_s: timeoutProperty, token: { type: "string", description: "Ignored: one logged-in account." } } },
      async run(args, signal) {
        const timeoutMs = waitMs(args);
        await requireGame();
        return settle(timeoutMs, "delta", signal);
      }
    },
    {
      name: "new_game",
      description:
        "Starts an unrated game against bots, from the lobby, a table, or a finished game. The kingdom is random unless `kingdom` names cards or landscapes it must contain. Fails while a game is still in progress.",
      inputSchema: {
        type: "object",
        properties: {
          players: { type: "integer", description: "Total seats. Must equal bots + 1; Navigator cannot reserve agent seats." },
          landscapes: { type: "array", items: { type: "string" }, description: "Required landscape names, combined with kingdom for dominion.games setup." },
          bots: { type: "integer", description: "Number of bot opponents, 1 to 3 (default 1). A chosen kingdom needs 1." },
          kingdom: {
            type: "array",
            items: { type: "string" },
            description:
              "Card and landscape names to require; the rest is filled at random. A split pile can be named by any of its cards or as a whole, e.g. Tent or Forts."
          }
        }
      },
      async run(args, signal) {
        if (joined) throw new Error(PLAYERS_GAME);
        const bots = integer(args, "bots", { min: 1, max: 3 }) ?? 1;
        const players = integer(args, "players", { min: 2, max: 4 }) ?? bots + 1;
        if (players !== bots + 1) throw new Error("REFUSED: players must equal bots + 1; Navigator cannot reserve seats for other agents.");
        const kingdomNames = args.kingdom === undefined ? [] : list(args, "kingdom", "string");
        const landscapes = args.landscapes === undefined ? [] : list(args, "landscapes", "string");
        for (const name of landscapes) {
          const entry = cardData.find((card) => card.name.toLowerCase() === name.toLowerCase());
          if (!entry?.types.some((type) => ["Event", "Landmark", "Project", "Way", "Ally", "Trait", "Prophecy", "Study"].includes(type))) {
            throw new Error(`REFUSED: ${JSON.stringify(name)} is not a known landscape`);
          }
        }
        const kingdom = [...new Set([...kingdomNames, ...landscapes])];
        if (kingdom.length && bots !== 1) throw new Error("REFUSED: a chosen kingdom or landscape requires exactly one bot");
        const result = await client.call("startBotGame", [{ bots, ...(kingdom.length ? { kingdom } : {}) }], { timeoutMs: START_GAME_TIMEOUT_MS });
        if (!result.ok) throw new Error(`Could not start a game: ${result.error}`);
        await requireGame();
        return settle(DEFAULT_WAIT_S * 1000, "full", signal);
      }
    },
    {
      name: "find_match",
      description:
        "Searches for a matchmade game against a human opponent through the lobby's automatch queue, readies up when a matched table forms, waits for the game to start, and returns the initial full view.",
      inputSchema: {
        type: "object",
        properties: {
          players: { type: "integer", description: "Number of players: 2 or 3 (default 2)." },
          rated: {
            anyOf: [{ type: "boolean" }, { type: "string", enum: ["any"] }],
            description: 'Whether to search for a rated game (true), unrated game (false), or either ("any", default).'
          },
          timeout_s: { type: "integer", description: "Seconds to wait for a match (default 180, max 300)." }
        }
      },
      async run(args, signal) {
        if (joined) throw new Error(PLAYERS_GAME);
        const players = integer(args, "players", { min: 2, max: 3 }) as 2 | 3 | undefined;
        const ratedArg = args.rated;
        if (ratedArg !== undefined && typeof ratedArg !== "boolean" && ratedArg !== "any") {
          throw new Error('rated must be true, false, or "any"');
        }
        const timeoutS = integer(args, "timeout_s", { min: 10, max: MAX_WAIT_S }) ?? 180;
        const timeoutMs = timeoutS * 1000;
        const result = await client.call(
          "findMatch",
          [{ ...(players ? { players } : {}), ...(ratedArg !== undefined ? { rated: ratedArg } : {}), timeoutMs }],
          { timeoutMs: timeoutMs + START_GAME_TIMEOUT_MS }
        );
        if (!result.ok) throw new Error(`Could not find a match: ${result.error}`);
        await requireGame();
        return settle(DEFAULT_WAIT_S * 1000, "full", signal);
      }
    },
    {
      name: "resign",
      description: "Resigns the game in progress.",
      inputSchema: { type: "object", properties: { token: { type: "string", description: "Ignored: one logged-in account." } } },
      async run(_args, signal) {
        if (joined) throw new Error(PLAYERS_GAME);
        const result = await client.call("resign", [], { timeoutMs: START_GAME_TIMEOUT_MS });
        if (!result.ok) throw new Error(`Could not resign: ${result.error}`);
        const view = await client.call("getAgentView", []);
        gameLog?.result(view);
        return present(view, "delta", signal);
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
        if (page.entries.length === 0)
          return toolResult(`No log lines${afterIndex !== undefined ? ` after ${afterIndex}` : ""} (newest index ${page.lastIndex}).`, { log: [] });
        return toolResult(page.entries.map((entry) => `${entry.index}${"  ".repeat(entry.depth + 1)}${entry.text}`).join("\n"), {
          log: sharedLog(page.entries)
        });
      }
    },
    {
      name: "cards",
      description: "The text, types and latest observed cost of the named cards. Costs are omitted when unavailable.",
      inputSchema: { type: "object", properties: { names: { type: "array", items: { type: "string" } } }, required: ["names"] },
      async run(args) {
        const names = list(args, "names", "string");
        const glossary = buildCardGlossary(cardData, names, shown ? supplyCosts(shown.view) : {});
        return toolResult(renderGlossary(glossary).join("\n"), { glossary: sharedGlossary(glossary) });
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
  // Validate before the handler can perform a browser action, including direct callers.
  return tools.map((tool) => ({
    ...tool,
    inputSchema: { ...tool.inputSchema, additionalProperties: false },
    async run(args, signal) {
      const schema = tool.inputSchema as { properties?: Record<string, unknown> };
      const unknown = Object.keys(args).filter((key) => !Object.hasOwn(schema.properties ?? {}, key));
      if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
      return tool.run(args, signal);
    }
  }));
}
