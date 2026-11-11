import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentView, Decision, GameResult } from "../../src/agent/types";

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
  | { type: "result"; time: string; game: string; result: GameResult };

function chosen(decision: Decision, indices: number[]): Chosen[] {
  return indices.flatMap((index) => {
    const option = decision.options[index];
    return option ? [{ index, label: option.label, group: decision.groups[option.group]?.kind ?? "?" }] : [];
  });
}

/** `T5 buy: Silver — reason`, one markdown list item per record. */
function markdownLine(record: GameLogRecord): string {
  if (record.type === "result") {
    const players = record.result.players.map((item) => `${item.rank}. ${item.name} ${item.points} VP in ${item.turns} turns${item.resigned ? " (resigned)" : ""}`);
    return `- Result: ${players.join(", ")}`;
  }
  const kinds = [...new Set(record.chosen.map((item) => item.group))];
  const what = `${kinds.join("+") || record.groups.join("+")}: ${record.chosen.map((item) => item.label).join(", ") || "nothing"}`;
  const turn = record.turn !== undefined ? `T${record.turn} ` : "";
  return `- ${turn}${record.type === "auto" ? "(auto) " : ""}${what}${record.reason ? ` — ${record.reason}` : ""}`;
}

/**
 * Writes each game's answered decisions to `<dir>/<game>.jsonl` and a readable
 * `<dir>/<game>.md`. Writes run in order in the background, and a failed write
 * is reported on stderr instead of failing the tool call that made it.
 */
export class GameLog {
  private queue: Promise<void> = Promise.resolve();
  private readonly finished = new Set<string>();

  constructor(private readonly dir: string) {}

  decision(view: AgentView, decision: Decision, indices: number[], reason?: string, type: "decision" | "auto" = "decision"): void {
    this.write({
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
    this.write({ type: "result", time: new Date().toISOString(), game, result: view.game.result });
  }

  /** Resolves once every write so far has been tried. */
  flush(): Promise<void> {
    return this.queue;
  }

  private write(record: GameLogRecord): void {
    const file = join(this.dir, record.game.replace(/[^\w.-]/g, "_"));
    this.queue = this.queue
      .then(async () => {
        await mkdir(this.dir, { recursive: true });
        await appendFile(`${file}.jsonl`, `${JSON.stringify(record)}\n`);
        await appendFile(`${file}.md`, `${markdownLine(record)}\n`);
      })
      .catch((error: unknown) => {
        console.error(`dominion-navigator: could not write the game log in ${this.dir}: ${error instanceof Error ? error.message : String(error)}`);
      });
  }
}
