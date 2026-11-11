import type { CardCounter } from "../knowledge";
import { AgentView, Cost, Decision, PlayerView, ZoneView } from "./types";

function cards(counter: CardCounter): string {
  const entries = Object.entries(counter);
  return entries.length === 0 ? "" : entries.map(([card, count]) => (count === 1 ? card : `${count} ${card}`)).join(", ");
}

function zone(view: ZoneView): string {
  const parts = [cards(view.known), view.unknown > 0 ? `${view.unknown} unknown` : ""].filter(Boolean);
  return `${view.count}${parts.length ? ` (${parts.join("; ")})` : ""}`;
}

function cost(value: Cost | undefined): string {
  if (!value) return "";
  return [`$${value.coins}`, value.potions ? `${value.potions}P` : "", value.debt ? `${value.debt}D` : ""].filter(Boolean).join("+");
}

function player(label: string, view: PlayerView): string[] {
  const lines = [`${label}: ${view.name}${view.points !== undefined ? ` (${view.points} VP)` : ""}`];
  lines.push(`  hand ${zone(view.hand)}`);
  if (view.inPlay.count) lines.push(`  in play ${zone(view.inPlay)}`);
  lines.push(`  deck ${zone(view.deck)}`);
  lines.push(`  discard ${zone(view.discard)}`);
  for (const [name, other] of Object.entries(view.otherZones)) if (other.count) lines.push(`  ${name} ${zone(other)}`);
  for (const group of view.uncertain) {
    const outside = group.outside ? `, ${group.outside} of them elsewhere` : "";
    lines.push(`  ${group.zones.join("+")} hold ${group.count} of: ${cards(group.candidates)}${outside}`);
  }
  if (Object.keys(view.unlocated).length) lines.push(`  unlocated ${cards(view.unlocated)}`);
  const owned = cards(view.owned.known);
  lines.push(`  owns ${owned || "nothing known"}${view.owned.unknown ? `; ${view.owned.unknown} unknown` : ""}`);
  const counters = Object.entries(view.counters)
    .filter(([, value]) => value !== 0)
    .map(([name, value]) => `${name} ${value}`);
  if (counters.length) lines.push(`  ${counters.join(", ")}`);
  return lines;
}

function decision(value: Decision): string[] {
  const lines = [`DECISION ${value.id}: ${value.prompt}`];
  const multipleGroups = value.groups.length > 1;
  for (const group of value.groups) {
    const bounds = group.min === group.max ? `choose ${group.min}` : `choose ${group.min}-${group.max}`;
    if (multipleGroups) lines.push(`  [${group.kind}] ${group.prompt} (${bounds})`);
    else lines.push(`  ${bounds}`);
    for (const option of value.options.filter((item) => item.group === group.group)) {
      lines.push(`    ${option.index}: ${option.label}${option.kind === "decline" ? " (decline)" : ""}`);
    }
  }
  return lines;
}

/**
 * A view as independent blocks. A lines block is reprinted whole when any of it
 * changes; a piles block can report single piles because each stands alone.
 */
type Block =
  | { kind: "lines"; key: string; lines: string[]; always?: boolean }
  | { kind: "piles"; key: string; label: string; piles: Array<{ card: string; text: string }> };

