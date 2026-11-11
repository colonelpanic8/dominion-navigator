export type TurnSummary = {
  turn: number;
  player: string;
  /** The $ the turn's log lines report the player making, e.g. "(+$5)". */
  coins: number;
  bought: string[];
  gained: string[];
};

const TURN_HEADER = /^Turn (\d+) - (.+)$/;

function withoutArticle(text: string): string {
  return text.replace(/^(a|an) /, "");
}

function summarize(turn: number, player: string, lines: string[]): TurnSummary {
  const summary: TurnSummary = { turn, player, coins: 0, bought: [], gained: [] };
  const own = `${player} `;
  for (const line of lines) {
    if (!line.startsWith(own)) continue;
    const action = line.slice(own.length);
    for (const match of action.matchAll(/\(\+\$(\d+)\)/g)) summary.coins += Number(match[1]);
    const bought = /^buys(?: and gains)? (.+)\.$/.exec(action)?.[1];
    if (bought) summary.bought.push(withoutArticle(bought));
    const gained = /^gains (.+)\.$/.exec(action)?.[1];
    if (gained) summary.gained.push(withoutArticle(gained));
  }
  return summary;
}

/**
 * The turns of `players` that start and end within `lines`, read from the
 * client's log text. A turn still in progress, or begun before the first
 * line, is left out because its lines are incomplete.
 */
export function completedTurns(lines: string[], players: string[]): TurnSummary[] {
  const byLength = [...players].sort((a, b) => b.length - a.length);
  const summaries: TurnSummary[] = [];
  let current: { turn: number; player: string | undefined; lines: string[] } | undefined;
  for (const line of lines) {
    const header = TURN_HEADER.exec(line);
    if (!header) {
      current?.lines.push(line);
      continue;
    }
    if (current?.player) summaries.push(summarize(current.turn, current.player, current.lines));
    const named = header[2]!;
    const player = byLength.find((name) => named === name || named.startsWith(`${name} `));
    current = { turn: Number(header[1]), player, lines: [] };
  }
  return summaries;
}
