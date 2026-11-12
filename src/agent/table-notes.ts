import type { RuntimeCard, RuntimeState, RuntimeZone } from "../probe/runtime-types";

/** Player zones a token can sit on, by the client's zone name. */
const MATS: Record<string, string> = { TavernZone: "Tavern mat", ExileZone: "Exile mat" };

/** A landscape zone's pile name is "Back", so it goes by its top card instead. */
function pileLabel(zone: RuntimeZone | undefined, landscapes: ReadonlySet<RuntimeZone>): string | undefined {
  const name = zone?.pileName?.name;
  if (name && name !== "Back") return name;
  if (!zone || !landscapes.has(zone)) return undefined;
  return cardLabel((zone.cardStacks ?? []).find((stack) => cardLabel(stack?.topCard))?.topCard);
}

/** The name on a card name, a card, or a pile, whichever `value` turns out to be. */
function cardLabel(value: unknown): string | undefined {
  const item = value as { name?: unknown; cardName?: RuntimeCard["cardName"]; pileName?: RuntimeCard["cardName"] } | null;
  const name = typeof item?.name === "string" ? item.name : (item?.cardName?.name ?? item?.pileName?.name);
  return name && name !== "Back" ? name : undefined;
}

/** The kind of an extra turn, or undefined for a regular one. `turnKinds` are the client's turn kinds in ordinal order, regular first. */
export function extraTurnKind(turnType: number | undefined, turnKinds: string[]): string | undefined {
  if (!turnType) return undefined;
  const kind = turnKinds[turnType];
  return kind ? kind.toLowerCase().replace(/_/g, " ") : `type ${turnType}`;
}

/**
 * State the view has no field for, one sentence per fact, read generically from
 * the client's state. These objects only exist in games with the expansions that
 * use them. `landscapes` are the zones of Events, Projects, Landmarks and the like.
 */
export function tableNotes(state: RuntimeState | undefined, landscapes: ReadonlySet<RuntimeZone> = new Set()): string[] {
  const seated = (player: { index?: number; name?: string } | undefined): string | undefined =>
    player && (player.index ?? -1) >= 0 ? (player.name ?? `Player ${player.index}`) : undefined;
  const notes: string[] = [];

  const turn = state?.activeTurn;
  if (turn?.controllerId !== undefined && turn.ownerId !== undefined && turn.controllerId !== turn.ownerId) {
    const controller = (state?.players ?? []).find((player) => player.index === turn.controllerId);
    notes.push(`${seated(controller) ?? `Player ${turn.controllerId}`} controls this turn.`);
  }

  for (const token of state?.tokens ?? []) {
    const name = token.tokenName?.name;
    if (!name) continue;
    const owner = seated(token.owner);
    const label = `${name}${token.isFlipped ? " (face down)" : ""}`;
    const pile = pileLabel(token.zone, landscapes);
    const matOwner = seated(token.zone?.owner);
    const mat = matOwner && MATS[token.zone?.zoneName ?? ""];
    const where = pile ?? (mat ? `${matOwner === owner ? "their" : `${matOwner}'s`} ${mat}` : undefined);
    if (where) notes.push(`${owner ? `${owner}'s ` : ""}${label} is on ${where}.`);
    else notes.push(owner ? `${owner} has their ${label}, not on a pile.` : `${label} is not on a pile.`);
  }

  for (const counter of state?.counters ?? []) {
    const name = counter.counterName?.name;
    const on = cardLabel(counter.associatedCard) ?? pileLabel(counter.associatedPile, landscapes);
    const owner = seated(counter.owner);
    // A seated player's own counters are already reported with that player.
    if (!name || !counter.value || (owner && !on)) continue;
    const amount = `${counter.value} ${name.replace(/ tokens$/i, counter.value === 1 ? " token" : " tokens")}`;
    const place = on && (counter.associatedPile && landscapes.has(counter.associatedPile) ? on : `the ${on} pile`);
    if (owner) notes.push(`${owner} has ${amount} on ${place}.`);
    else notes.push(place ? `${place.charAt(0).toUpperCase()}${place.slice(1)} has ${amount}.` : `The table has ${amount}, not on any pile.`);
  }

  for (const player of state?.players ?? []) {
    const name = seated(player);
    if (!name) continue;
    const projects = (player.boughtProjects ?? []).map(cardLabel).filter(Boolean);
    if (projects.length) notes.push(`${name} has bought ${projects.join(", ")}.`);
    const reminders = (player.activeReminders ?? []).map((reminder) => cardLabel(reminder.cardName)).filter(Boolean);
    if (reminders.length) notes.push(`${name} has reminders for ${reminders.join(", ")} (a reminder is a card whose effect is still pending for that player).`);
  }
  return notes;
}
