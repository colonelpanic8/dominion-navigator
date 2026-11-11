import { CardCounter, findPlayerKnowledge, KnowledgeSummary, PlayerDeckKnowledge, samePlayerIdentity, ZoneKnowledge, zoneKey } from "../knowledge";
import { BoundsSummary, DrawKnowledgeWindowPayload, KnowledgePileSummary, KnowledgeWindowCardSummary, NavigatorSnapshot, ZoneDetail } from "../messages";
import { playerDisplayName, sortedCounterEntries } from "./formatting";

function emptyPile(): KnowledgePileSummary {
  return { cards: [], unknownCount: 0 };
}

function isActiveDeckZone(zoneName: string): boolean {
  return zoneName === "DrawZone" || zoneName === "DiscardZone";
}

function counterToWindowCards(counter: CardCounter): KnowledgeWindowCardSummary[] {
  return sortedCounterEntries(counter)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ name, count }));
}

function rawUnknownCount(zone: ZoneDetail): number {
  return zone.stacks.reduce((total, stack) => total + stack.anonymousCards, 0);
}

function visibleCardCounter(zone: ZoneDetail): CardCounter {
  const counter: CardCounter = {};
  for (const stack of zone.stacks) {
    for (const card of stack.cards) counter[card.name] = (counter[card.name] ?? 0) + 1;
  }
  return counter;
}

function trackedZonePile(trackedZone: ZoneKnowledge, player: PlayerDeckKnowledge | undefined): KnowledgePileSummary {
  const exactCards = counterToWindowCards(trackedZone.knownCards);
  const unknownCount = trackedZone.unknownCount + trackedZone.ambiguousCount;
  if (exactCards.length > 0) return { cards: exactCards, unknownCount };

  const candidateGroup = player?.locationCandidateGroups.find((group) => group.zoneKeys.includes(trackedZone.zoneKey));
  const ambiguousGroup = player?.ambiguousLocationGroups.find((group) => group.zoneKeys.includes(trackedZone.zoneKey));
  const candidateCards = counterToWindowCards(candidateGroup?.knownCards ?? ambiguousGroup?.knownCards ?? {});
  if (candidateCards.length > 0) return { cards: candidateCards, unknownCount: 0 };

  return { cards: [], unknownCount };
}

function zonePile(zone: ZoneDetail, summary: KnowledgeSummary): KnowledgePileSummary {
  const player = findPlayerKnowledge(summary, zone.owner);
  const key = zoneKey(zone);
  const trackedZone = player?.zones.find((item) => item.zoneKey === key);
  if (!trackedZone) {
    return {
      cards: counterToWindowCards(visibleCardCounter(zone)),
      unknownCount: rawUnknownCount(zone)
    };
  }

  return trackedZonePile(trackedZone, player);
}

function combinePiles(piles: KnowledgePileSummary[]): KnowledgePileSummary {
  const cards: CardCounter = {};
  let unknownCount = 0;

  for (const pile of piles) {
    for (const item of pile.cards) cards[item.name] = (cards[item.name] ?? 0) + item.count;
    unknownCount += pile.unknownCount;
  }

  return { cards: counterToWindowCards(cards), unknownCount };
}

function combineTrackedZones(zones: ZoneKnowledge[]): KnowledgePileSummary {
  const cards: CardCounter = {};
  let unknownCount = 0;

  for (const zone of zones) {
    for (const [name, count] of Object.entries(zone.knownCards)) cards[name] = (cards[name] ?? 0) + count;
    unknownCount += zone.unknownCount + zone.ambiguousCount;
  }

  return { cards: counterToWindowCards(cards), unknownCount };
}

/** The pile named `zoneName` belonging to the owner of `sourceZone`, preferring the live snapshot. */
function ownerPile(zoneName: string, sourceZone: ZoneDetail, summary: KnowledgeSummary, snapshot: NavigatorSnapshot): KnowledgePileSummary {
  const rawZone = snapshot.playerZones
    .filter((zone) => zone.zoneName === zoneName && samePlayerIdentity(zone.owner, sourceZone.owner))
    .sort((a, b) => b.cardCount - a.cardCount || a.index - b.index)[0];
  if (rawZone) return zonePile(rawZone, summary);

  const player = findPlayerKnowledge(summary, sourceZone.owner);
  const trackedZone = player?.zones
    .filter((zone) => zone.zoneName === zoneName)
    .sort((a, b) => b.totalCount - a.totalCount || a.zoneKey.localeCompare(b.zoneKey))[0];
  if (trackedZone) return trackedZonePile(trackedZone, player);

  return emptyPile();
}

function excludedFromActiveDeckPile(sourceZone: ZoneDetail, summary: KnowledgeSummary, snapshot: NavigatorSnapshot): KnowledgePileSummary {
  const player = findPlayerKnowledge(summary, sourceZone.owner);
  if (player) return combineTrackedZones(player.zones.filter((zone) => !isActiveDeckZone(zone.zoneName)));

  return combinePiles(
    snapshot.playerZones
      .filter((zone) => !isActiveDeckZone(zone.zoneName) && samePlayerIdentity(zone.owner, sourceZone.owner))
      .map((zone) => zonePile(zone, summary))
  );
}

function entireDeckPile(sourceZone: ZoneDetail, summary: KnowledgeSummary): KnowledgePileSummary {
  const player = findPlayerKnowledge(summary, sourceZone.owner);
  if (!player) return emptyPile();
  return {
    cards: counterToWindowCards(player.totalKnownOwned),
    unknownCount: player.totalUnknownOwned
  };
}

export function buildDrawKnowledgeWindowPayload(
  sourceZone: ZoneDetail,
  summary: KnowledgeSummary,
  snapshot: NavigatorSnapshot
): DrawKnowledgeWindowPayload {
  const { cards, unknownCount } = ownerPile("DrawZone", sourceZone, summary, snapshot);
  return {
    sourceZoneIndex: sourceZone.index,
    playerName: playerDisplayName(sourceZone.owner),
    cards,
    unknownCount,
    discardPile: ownerPile("DiscardZone", sourceZone, summary, snapshot),
    excludedFromActiveDeck: excludedFromActiveDeckPile(sourceZone, summary, snapshot),
    entireDeck: entireDeckPile(sourceZone, summary)
  };
}

function boundsContainPoint(bounds: BoundsSummary, x: number, y: number): boolean {
  return x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height;
}

/** The draw or discard pile under a page click, topmost first. */
export function clickedKnowledgeZone(snapshot: NavigatorSnapshot, x: number, y: number): ZoneDetail | undefined {
  const hits = snapshot.playerZones
    .filter((zone) => isActiveDeckZone(zone.zoneName))
    .flatMap((zone) =>
      zone.stacks
        .filter((stack) => stack.bounds && boundsContainPoint(stack.bounds, x, y))
        .map((stack) => ({
          zone,
          zIndex: stack.bounds?.zIndex ?? 0,
          area: (stack.bounds?.width ?? 0) * (stack.bounds?.height ?? 0)
        }))
    );

  hits.sort((a, b) => b.zIndex - a.zIndex || a.area - b.area);
  return hits[0]?.zone;
}

export function heroDrawZone(snapshot: NavigatorSnapshot): ZoneDetail | undefined {
  return snapshot.heroZones
    .filter((zone) => zone.zoneName === "DrawZone")
    .sort((a, b) => b.cardCount - a.cardCount || a.index - b.index)[0];
}
