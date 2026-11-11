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

/** A compact plain-text rendering of an agent view, derived only from the JSON. */
export function renderAgentViewText(view: AgentView): string {
  const turn = view.turn;
  const status = [
    turn.number !== undefined ? `turn ${turn.number}` : "",
    turn.activePlayer ? `${turn.yourTurn ? "your turn" : `${turn.activePlayer}'s turn`}` : "",
    turn.phase ? `${turn.phase} phase` : "",
    ...(["actions", "buys", "coins"] as const).map((key) => (turn[key] !== undefined ? `${key} ${turn[key]}` : "")),
    ...(["potions", "debt"] as const).map((key) => (turn[key] ? `${key} ${turn[key]}` : ""))
  ].filter(Boolean);

  const lines = [`GAME ${view.game.number ?? "?"}${view.game.running ? "" : " (over)"}${view.spectating ? " (spectating)" : ""}: ${status.join(", ")}`];
  if (view.game.result) {
    lines.push(`RESULT ${view.game.result.players.map((item) => `${item.rank}. ${item.name} ${item.points} VP${item.resigned ? " (resigned)" : ""}`).join(", ")}`);
  }
  if (view.you) lines.push(...player("YOU", view.you));
  for (const opponent of view.opponents) lines.push(...player("OPPONENT", opponent));
  lines.push(`SUPPLY ${view.supply.map((pile) => `${pile.card} ${cost(pile.cost)} x${pile.count}`).join(", ")}`);
  if (view.landscapes.length) lines.push(`LANDSCAPES ${view.landscapes.map((pile) => `${pile.card} ${cost(pile.cost)}`).join(", ")}`);
  if (view.nonSupply.length) lines.push(`NON-SUPPLY ${view.nonSupply.map((pile) => `${pile.card} x${pile.count}`).join(", ")}`);
  const trash = cards(view.trash.cards);
  lines.push(`TRASH ${trash || "empty"}${view.trash.unknown ? `; ${view.trash.unknown} unknown` : ""}`);
  if (view.sinceLastDecision.length) lines.push("LOG", ...view.sinceLastDecision.map((line) => `  ${line}`));
  if (view.decision) lines.push(...decision(view.decision));
  return lines.join("\n");
}
