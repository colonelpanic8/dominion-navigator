import { access, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentView, Decision, GameResult, ProducerInfo } from "../../src/agent/types";

type Chosen = { index: number; label: string; group: string };

export type GameLogRecord =
  | {
      type: "decision" | "auto";
      time: string;
      game: string;
      turn?: number;
      decision: string;
      prompt: string;
      groups: string[];
      chosen: Chosen[];
      reason?: string;
    }
  | { type: "result"; time: string; game: string; result: GameResult }
  | { type: "start"; time: string; game: string; producer?: ProducerInfo; context: GameLogContext };

/**
 * What the log records about the run before a game's first decision: the
 * MCP server's own version and whatever the caller passes in (the agent's
 * model, its context repository's commit, ...).
 */
export type GameLogContext = Record<string, unknown>;

function chosen(decision: Decision, indices: number[]): Chosen[] {
  return indices.flatMap((index) => {
    const option = decision.options[index];
    return option ? [{ index, label: option.label, group: decision.groups[option.group]?.kind ?? "?" }] : [];
  });
}

/** `key: value` lines for the context, flattening one level of nesting into `key.sub`. */
function contextLines(context: GameLogContext): string[] {
  return Object.entries(context).flatMap(([key, value]) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>).map(([sub, inner]) => `${key}.${sub}: ${typeof inner === "string" ? inner : JSON.stringify(inner)}`)
      : [`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`]
  );
}

/** The readable log's opening lines: which game, who played it, on what kingdom, and with which versions. */
function markdownHeader(view: AgentView, context: GameLogContext): string {
  const players = [view.you, ...view.opponents].flatMap((player) => (player ? [player.name] : []));
  const kingdom = view.supply.filter((pile) => pile.kingdom).map((pile) => pile.card);
  const lines = [`# Game ${view.game.number ?? "unknown"}`, "", `Players: ${players.join(", ")}`, `Kingdom: ${kingdom.join(", ")}`];
  if (view.landscapes.length) lines.push(`Landscapes: ${view.landscapes.map((pile) => pile.card).join(", ")}`);
  const build = view.producer?.build;
  const versions = [
    ...(build ? [`extension: ${build.commit}${build.dirty ? " (dirty)" : ""}, built ${build.builtAt}`] : []),
    ...contextLines(context)
  ];
  if (versions.length) lines.push("", "Versions:", ...versions.map((line) => `- ${line}`));
  return `${lines.join("\n")}\n\n`;
}

/**
 * `T5 buy: Silver — reason`, one markdown list item per record. AUTO answers
 * had only one legal choice and no reasoning, so they stay in the JSON lines only.
 */
function markdownLine(record: GameLogRecord): string | undefined {
  if (record.type === "auto" || record.type === "start") return undefined;
  if (record.type === "result") {
    const players = record.result.players.map(
      (item) => `${item.rank}. ${item.name} ${item.points} VP in ${item.turns} turn${item.turns === 1 ? "" : "s"}${item.resigned ? " (resigned)" : ""}`
    );
    return `- Result: ${players.join(", ")}`;
  }
  const kinds = [...new Set(record.chosen.map((item) => item.group))];
  const what = `${kinds.join("+") || record.groups.join("+")}: ${record.chosen.map((item) => item.label).join(", ") || "nothing"}`;
  const turn = record.turn !== undefined ? `T${record.turn} ` : "";
  return `- ${turn}${what}${record.reason ? ` — ${record.reason}` : ""}`;
}

/**
 * Writes each game's answered decisions to `<dir>/<game>.jsonl` and a readable
 * `<dir>/<game>.md`. Writes run in order in the background, and a failed write
 * is reported on stderr instead of failing the tool call that made it.
 */
export class GameLog {
  private queue: Promise<void> = Promise.resolve();
  private readonly finished = new Set<string>();
  private readonly started = new Set<string>();

  constructor(
    private readonly dir: string,
    private readonly context: GameLogContext = {}
  ) {}

  decision(view: AgentView, decision: Decision, indices: number[], reason?: string, type: "decision" | "auto" = "decision"): void {
    this.write(view, {
      type,
      time: new Date().toISOString(),
      game: view.game.number ?? "unknown",
      ...(view.turn.number !== undefined ? { turn: view.turn.number } : {}),
      decision: decision.id,
      prompt: decision.prompt,
      groups: decision.groups.map((group) => group.kind),
      chosen: chosen(decision, indices),
      ...(reason ? { reason } : {})
    });
  }

  /** Records a finished game's result, once per game. */
  result(view: AgentView): void {
    const game = view.game.number;
    if (!game || !view.game.result || this.finished.has(game)) return;
    this.finished.add(game);
    this.write(view, { type: "result", time: new Date().toISOString(), game, result: view.game.result });
  }

  /** Resolves once every write so far has been tried. */
  flush(): Promise<void> {
    return this.queue;
  }

  private write(view: AgentView, record: GameLogRecord): void {
    const file = join(this.dir, record.game.replace(/[^\w.-]/g, "_"));
    // Once per game per server process, so a restart mid-game records the versions it resumed with.
    const start: GameLogRecord | undefined = this.started.has(record.game)
      ? undefined
      : { type: "start", time: record.time, game: record.game, ...(view.producer ? { producer: view.producer } : {}), context: this.context };
    this.started.add(record.game);
    this.queue = this.queue
      .then(async () => {
        await mkdir(this.dir, { recursive: true });
        await appendFile(`${file}.jsonl`, `${start ? `${JSON.stringify(start)}\n` : ""}${JSON.stringify(record)}\n`);
        const line = markdownLine(record);
        if (line === undefined) return;
        // The header goes in with the first readable line, so it survives a server restart mid-game.
        const fresh = await access(`${file}.md`).then(
          () => false,
          () => true
        );
        await appendFile(`${file}.md`, `${fresh ? markdownHeader(view, this.context) : ""}${line}\n`);
      })
      .catch((error: unknown) => {
        console.error(`dominion-navigator: could not write the game log in ${this.dir}: ${error instanceof Error ? error.message : String(error)}`);
      });
  }
}
