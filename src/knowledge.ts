import { CardMoveSummary, NavigatorSnapshot, PlayerSummary, ZoneDetail, ZoneSummary } from "./messages";

export type CardCounter = Record<string, number>;

export type ZoneKnowledge = {
  zoneKey: string;
  zoneName: string;
  knownCards: CardCounter;
  unknownCount: number;
  ambiguousCount: number;
  totalCount: number;
};

export type AmbiguousLocationGroup = {
  zoneKeys: string[];
  zoneNames: string[];
  knownCards: CardCounter;
  totalCount: number;
};

export type PlayerDeckKnowledge = {
  player: PlayerSummary;
  confidence: "partial" | "observed";
  totalKnownOwned: CardCounter;
  totalUnknownOwned: number;
  zones: ZoneKnowledge[];
  ambiguousLocationGroups: AmbiguousLocationGroup[];
  unlocatedKnownCards: CardCounter;
  unknownLocatedCount: number;
};

export type KnowledgeSummary = {
  players: PlayerDeckKnowledge[];
};

export type SerializedZoneKnowledge = {
  zoneKey: string;
  zoneName: string;
  knownCards: CardCounter;
  unknownCount: number;
};

export type SerializedPlayerKnowledge = {
  key: string;
  player: PlayerSummary;
  confidence: "partial" | "observed";
  totalKnownOwned: CardCounter;
  totalUnknownOwned: number;
  zones: SerializedZoneKnowledge[];
};

export type SerializedDeckKnowledgeTracker = {
  version: 1;
  initialized: boolean;
  gameInstanceId?: string;
  players: SerializedPlayerKnowledge[];
};

type MutablePlayerKnowledge = {
  player: PlayerSummary;
  confidence: "partial" | "observed";
  totalKnownOwned: Map<string, number>;
  totalUnknownOwned: number;
  zones: Map<string, MutableZoneKnowledge>;
};

type MutableZoneKnowledge = {
  zoneKey: string;
  zoneName: string;
  knownCards: Map<string, number>;
  unknownCount: number;
};

type DerivedZoneKnowledge = {
  zoneKey: string;
  zoneName: string;
  knownCards: Map<string, number>;
  unknownCount: number;
  ambiguousCount: number;
};

type DerivedKnowledge = {
  zones: DerivedZoneKnowledge[];
  ambiguousLocationGroups: AmbiguousLocationGroup[];
};

function increment(counter: Map<string, number>, cardName: string, amount = 1): void {
  counter.set(cardName, (counter.get(cardName) ?? 0) + amount);
}

function decrement(counter: Map<string, number>, cardName: string, amount = 1): void {
  const next = (counter.get(cardName) ?? 0) - amount;
  if (next > 0) counter.set(cardName, next);
  else counter.delete(cardName);
}