function blocks(view: AgentView): Block[] {
  const turn = view.turn;
  const status = [
    turn.number !== undefined ? `turn ${turn.number}` : "",
    turn.activePlayer ? `${turn.yourTurn ? "your turn" : `${turn.activePlayer}'s turn`}` : "",
    turn.phase ? `${turn.phase} phase` : "",
    ...(["actions", "buys", "coins"] as const).map((key) => (turn[key] !== undefined ? `${key} ${turn[key]}` : "")),
    ...(["potions", "debt"] as const).map((key) => (turn[key] ? `${key} ${turn[key]}` : ""))
  ].filter(Boolean);

  const game = [`GAME ${view.game.number ?? "?"}${view.game.running ? "" : " (over)"}${view.spectating ? " (spectating)" : ""}: ${status.join(", ")}`];
  if (view.game.result) {
    game.push(`RESULT ${view.game.result.players.map((item) => `${item.rank}. ${item.name} ${item.points} VP${item.resigned ? " (resigned)" : ""}`).join(", ")}`);
  }

  const result: Block[] = [{ kind: "lines", key: "game", lines: game, always: true }];
  if (view.you) result.push({ kind: "lines", key: `player:${view.you.index}`, lines: player("YOU", view.you) });
  for (const opponent of view.opponents) result.push({ kind: "lines", key: `player:${opponent.index}`, lines: player("OPPONENT", opponent) });
  result.push({ kind: "piles", key: "supply", label: "SUPPLY", piles: view.supply.map((pile) => ({ card: pile.card, text: `${pile.card} ${cost(pile.cost)} x${pile.count}` })) });
  if (view.landscapes.length) {
    result.push({ kind: "piles", key: "landscapes", label: "LANDSCAPES", piles: view.landscapes.map((pile) => ({ card: pile.card, text: `${pile.card} ${cost(pile.cost)}` })) });
  }
  if (view.nonSupply.length) {
    result.push({ kind: "piles", key: "non-supply", label: "NON-SUPPLY", piles: view.nonSupply.map((pile) => ({ card: pile.card, text: `${pile.card} x${pile.count}` })) });
  }
  const trash = cards(view.trash.cards);
  result.push({ kind: "lines", key: "trash", lines: [`TRASH ${trash || "empty"}${view.trash.unknown ? `; ${view.trash.unknown} unknown` : ""}`] });
  if (view.sinceLastDecision.length) {
    result.push({ kind: "lines", key: "log", lines: ["LOG", ...view.sinceLastDecision.map((line) => `  ${line}`)], always: true });
  }
  if (view.decision) result.push({ kind: "lines", key: "decision", lines: decision(view.decision), always: true });
  return result;
}

function renderBlock(block: Block): string[] {
  return block.kind === "lines" ? block.lines : [`${block.label} ${block.piles.map((pile) => pile.text).join(", ")}`];
}

/** A compact plain-text rendering of an agent view, derived only from the JSON. */
export function renderAgentViewText(view: AgentView): string {
  return blocks(view).flatMap(renderBlock).join("\n");
}

/**
 * What changed between two views of one game, for a reader who has seen
 * `previous`: the status, log and decision in full, plus only the players and
 * piles that differ. Views of different games render in full.
 */
export function renderAgentViewDelta(previous: AgentView, next: AgentView): string {
  if (previous.game.number !== next.game.number) return renderAgentViewText(next);
  const before = new Map(blocks(previous).map((block) => [block.key, block]));
  const after = blocks(next);
  const emptied: Block[] = [...before.values()]
    .filter((block) => block.kind === "piles" && !after.some((item) => item.key === block.key))
    .map((block) => ({ ...block, piles: [] }));
  const lines: string[] = [];
  for (const block of [...after, ...emptied]) {
    const old = before.get(block.key);
    if (block.kind === "lines") {
      if (block.always || old?.kind !== "lines" || old.lines.join("\n") !== block.lines.join("\n")) lines.push(...block.lines);
      continue;
    }
    const oldPiles = new Map(old?.kind === "piles" ? old.piles.map((pile) => [pile.card, pile.text]) : []);
    const changed = block.piles.filter((pile) => oldPiles.get(pile.card) !== pile.text).map((pile) => pile.text);
    const current = new Set(block.piles.map((pile) => pile.card));
    const gone = [...oldPiles.keys()].filter((card) => !current.has(card)).map((card) => `${card} gone`);
    if (changed.length + gone.length > 0) lines.push(`${block.label} (changed) ${[...changed, ...gone].join(", ")}`);
  }
  return lines.join("\n");
}
