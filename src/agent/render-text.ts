import type { CardCounter } from "../knowledge";
import { completedTurns, TurnSummary } from "./turn-summary";
import { AgentView, Cost, Decision, GameResult, HandTreasure, PileView, PlayerView, TurnView, ZoneView } from "./types";

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

function owns(view: PlayerView): string {
  const count = Object.values(view.owned.known).reduce((total, item) => total + item, view.owned.unknown);
  const owned = [cards(view.owned.known), view.owned.unknown ? `${view.owned.unknown} unknown` : ""].filter(Boolean).join("; ");
  return `owns ${count} card${count === 1 ? "" : "s"}${owned ? `: ${owned}` : ""}`;
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
  lines.push(`  ${owns(view)}`);
  const counters = Object.entries(view.counters)
    .filter(([, value]) => value !== 0)
    .map(([name, value]) => `${name} ${value}`);
  if (counters.length) lines.push(`  ${counters.join(", ")}`);
  return lines;
}

function others(pile: PileView): string {
  return pile.others?.length ? ` (pile also holds ${pile.others.join(", ")})` : "";
}

function pileCosts(view: AgentView): Map<string, Cost> {
  return new Map(
    [...view.supply, ...view.nonSupply, ...view.landscapes].filter((pile) => pile.cost).map((pile) => [pile.card, pile.cost!] as const)
  );
}

const AUTOPLAY = "Autoplay Treasures";
/** Treasures that only make money, so it does not matter whether they are played. */
const PLAIN_TREASURES = new Set(["Copper", "Silver", "Gold", "Platinum", "Potion"]);

function pileTypes(view: AgentView): Map<string, string[]> {
  return new Map([...view.supply, ...view.nonSupply, ...view.landscapes].map((pile) => [pile.card, pile.types] as const));
}

/** Things a decision's options do not say on their own that agents have tripped on. */
function decisionNotes(view: AgentView, value: Decision): string[] {
  const notes: string[] = [];
  const buyGroup = value.groups.find((group) => group.kind === "buy");
  if (!buyGroup) return notes;
  const buyOptions = value.options.filter((option) => option.group === buyGroup.group);
  const autoplay = value.options.find((option) => option.kind === "button" && option.label === AUTOPLAY);
  const playFirst = autoplay ? `choose ${autoplay.index} (${AUTOPLAY}) first` : "play your treasures first";
  const buys = view.turn.buys;
  const playGroup = value.groups.find((group) => group.kind === "play");
  const playable = value.options.filter((option) => option.group === playGroup?.group && option.card);
  const playOptions = (cards: Set<string>): string => playable.filter((option) => cards.has(option.card!)).map((option) => `${option.index} (${option.label})`).join(", ");
  const variable = new Set(view.turn.treasureInHand?.variable ?? []);
  const special = new Set(playable.map((option) => option.card!).filter((card) => !PLAIN_TREASURES.has(card) && !variable.has(card)));
  if (variable.size && playOptions(variable)) {
    notes.push(
      `NOTE the buy list only counts treasures with a fixed value, so it may leave out cards you can afford. ${[...variable].join(", ")} must be played first, one at a time, before buying: ${playOptions(variable)}.`
    );
  }
  if (special.size) {
    notes.push(
      `NOTE buying a card plays only the treasures that card needs and leaves the rest in hand, so ${[...special].join(", ")} may never be played. To play ${special.size > 1 ? "them" : "it"}, choose ${playOptions(special)} before buying.`
    );
  }
  if (autoplay && buys !== undefined && buys > 1) {
    notes.push(`NOTE buying a card plays only the treasures that card needs and leaves the rest in hand. With ${buys} buys, ${playFirst}.`);
  }
  const landscapes = new Set(view.landscapes.map((pile) => pile.card));
  if (view.turn.treasureInHand && buyOptions.some((option) => option.card && landscapes.has(option.card))) {
    notes.push(
      `NOTE buying an Event or Project, like buying a card, plays only the treasures its cost needs, and no treasures can be played after any buy. To spend the rest of your money on a later buy, ${playFirst}.`
    );
  }
  const types = pileTypes(view);
  const night = Object.keys(view.you?.hand.known ?? {}).filter((card) => types.get(card)?.includes("Night"));
  const endBuys = buyOptions.find((option) => option.kind === "decline");
  if (night.length && endBuys) {
    notes.push(`NOTE Night cards are played after the Buy phase. To play ${night.join(", ")}, choose ${endBuys.index} (${endBuys.label}) when done buying; that moves on to the Night phase.`);
  }
  return notes;
}