function toObject(counter: Map<string, number>): CardCounter {
  return Object.fromEntries([...counter.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function mapTotal(counter: Map<string, number>): number {
  return [...counter.values()].reduce((total, count) => total + count, 0);
}

function cloneCounter(counter: Map<string, number>): Map<string, number> {
  return new Map(counter);
}

function addCounter(target: Map<string, number>, source: Map<string, number>): void {
  for (const [card, count] of source) increment(target, card, count);
}

function subtractCounter(target: Map<string, number>, source: Map<string, number>): boolean {
  for (const [card, count] of source) {
    const current = target.get(card) ?? 0;
    if (current < count) return false;
    decrement(target, card, count);
  }
  return true;
}

function subtractCounterUpToAvailable(target: Map<string, number>, source: Map<string, number>): void {
  for (const [card, count] of source) {
    const current = target.get(card) ?? 0;
    decrement(target, card, Math.min(current, count));
  }
}

function counterFromNames(names: string[]): Map<string, number> {
  const counter = new Map<string, number>();
  for (const name of names) increment(counter, name);
  return counter;
}

function counterFromObject(counter: CardCounter): Map<string, number> {
  const restored = new Map<string, number>();
  for (const [card, count] of Object.entries(counter)) {
    if (count > 0) restored.set(card, count);
  }
  return restored;
}

function zoneKey(zone: Pick<ZoneSummary, "index" | "zoneName">): string {
  return `${zone.index}:${zone.zoneName}`;
}

function visibleZoneCards(zone: ZoneDetail): Map<string, number> {
  const cards = new Map<string, number>();
  for (const stack of zone.stacks) {
    for (const card of stack.cards) increment(cards, card.name);
  }
  return cards;
}

function visibleUnknownCount(zone: ZoneDetail): number {
  return zone.stacks.reduce((total, stack) => total + stack.anonymousCards, 0);
}

function playerKey(player: PlayerSummary | undefined): string | undefined {
  if (!player) return undefined;
  if (player.index !== undefined) return String(player.index);
  return player.name;
}

function cardNamesForMove(move: CardMoveSummary): string[] {
  const revealedAfter = move.cardsAfterMoving.filter((name) => name !== "Anonymous" && name !== "Unknown");
  const revealedBefore = move.cards.filter((name) => name !== "Anonymous" && name !== "Unknown");

  if (hasPlayerOwner(move.from) && revealedBefore.length > revealedAfter.length) return revealedBefore;
  if (revealedAfter.length > 0) return revealedAfter;
  if (revealedBefore.length > 0) return revealedBefore;

  if (isPlayerOwnedAnonymousMove(move)) return [];

  const movedCount = rawCardCountForMove(move);
  const fromTopCard = move.from?.topCards.length === 1 ? move.from.topCards[0] : undefined;
  if (fromTopCard && fromTopCard !== "Back") return Array.from({ length: movedCount }, () => fromTopCard);

  const toTopCard = move.to?.topCards.length === 1 ? move.to.topCards[0] : undefined;
  if (toTopCard && toTopCard !== "Back") return Array.from({ length: movedCount }, () => toTopCard);

  return [];
}

function rawCardCountForMove(move: CardMoveSummary): number {
  return Math.max(move.cardIds.length, move.cardIdsAfterMoving.length);
}

function cardCountForMove(move: CardMoveSummary): number {
  return Math.max(rawCardCountForMove(move), cardNamesForMove(move).length);
}

function isAnonymousName(name: string): boolean {
  return name === "Anonymous" || name === "Unknown";
}

function isAnonymousMove(move: CardMoveSummary): boolean {
  const names = [...move.cards, ...move.cardsAfterMoving];
  return names.length > 0 && names.every(isAnonymousName);
}

function isPlayerOwnedAnonymousMove(move: CardMoveSummary): boolean {
  return isAnonymousMove(move) && hasPlayerOwner(move.from) && hasPlayerOwner(move.to);
}

function hasPlayerOwner(zone: ZoneSummary | undefined): boolean {
  return zone?.owner?.index !== undefined && zone.owner.index >= 0;
}

function isEventSourcedZone(zoneName: string): boolean {
  return zoneName === "DiscardZone";
}

function isControlledOnlyDestination(zone: ZoneSummary | undefined): boolean {
  return zone?.zoneName === "InPlayZone";
}

export class DeckKnowledgeTracker {
  private readonly players = new Map<string, MutablePlayerKnowledge>();
  private initialized = false;
  private gameInstanceId: string | undefined;

  applySnapshot(snapshot: NavigatorSnapshot): void {
    if (!this.initialized || this.gameInstanceId !== snapshot.gameInstanceId) {
      this.initializeFromSnapshot(snapshot);
      return;
    }

    for (const zone of snapshot.playerZones) {
      this.upsertZoneFromSnapshot(zone);
    }
  }

  applyMove(move: CardMoveSummary): void {
    if (move.phase !== "after") return;

    const names = cardNamesForMove(move);
    const count = cardCountForMove(move);
    const fromPlayerKey = playerKey(move.from?.owner);
    const toPlayerKey = playerKey(move.to?.owner);
    const fromOwned = hasPlayerOwner(move.from);
    const toOwned = hasPlayerOwner(move.to);

    if (fromPlayerKey && move.from) {
      const fromPlayer = this.players.get(fromPlayerKey);
      if (fromPlayer) this.removeFromZone(fromPlayer, move.from, names, count);
    }

    if (toPlayerKey && move.to) {
      const toPlayer = this.ensurePlayer(move.to.owner);
      this.addToZone(toPlayer, move.to, names, count);

      if ((!fromOwned || fromPlayerKey !== toPlayerKey) && !isControlledOnlyDestination(move.to)) this.addToOwnedLedger(toPlayer, names, count);
    }

    if (fromPlayerKey && fromOwned && (!toOwned || fromPlayerKey !== toPlayerKey)) {
      const fromPlayer = this.players.get(fromPlayerKey);
      if (fromPlayer) this.removeFromOwnedLedger(fromPlayer, names, count);
    }
  }

  summary(): KnowledgeSummary {
    return {
      players: [...this.players.values()].map((player) => this.summarizePlayer(player))
    };
  }

  serialize(): SerializedDeckKnowledgeTracker {
    return {
      version: 1,
      initialized: this.initialized,
      ...(this.gameInstanceId ? { gameInstanceId: this.gameInstanceId } : {}),
      players: [...this.players.entries()].map(([key, player]) => ({
        key,
        player: player.player,
        confidence: player.confidence,
        totalKnownOwned: toObject(player.totalKnownOwned),
        totalUnknownOwned: player.totalUnknownOwned,
        zones: [...player.zones.values()].map((zone) => ({
          zoneKey: zone.zoneKey,
          zoneName: zone.zoneName,
          knownCards: toObject(zone.knownCards),
          unknownCount: zone.unknownCount
        }))
      }))
    };
  }

  restore(serialized: SerializedDeckKnowledgeTracker): void {
    this.players.clear();
    this.initialized = serialized.initialized;
    this.gameInstanceId = serialized.gameInstanceId;

    for (const player of serialized.players) {
      this.players.set(player.key, {
        player: player.player,
        confidence: player.confidence,
        totalKnownOwned: counterFromObject(player.totalKnownOwned),
        totalUnknownOwned: player.totalUnknownOwned,
        zones: new Map(
          player.zones.map((zone) => [
            zone.zoneKey,
            {
              zoneKey: zone.zoneKey,
              zoneName: zone.zoneName,
              knownCards: counterFromObject(zone.knownCards),
              unknownCount: zone.unknownCount
            }
          ])
        )
      });
    }
  }

  restoreForSnapshot(serialized: SerializedDeckKnowledgeTracker, snapshot: NavigatorSnapshot): void {
    this.restore(serialized);
    this.initialized = true;
    this.gameInstanceId = snapshot.gameInstanceId;
    this.applySnapshot(snapshot);
  }

  private initializeFromSnapshot(snapshot: NavigatorSnapshot): void {
    this.players.clear();
    this.gameInstanceId = snapshot.gameInstanceId;
    for (const player of snapshot.players) this.ensurePlayer(player).confidence = "partial";
    for (const zone of snapshot.playerZones) this.upsertZoneFromSnapshot(zone);
    for (const player of this.players.values()) this.recomputeKnownOwnedFromZones(player);
    this.seedStartingDecks(snapshot);
    this.initialized = true;
  }

  private ensurePlayer(player: PlayerSummary | undefined): MutablePlayerKnowledge {
    const key = playerKey(player) ?? "unknown";
    const existing = this.players.get(key);
    if (existing) return existing;

    const fallback: PlayerSummary = player ?? { name: "unknown", isHero: false };
    const created: MutablePlayerKnowledge = {
      player: fallback,
      confidence: "partial",
      totalKnownOwned: new Map(),
      totalUnknownOwned: 0,
      zones: new Map()
    };
    this.players.set(key, created);
    return created;
  }

  private upsertZoneFromSnapshot(zone: ZoneDetail): void {
    if (!zone.owner) return;
    if (isEventSourcedZone(zone.zoneName)) return;

    const player = this.ensurePlayer(zone.owner);
    const key = zoneKey(zone);
    const knownCards = visibleZoneCards(zone);
    const unknownCount = visibleUnknownCount(zone);
    const existing = player.zones.get(key);
    const zoneKnowledge: MutableZoneKnowledge = existing ?? {
      zoneKey: key,
      zoneName: zone.zoneName,
      knownCards: new Map(),
      unknownCount: 0
    };

    const existingKnownCount = existing ? mapTotal(existing.knownCards) : 0;
    const snapshotIsAnonymousOnly = knownCards.size === 0 && unknownCount > 0;

    if (existing && snapshotIsAnonymousOnly && existingKnownCount > 0 && unknownCount >= existingKnownCount) {
      zoneKnowledge.knownCards = cloneCounter(existing.knownCards);
      zoneKnowledge.unknownCount = unknownCount - existingKnownCount;
    } else {
      zoneKnowledge.knownCards = knownCards;
      zoneKnowledge.unknownCount = unknownCount;
    }
    player.zones.set(key, zoneKnowledge);

    for (const [card, count] of zoneKnowledge.knownCards) {
      const currentKnownOwned = player.totalKnownOwned.get(card) ?? 0;
      if (count > currentKnownOwned) player.totalKnownOwned.set(card, count);
    }
  }

  private getOrCreateZone(player: MutablePlayerKnowledge, zone: ZoneSummary): MutableZoneKnowledge {
    const key = zoneKey(zone);
    const existing = player.zones.get(key);
    if (existing) return existing;
    const created: MutableZoneKnowledge = {
      zoneKey: key,
      zoneName: zone.zoneName,
      knownCards: new Map(),
      unknownCount: 0
    };
    player.zones.set(key, created);
    return created;
  }

  private removeFromZone(player: MutablePlayerKnowledge, zone: ZoneSummary, names: string[], count: number): void {
    const from = this.getOrCreateZone(player, zone);
    for (const name of names) this.removeNamedCardFromZone(from, name);
    const unknownToRemove = Math.max(0, count - names.length);
    this.removeUnknownOrAnonymizeKnown(from, unknownToRemove);
  }

  private addToZone(player: MutablePlayerKnowledge, zone: ZoneSummary, names: string[], count: number): void {
    const to = this.getOrCreateZone(player, zone);
    for (const name of names) increment(to.knownCards, name);
    to.unknownCount += Math.max(0, count - names.length);
  }

  private recomputeKnownOwnedFromZones(player: MutablePlayerKnowledge): void {
    player.totalKnownOwned.clear();
    player.totalUnknownOwned = 0;
    for (const zone of player.zones.values()) {
      for (const [card, count] of zone.knownCards) increment(player.totalKnownOwned, card, count);
      player.totalUnknownOwned += zone.unknownCount;
    }
    player.confidence = player.totalUnknownOwned === 0 ? "observed" : "partial";
  }

  private addToOwnedLedger(player: MutablePlayerKnowledge, names: string[], count: number): void {
    for (const name of names) increment(player.totalKnownOwned, name);
    player.totalUnknownOwned += Math.max(0, count - names.length);
  }

  private removeFromOwnedLedger(player: MutablePlayerKnowledge, names: string[], count: number): void {
    for (const name of names) decrement(player.totalKnownOwned, name);
    const unknownCount = Math.max(0, count - names.length);
    player.totalUnknownOwned = Math.max(0, player.totalUnknownOwned - unknownCount);
  }

  private removeUnknownOrAnonymizeKnown(zone: MutableZoneKnowledge, count: number): void {
    if (count <= 0) return;
    const fromUnknown = Math.min(zone.unknownCount, count);
    zone.unknownCount -= fromUnknown;
    let remaining = count - fromUnknown;

    for (const [card, cardCount] of [...zone.knownCards.entries()]) {
      if (remaining <= 0) return;
      const removed = Math.min(cardCount, remaining);
      decrement(zone.knownCards, card, removed);
      remaining -= removed;
    }
  }

  private removeNamedCardFromZone(zone: MutableZoneKnowledge, name: string): void {
    if ((zone.knownCards.get(name) ?? 0) > 0) {
      decrement(zone.knownCards, name);
      return;
    }

    if (zone.unknownCount > 0) {
      zone.unknownCount -= 1;
    }
  }

  private seedStartingDecks(snapshot: NavigatorSnapshot): void {
    if (!snapshot.startingDeck) return;
    const startingDeck = counterFromNames(snapshot.startingDeck);

    for (const player of this.players.values()) {
      if (!this.canSeedStartingDeck(player, startingDeck)) continue;
      player.totalKnownOwned = cloneCounter(startingDeck);
      player.totalUnknownOwned = 0;
      player.confidence = "observed";
    }
  }

  private canSeedStartingDeck(player: MutablePlayerKnowledge, startingDeck: Map<string, number>): boolean {
    const locatedKnown = new Map<string, number>();
    let locatedTotal = 0;

    for (const zone of player.zones.values()) {
      const zoneTotal = mapTotal(zone.knownCards) + zone.unknownCount;
      locatedTotal += zoneTotal;
      addCounter(locatedKnown, zone.knownCards);
    }

    if (locatedTotal !== mapTotal(startingDeck)) return false;

    const remainder = cloneCounter(startingDeck);
    return subtractCounter(remainder, locatedKnown);
  }

  private deriveZonesForSummary(player: MutablePlayerKnowledge): DerivedKnowledge {
    const zones = [...player.zones.values()].map((zone) => ({
      zoneKey: zone.zoneKey,
      zoneName: zone.zoneName,
      knownCards: cloneCounter(zone.knownCards),
      unknownCount: zone.unknownCount,
      ambiguousCount: 0
    }));

    if (player.totalUnknownOwned > 0) return { zones, ambiguousLocationGroups: [] };

    const zonesWithAnonymousCards = zones.filter((zone) => zone.unknownCount > 0);
    if (zonesWithAnonymousCards.length === 0) return { zones, ambiguousLocationGroups: [] };

    const anonymousTotal = zonesWithAnonymousCards.reduce((total, zone) => total + zone.unknownCount, 0);

    const remainder = cloneCounter(player.totalKnownOwned);
    for (const zone of zones) {
      subtractCounterUpToAvailable(remainder, zone.knownCards);
    }

    if (mapTotal(remainder) !== anonymousTotal) return { zones, ambiguousLocationGroups: [] };

    if (zonesWithAnonymousCards.length === 1) {
      const zone = zonesWithAnonymousCards[0]!;
      addCounter(zone.knownCards, remainder);
      zone.unknownCount = 0;
      return { zones, ambiguousLocationGroups: [] };
    }

    const ambiguousLocationGroups = [
      {
        zoneKeys: zonesWithAnonymousCards.map((zone) => zone.zoneKey),
        zoneNames: [...new Set(zonesWithAnonymousCards.map((zone) => zone.zoneName))],
        knownCards: toObject(remainder),
        totalCount: anonymousTotal
      }
    ];

    for (const zone of zonesWithAnonymousCards) {
      zone.ambiguousCount = zone.unknownCount;
      zone.unknownCount = 0;
    }

    return { zones, ambiguousLocationGroups };
  }

  private summarizePlayer(player: MutablePlayerKnowledge): PlayerDeckKnowledge {
    const derived = this.deriveZonesForSummary(player);
    const zoneKnownTotals = new Map<string, number>();
    let unknownLocatedCount = 0;
    const zones = derived.zones
      .map((zone) => {
        for (const [card, count] of zone.knownCards) increment(zoneKnownTotals, card, count);
        unknownLocatedCount += zone.unknownCount;
        const totalCount = mapTotal(zone.knownCards) + zone.unknownCount + zone.ambiguousCount;
        return {
          zoneKey: zone.zoneKey,
          zoneName: zone.zoneName,
          knownCards: toObject(zone.knownCards),
          unknownCount: zone.unknownCount,
          ambiguousCount: zone.ambiguousCount,
          totalCount
        };
      })
      .filter((zone) => zone.totalCount > 0)
      .sort((a, b) => a.zoneName.localeCompare(b.zoneName) || a.zoneKey.localeCompare(b.zoneKey));

    for (const group of derived.ambiguousLocationGroups) {
      for (const [card, count] of Object.entries(group.knownCards)) increment(zoneKnownTotals, card, count);
    }

    const unlocatedKnownCards = new Map<string, number>();
    for (const [card, count] of player.totalKnownOwned) {
      const unlocated = count - (zoneKnownTotals.get(card) ?? 0);
      if (unlocated > 0) unlocatedKnownCards.set(card, unlocated);
    }

    return {
      player: player.player,
      confidence: player.confidence,
      totalKnownOwned: toObject(player.totalKnownOwned),
      totalUnknownOwned: player.totalUnknownOwned,
      zones,
      ambiguousLocationGroups: derived.ambiguousLocationGroups,
      unlocatedKnownCards: toObject(unlocatedKnownCards),
      unknownLocatedCount
    };
  }
}
