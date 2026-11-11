import type { RuntimeCard, RuntimeState, RuntimeZone } from "../probe/runtime-types";

function pileLabel(zone: RuntimeZone | undefined): string | undefined {
  const name = zone?.pileName?.name;
  return name && name !== "Back" ? name : undefined;
}

/** The name on a card name, a card, or a pile, whichever `value` turns out to be. */
function cardLabel(value: unknown): string | undefined {
  const item = value as { name?: unknown; cardName?: RuntimeCard["cardName"]; pileName?: RuntimeCard["cardName"] } | null;
  const name = typeof item?.name === "string" ? item.name : (item?.cardName?.name ?? item?.pileName?.name);
  return name && name !== "Back" ? name : undefined;
}

/**
 * State the view has no field for, one sentence per fact, read generically from
 * the client's state. These objects only exist in games with the expansions that
 * use them. `turnKinds` are the client's turn kinds in ordinal order, regular first.
 */
export function tableNotes(state: RuntimeState | undefined, turnKinds: string[]): string[] {
  const seated = (player: { index?: number; name?: string } | undefined): string | undefined =>
    player && (player.index ?? -1) >= 0 ? (player.name ?? `Player ${player.index}`) : undefined;
  const notes: string[] = [];

  const turn = state?.activeTurn;
  const turnKind = turnKinds[turn?.turnType ?? 0];
  if (turn?.turnType) notes.push(`This is an extra turn (${turnKind ? turnKind.toLowerCase().replace(/_/g, " ") : `type ${turn.turnType}`}).`);
  if (turn?.controllerId !== undefined && turn.ownerId !== undefined && turn.controllerId !== turn.ownerId) {
    const controller = (state?.players ?? []).find((player) => player.index === turn.controllerId);
    notes.push(`${seated(controller) ?? `Player ${turn.controllerId}`} controls this turn.`);
  }

  for (const token of state?.tokens ?? []) {
    const name = token.tokenName?.name;
    if (!name) continue;
    const owner = seated(token.owner);
    const where = pileLabel(token.zone) ?? token.zone?.zoneName;
    notes.push(`${owner ? `${owner}'s ` : ""}${name}${token.isFlipped ? " (face down)" : ""}${where ? ` is on ${where}` : ""}.`);
  }

  for (const counter of state?.counters ?? []) {
    const name = counter.counterName?.name;
    const on = cardLabel(counter.associatedCard) ?? pileLabel(counter.associatedPile);
    const owner = seated(counter.owner);
    // A seated player's own counters are already reported with that player.
    if (!name || !counter.value || (owner && !on)) continue;
    notes.push(`${owner ? `${owner} has ` : ""}${name} ${counter.value}${on ? ` on ${on}` : ""}.`);
  }

  for (const player of state?.players ?? []) {
    const name = seated(player);
    if (!name) continue;
    const projects = (player.boughtProjects ?? []).map(cardLabel).filter(Boolean);
    if (projects.length) notes.push(`${name} has bought ${projects.join(", ")}.`);
    const reminders = (player.activeReminders ?? []).map((reminder) => cardLabel(reminder.cardName)).filter(Boolean);
    if (reminders.length) notes.push(`${name} has reminders for ${reminders.join(", ")} (a reminder is a card whose effect is still pending for that player).`);
  }

  for (const zone of state?.zones ?? []) {
    const trait = cardLabel(zone?.attachedTrait);
    const pile = pileLabel(zone);
    if (trait && pile) notes.push(`${trait} is attached to ${pile}.`);
  }
  return notes;
}