/** Every card option carries its cost, from the client or else from its pile, and a landscape its type. */
function decision(view: AgentView, value: Decision): string[] {
  const costs = pileCosts(view);
  const landscapeTypes = new Map(view.landscapes.map((pile) => [pile.card, pile.types[0]] as const));
  const lines = [`DECISION ${value.id}: ${value.prompt}`];
  if (value.alternatives) {
    const kinds = (groups: number[]): string => groups.map((group) => `[${value.groups[group]?.kind}]`).join("+");
    lines.push(`  answer from ONE of these, never mixing them: ${value.alternatives.map(kinds).join(" | ")}`);
  }
  const multipleGroups = value.groups.length > 1;
  for (const group of value.groups) {
    const bounds = group.order
      ? `choose all ${group.max} in order, bottom card first and top card last`
      : group.min === group.max
        ? `choose ${group.min}`
        : `choose ${group.min}-${group.max}`;
    if (multipleGroups) lines.push(`  [${group.kind}] ${group.prompt} (${bounds})`);
    else lines.push(`  ${bounds}`);
    for (const option of value.options.filter((item) => item.group === group.group)) {
      const price = option.cost ?? (option.card ? costs.get(option.card) : undefined);
      const landscape = option.card ? landscapeTypes.get(option.card) : undefined;
      lines.push(
        `    ${option.index}: ${option.label}${price ? ` ${cost(price)}` : ""}${landscape ? ` [${landscape}]` : ""}${option.kind === "decline" ? " (decline)" : ""}`
      );
    }
  }
  lines.push(...decisionNotes(view, value).map((note) => `  ${note}`));
  return lines;
}

function money(coins: number, potions: number): string {
  return [`$${coins}`, potions ? `${potions}P` : ""].filter(Boolean).join("+");
}

/** One total of what the turn can spend, so the reader need not add played and unplayed money. */
function available(turn: TurnView, hand: HandTreasure): string {
  const [coins, potions] = [turn.coins ?? 0, turn.potions ?? 0];
  const unplayed = hand.coins || hand.potions ? ` + ${money(hand.coins, hand.potions)} in unplayed treasures` : "";
  const counted: CardCounter = {};
  for (const name of hand.variable) counted[name] = (counted[name] ?? 0) + 1;
  const variable = hand.variable.length ? `, plus unplayed ${cards(counted)} (value or effect: see card)` : "";
  return `${money(coins + hand.coins, potions + hand.potions)} available (${money(coins, potions)} played${unplayed})${variable}`;
}

/** Scores and the piles that end the game, which a delta would otherwise only print when they change. */
function score(view: AgentView): string {
  const players = [view.you, ...view.opponents].filter((item): item is PlayerView => Boolean(item));
  const points = players.map((item) => `${item === view.you ? "you" : item.name} ${item.points ?? "?"}`).join(", ");
  const enders = view.supply.filter((pile) => pile.card === "Province" || pile.card === "Colony").map((pile) => `${pile.card} ${pile.count} left`);
  const empty = view.supply.filter((pile) => pile.count === 0).map((pile) => pile.card);
  const piles = [...enders, empty.length ? `empty piles: ${empty.join(", ")}` : ""].filter(Boolean).join(", ");
  return `SCORE ${points}${piles ? `; ${piles}` : ""}`;
}

function turnLine(turn: TurnSummary): string {
  const gained = turn.gained.length ? `, gained ${turn.gained.join(", ")}` : "";
  return `  turn ${turn.turn} ${turn.player}: made $${turn.coins}, bought ${turn.bought.join(", ") || "nothing"}${gained}`;
}

/** How a finished game ended, when its result and final supply show it. */
function endCondition(view: AgentView, value: GameResult): string | undefined {
  const resigned = value.players.filter((item) => item.resigned).map((item) => item.name);
  if (resigned.length) return `${resigned.join(" and ")} resigned`;
  const emptied = view.supply.filter((pile) => pile.count === 0).map((pile) => pile.card);
  const enders = ["Province", "Colony"].filter((card) => emptied.includes(card));
  if (enders.length) return `the ${enders.join(" and ")} pile ran out`;
  const piles = value.players.length >= 5 ? 4 : 3;
  return emptied.length >= piles ? `${emptied.length} supply piles ran out (${emptied.join(", ")})` : undefined;
}

function resultLine(view: AgentView, value: GameResult): string {
  const players = value.players.map(
    (item) => `${item.rank}. ${item.name} ${item.points} VP in ${item.turns} turn${item.turns === 1 ? "" : "s"}${item.resigned ? " (resigned)" : ""}`
  );
  const ended = endCondition(view, value);
  return `RESULT ${players.join(", ")}${ended ? `; ended because ${ended}` : ""}`;
}

/**
 * A view as independent blocks. A lines block is reprinted whole when any of it
 * changes; a piles block can report single piles because each stands alone.
 */
