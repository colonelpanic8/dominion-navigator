import { BUILD } from "../build-info";
import { buildAgentView } from "../agent/agent-view";
import { renderAgentViewText } from "../agent/render-text";
import { AgentView, GameResult, LogEntry, LogPage, RawQuestion, TableState } from "../agent/types";
import type { KnowledgeSummary } from "../knowledge";
import { answerDecision, AnswerResult, openDecisions, readOpenQuestions } from "./questions";
import { dominion, getGame, RuntimeGame } from "./runtime-types";
import { summarizeTable } from "./table-state";

const MAX_LOG_LINES = 60;
/** How long a decision may wait for the content script's knowledge to catch up before being returned anyway. */
const KNOWLEDGE_GRACE_MS = 1500;
/** How often an idle wait refreshes the cached table, which outlives the client's end-of-game reset. */
const TABLE_REFRESH_MS = 2000;

export type WaitResult = {
  status: "decision" | "game-over" | "spectating" | "timeout";
  view: AgentView;
  /** Probe events the knowledge model had not processed when the view was built. */
  knowledgeLag: number;
};

function logEntries(game: RuntimeGame, afterIndex: number): LogEntry[] {
  const Parser = dominion.LogLineParser;
  const templates = dominion.LANGUAGE?.getLogEntry as Record<string, string> | undefined;
  if (!Parser || !game.state || !templates) return [];
  const parser = new Parser(game.state, game.state.players, true);
  const entries: LogEntry[] = [];
  for (const entry of game.logModel?.entries ?? []) {
    const index = entry.index ?? -1;
    if (index <= afterIndex) continue;
    const template = entry.name !== undefined ? templates[String(entry.name)] : undefined;
    if (!template) continue;
    try {
      const text = parser
        .parseLineWithArguments(template, entry.logArguments ?? [])
        .map((part) => part.text ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (text) entries.push({ index, depth: entry.depth ?? 0, text });
    } catch {
      // Skip entries the client's own parser cannot render.
    }
  }
  return entries;
}

function latestLogIndex(game: RuntimeGame): number {
  return Math.max(-1, ...(game.logModel?.entries ?? []).map((entry) => entry.index ?? -1));
}

/** Page-side agent API, exposed on `window.__dominionNavigator`. */
export class AgentBridge {
  private knowledge: KnowledgeSummary | undefined;
  private knowledgeSeq = 0;
  private eventSeq = 0;
  private lastAnsweredLogIndex = -1;
  private lastTable: TableState | undefined;
  private lastTableAt = 0;
  private readonly playerNames = new Map<number, string>();

  /** Called for every snapshot or card move the probe posts; returns its sequence number. */
  nextEventSeq(): number {
    this.eventSeq += 1;
    return this.eventSeq;
  }

  updateKnowledge(seq: number, summary: KnowledgeSummary): void {
    if (seq < this.knowledgeSeq) return;
    this.knowledgeSeq = seq;
    this.knowledge = summary;
  }

  resetForNewGame(): void {
    this.lastAnsweredLogIndex = -1;
    this.lastTable = undefined;
  }

  get knowledgeLag(): number {
    return Math.max(0, this.eventSeq - this.knowledgeSeq);
  }

  /** The live table, or undefined once the client has reset its state at the end of a game. */
  private liveTable(game: RuntimeGame): TableState | undefined {
    const players = game.state?.players ?? [];
    if (players.length === 0) return undefined;
    for (const player of players) {
      if (player.playerId !== undefined && player.name) this.playerNames.set(player.playerId, player.name);
    }
    this.lastTable = summarizeTable(game);
    this.lastTableAt = Date.now();
    return this.lastTable;
  }

  private gameResult(game: RuntimeGame): GameResult | undefined {
    const results = game.metaGameModel?.gameResult?.playerResults;
    if (!results) return undefined;
    return {
      players: results
        .map((result) => ({
          name:
            (result.playerId !== undefined &&
              (this.playerNames.get(result.playerId) ?? game.state?.players?.find((player) => player.playerId === result.playerId)?.name)) ||
            `Player ${result.playerId ?? "?"}`,
          rank: result.rank ?? 0,
          points: result.score?.totalPoints ?? 0,
          turns: result.score?.usedTurns ?? 0,
          resigned: (result.resignIndex ?? -1) !== -1
        }))
        .sort((a, b) => a.rank - b.rank)
    };
  }

  getAgentView(): AgentView {
    const game = getGame();
    if (!game) throw new Error("Dominion game service is not ready yet.");
    // The table records player names, which the result needs.
    const live = this.liveTable(game);
    const result = this.gameResult(game);
    const table = live ?? this.lastTable;
    if (!table) throw new Error("Dominion game service is not ready yet.");
    const decision = live && !result && table.playerMeIndex !== undefined ? (openDecisions(game)[0]?.decision ?? null) : null;
    const view = buildAgentView({
      table: result ? { ...table, running: false, result } : table,
      knowledge: this.knowledge,
      decision,
      sinceLastDecision: logEntries(game, this.lastAnsweredLogIndex)
        .map((entry) => entry.text)
        .slice(-MAX_LOG_LINES)
    });
    return { ...view, producer: { name: "dominion-navigator", ...(BUILD ? { build: BUILD } : {}) } };
  }

  getAgentViewText(): string {
    return renderAgentViewText(this.getAgentView());
  }

  /** Resolves when one of this player's decisions is open (or the game ends), with a fresh view. */
  async waitForDecision(options: { timeoutMs?: number; pollMs?: number } = {}): Promise<WaitResult> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    const pollMs = options.pollMs ?? 100;
    const started = Date.now();
    let decisionSeenAt: number | undefined;
    const result = (status: WaitResult["status"]): WaitResult => ({ status, view: this.getAgentView(), knowledgeLag: this.knowledgeLag });

    for (;;) {
      const game = getGame();
      if (game && this.gameResult(game)) return result("game-over");
      if (game?.state && (game.state.players ?? []).length > 0) {
        if (!game.playerModel?.playerMe) return result("spectating");
        if (!game.isRunning?.()) return result("game-over");
        if (openDecisions(game).length > 0) {
          decisionSeenAt ??= Date.now();
          if (this.knowledgeLag === 0 || Date.now() - decisionSeenAt >= KNOWLEDGE_GRACE_MS) return result("decision");
        } else {
          decisionSeenAt = undefined;
          if (Date.now() - this.lastTableAt >= TABLE_REFRESH_MS) this.liveTable(game);
        }
      }
      if (Date.now() - started >= timeoutMs) return result("timeout");
      await new Promise((resolve) => window.setTimeout(resolve, pollMs));
    }
  }

  answer(decisionId: string, indices: number[]): AnswerResult {
    const game = getGame();
    if (!game?.state) return { ok: false, error: "Dominion game service is not ready yet." };
    const logIndex = latestLogIndex(game);
    const result = answerDecision(game, decisionId, indices);
    if (result.ok) this.lastAnsweredLogIndex = logIndex;
    return result;
  }

  /** The game log after `afterIndex`, newest last; `limit` keeps only the newest entries. */
  getLog(options: { afterIndex?: number; limit?: number } = {}): LogPage {
    const game = getGame();
    if (!game?.state) return { entries: [], lastIndex: -1 };
    const entries = logEntries(game, options.afterIndex ?? -1);
    const kept = options.limit === undefined ? entries : entries.slice(Math.max(0, entries.length - Math.max(0, options.limit)));
    return { entries: kept, lastIndex: latestLogIndex(game) };
  }

  get knowledgeSummary(): KnowledgeSummary | undefined {
    return this.knowledge;
  }

  /** The projection's inputs, for debugging and test fixtures. */
  debugState(): { table: TableState; knowledge: KnowledgeSummary | undefined; rawQuestions: RawQuestion[] } | undefined {
    const game = getGame();
    if (!game?.state) return undefined;
    return { table: summarizeTable(game), knowledge: this.knowledge, rawQuestions: readOpenQuestions(game) };
  }
}
