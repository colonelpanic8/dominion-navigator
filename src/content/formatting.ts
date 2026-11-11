import { CardCounter, ZoneKnowledge } from "../knowledge";
import { PlayerSummary, ZoneDetail, ZoneSummary } from "../messages";

const ZONE_DISPLAY_ORDER = ["HandZone", "InPlayZone", "DiscardZone", "DrawZone", "TavernZone", "ExileZone", "SetAsideZone", "RevealZone"];

export function counterTotal(counter: CardCounter): number {
  return Object.values(counter).reduce((sum, count) => sum + count, 0);
}

/** Entries by descending count, then name. */
export function sortedCounterEntries(counter: CardCounter): Array<[string, number]> {
  return Object.entries(counter).sort(([aName, aCount], [bName, bCount]) => bCount - aCount || aName.localeCompare(bName));
}

export function formatCounter(counter: CardCounter): string {
  return sortedCounterEntries(counter)
    .map(([name, count]) => `${count} ${name}`)
    .join(", ");
}

export function rawZoneCards(zone: ZoneDetail): string {
  const visibleCards = zone.stacks.flatMap((stack) => stack.cards.map((card) => card.name));
  const anonymousCount = zone.stacks.reduce((total, stack) => total + stack.anonymousCards, 0);
  const parts: string[] = [];
  if (visibleCards.length) parts.push(visibleCards.join(", "));
  if (anonymousCount) parts.push(`${anonymousCount} unknown`);
  return parts.join("; ") || "empty";
}

export function trackedZoneCards(zone: ZoneKnowledge): string {
  const knownText = formatCounter(zone.knownCards);
  const unknownText = zone.unknownCount > 0 ? `${zone.unknownCount} unknown` : "";
  const ambiguousText = zone.ambiguousCount > 0 ? `${zone.ambiguousCount} location-ambiguous` : "";
  return [knownText, ambiguousText, unknownText].filter(Boolean).join("; ") || "empty";
}

export function playerDisplayName(player: PlayerSummary | undefined): string {
  return player?.name ?? (player?.index !== undefined ? `Player ${player.index}` : "unknown");
}

export function playerRole(player: PlayerSummary): string {
  return player.isHero ? "you" : "other player";
}

export function zoneDisplayName(zone: Pick<ZoneSummary, "zoneName" | "owner">): string {
  if (!zone.owner || zone.owner.index === undefined || zone.owner.index < 0) return zone.zoneName;
  const owner = zone.owner.isHero ? "your" : playerDisplayName(zone.owner);
  return `${owner} ${zone.zoneName}`;
}

export function prioritizedZones(zones: ZoneKnowledge[]): ZoneKnowledge[] {
  const rank = (zoneName: string): number => {
    const index = ZONE_DISPLAY_ORDER.indexOf(zoneName);
    return index === -1 ? 999 : index;
  };
  return [...zones].sort((a, b) => rank(a.zoneName) - rank(b.zoneName) || a.zoneKey.localeCompare(b.zoneKey));
}