type Block =
  | { kind: "lines"; key: string; lines: string[]; always?: boolean; /** Printed by a delta once the block is gone. */ gone?: string }
  | { kind: "piles"; key: string; label: string; piles: Array<{ card: string; text: string }> };

function blocks(view: AgentView): Block[] {
  const turn = view.turn;
  const status = [
    turn.number !== undefined ? `turn ${turn.number}${turn.extra ? ` (extra turn: ${turn.extra})` : ""}` : turn.extra ? `extra turn: ${turn.extra}` : "",
    turn.activePlayer ? `${turn.yourTurn ? "your turn" : `${turn.activePlayer}'s turn`}` : "",
    turn.phase ? `${turn.phase} phase` : "",
    ...(["actions", "buys", "coins"] as const).map((key) => (turn[key] !== undefined ? `${key} ${turn[key]}` : "")),
    ...(["potions", "debt"] as const).map((key) => (turn[key] ? `${key} ${turn[key]}` : "")),
    turn.treasureInHand ? available(turn, turn.treasureInHand) : ""
  ].filter(Boolean);

  const game = [`GAME ${view.game.number ?? "?"}${view.game.running ? "" : " (over)"}${view.spectating ? " (spectating)" : ""}: ${status.join(", ")}`];
  if (view.game.running) game.push(score(view));
  if (view.game.result) game.push(resultLine(view, view.game.result));

  const result: Block[] = [{ kind: "lines", key: "game", lines: game, always: true }];
  if (view.you) result.push({ kind: "lines", key: `player:${view.you.index}`, lines: player("YOU", view.you) });
  for (const opponent of view.opponents) result.push({ kind: "lines", key: `player:${opponent.index}`, lines: player("OPPONENT", opponent) });
  result.push({ kind: "piles", key: "supply", label: "SUPPLY", piles: view.supply.map((pile) => ({ card: pile.card, text: `${pile.card} ${cost(pile.cost)} x${pile.count}${others(pile)}` })) });
  if (view.landscapes.length) {
    result.push({ kind: "piles", key: "landscapes", label: "LANDSCAPES", piles: view.landscapes.map((pile) => ({ card: pile.card, text: `${pile.card} ${cost(pile.cost)}` })) });
  }
  if (view.nonSupply.length) {
    result.push({ kind: "piles", key: "non-supply", label: "NON-SUPPLY", piles: view.nonSupply.map((pile) => ({ card: pile.card, text: `${pile.card} x${pile.count}${others(pile)}` })) });
  }
  const trash = cards(view.trash.cards);
  result.push({ kind: "lines", key: "trash", lines: [`TRASH ${trash || "empty"}${view.trash.unknown ? `; ${view.trash.unknown} unknown` : ""}`] });
  if (view.notes?.length) {
    result.push({ kind: "lines", key: "notes", lines: ["ALSO", ...view.notes.map((note) => `  ${note}`)], gone: "ALSO (none of the earlier notes apply any more)" });
  }
  if (view.sinceLastDecision.length) {
    result.push({ kind: "lines", key: "log", lines: ["LOG", ...view.sinceLastDecision.map((line) => `  ${line}`)], always: true });
  }
  const turns = completedTurns(view.sinceLastDecision, view.opponents.map((opponent) => opponent.name));
  if (turns.length) result.push({ kind: "lines", key: "turns", lines: ["OPPONENT TURNS", ...turns.map(turnLine)], always: true });
  if (view.decision) result.push({ kind: "lines", key: "decision", lines: decision(view, view.decision), always: true });
  return result;
}

function renderBlock(block: Block): string[] {
  return block.kind === "lines" ? block.lines : [`${block.label} ${block.piles.map((pile) => pile.text).join(", ")}`];
}

/** A finished game in brief: the result and what each player ended with. */
export function renderGameOverText(view: AgentView, result: GameResult): string {
  const players = [...(view.you ? [["YOU", view.you] as const] : []), ...view.opponents.map((item) => ["OPPONENT", item] as const)];
  return [
    `GAME ${view.game.number ?? "?"} (over)`,
    resultLine(view, result),
    ...players.map(([label, item]) => `${label}: ${item.name}${item.points !== undefined ? ` (${item.points} VP)` : ""} ${owns(item)}`)
  ].join("\n");
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
  if (previous.game.number === undefined || previous.game.number !== next.game.number) return renderAgentViewText(next);
  const before = new Map(blocks(previous).map((block) => [block.key, block]));
  const after = blocks(next);
  const removed = [...before.values()].filter((block) => !after.some((item) => item.key === block.key));
  const emptied: Block[] = removed.flatMap((block): Block[] => {
    if (block.kind === "piles") return [{ ...block, piles: [] }];
    return block.gone ? [{ kind: "lines", key: block.key, lines: [block.gone] }] : [];
  });
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
