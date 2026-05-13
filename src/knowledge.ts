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

export type LocationCandidateGroup = {
  zoneKeys: string[];
  zoneNames: string[];
  knownCards: CardCounter;
  totalCount: number;
  outsideCount: number;
};

export type PlayerDeckKnowledge = {
  player: PlayerSummary;
  confidence: "partial" | "observed";
  totalKnownOwned: CardCounter;
  totalUnknownOwned: number;
  zones: ZoneKnowledge[];
  ambiguousLocationGroups: AmbiguousLocationGroup[];
  locationCandidateGroups: LocationCandidateGroup[];
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
  locationCandidateGroups: LocationCandidateGroup[];
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

function countersEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [card, count] of a) {
    if (b.get(card) !== count) return false;
  }
  return true;
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
  if (zone.zoneName === "DrawZone") return cards;
  for (const stack of zone.stacks) {
    for (const card of stack.cards) increment(cards, card.name);
  }
  return cards;
}

function visibleUnknownCount(zone: ZoneDetail): number {
  if (zone.zoneName === "DrawZone") return zone.stacks.reduce((total, stack) => total + stack.cardCount, 0);
  return zone.stacks.reduce((total, stack) => total + stack.anonymousCards, 0);
}

function playerKey(player: PlayerSummary | undefined): string | undefined {
  if (!player) return undefined;
  if (player.index !== undefined) return player.index >= 0 ? String(player.index) : undefined;
  return player.name;
}

export function cardNamesForMove(move: CardMoveSummary): string[] {
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

function isControlledOnlyZone(zone: Pick<MutableZoneKnowledge, "zoneName">): boolean {
  return zone.zoneName === "InPlayZone";
}

export class DeckKnowledgeTracker {
  private readonly players = new Map<string, MutablePlayerKnowledge>();
  private locationIdentityRepairEnabled = false;
  private initialized = false;
  private gameInstanceId: string | undefined;

  setLocationIdentityRepairEnabled(enabled: boolean): void {
    this.locationIdentityRepairEnabled = enabled;
    if (enabled) {
      for (const player of this.players.values()) {
        this.identifyUnknownOwnedCardsFromLocations(player, { includeControlledOnlyZones: false });
      }
    }
  }

  isLocationIdentityRepairEnabled(): boolean {
    return this.locationIdentityRepairEnabled;
  }

  applySnapshot(snapshot: NavigatorSnapshot): void {
    if (!this.initialized || this.gameInstanceId !== snapshot.gameInstanceId) {
      this.initializeFromSnapshot(snapshot);
      return;
    }

    for (const zone of snapshot.playerZones) {
      this.upsertZoneFromSnapshot(zone);
    }
    this.pruneZonesMissingFromSnapshot(snapshot);
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
      else if (fromOwned && fromPlayerKey === toPlayerKey) this.identifyUnknownOwnedCardsFromLocations(toPlayer);
    }

    if (fromPlayerKey && fromOwned && (!toOwned || fromPlayerKey !== toPlayerKey)) {
      const fromPlayer = this.players.get(fromPlayerKey);
      if (fromPlayer) this.removeFromOwnedLedger(fromPlayer, names, count);
    }
  }

  markKnownCardInZone(playerSummary: PlayerSummary | undefined, zoneName: string, cardName: string): boolean {
    const key = playerKey(playerSummary);
    if (!key) return false;
    const player = this.players.get(key);
    if (!player) return false;
    const zone = [...player.zones.values()].find((item) => item.zoneName === zoneName);
    if (!zone || zone.unknownCount <= 0) return false;

    zone.unknownCount -= 1;
    increment(zone.knownCards, cardName);

    this.identifyUnknownOwnedCardsFromLocations(player, { includeControlledOnlyZones: false });
    return true;
  }

  markKnownCardsInZone(
    playerSummary: PlayerSummary | undefined,
    zoneName: string,
    cardNames: string[],
    options: { idempotent?: boolean } = {}
  ): boolean {
    const key = playerKey(playerSummary);
    if (!key) return false;
    const player = this.players.get(key);
    if (!player) return false;
    const zone = [...player.zones.values()].find((item) => item.zoneName === zoneName);
    if (!zone) return false;

    const required = counterFromNames(cardNames);
    const idempotent = options.idempotent ?? true;
    let changed = false;
    let alreadySatisfied = required.size > 0;

    for (const [cardName, requiredCount] of required) {
      const currentCount = zone.knownCards.get(cardName) ?? 0;
      if (idempotent && currentCount >= requiredCount) continue;
      const remainingRequired = idempotent ? requiredCount - currentCount : requiredCount;
      alreadySatisfied = false;

      const revealCount = Math.min(remainingRequired, zone.unknownCount);
      if (revealCount <= 0) continue;
      zone.unknownCount -= revealCount;
      increment(zone.knownCards, cardName, revealCount);
      changed = true;
    }

    if (!changed) return alreadySatisfied;

    this.identifyUnknownOwnedCardsFromLocations(player, { includeControlledOnlyZones: false });
    this.updateConfidence(player);
    return true;
  }

  markExactKnownCardsInZone(playerSummary: PlayerSummary | undefined, zoneName: string, cardNames: string[]): boolean {
    const key = playerKey(playerSummary);
    if (!key) return false;
    const player = this.players.get(key);
    if (!player) return false;
    const zone = [...player.zones.values()].find((item) => item.zoneName === zoneName);
    if (!zone) return false;

    const nextKnownCards = counterFromNames(cardNames);
    const alreadySatisfied = zone.unknownCount === 0 && countersEqual(zone.knownCards, nextKnownCards);
    zone.knownCards = nextKnownCards;
    zone.unknownCount = 0;

    if (!alreadySatisfied) {
      this.identifyUnknownOwnedCardsFromLocations(player);
      this.updateConfidence(player);
    }
    return true;
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
      const key = playerKey(player.player);
      if (!key) continue;
      this.players.set(key, {
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
    for (const zone of snapshot.playerZones) this.upsertZoneFromSnapshot(zone, { includeEventSourced: true });
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

  private upsertZoneFromSnapshot(zone: ZoneDetail, options: { includeEventSourced?: boolean } = {}): void {
    if (!zone.owner) return;
    if (!options.includeEventSourced && isEventSourcedZone(zone.zoneName)) return;

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

    const shouldPreserveAnonymousSnapshotKnowledge = !(zone.zoneName === "DrawZone" && player.player.isHero);
    if (
      shouldPreserveAnonymousSnapshotKnowledge &&
      existing &&
      snapshotIsAnonymousOnly &&
      existingKnownCount > 0 &&
      unknownCount >= existingKnownCount
    ) {
      zoneKnowledge.knownCards = cloneCounter(existing.knownCards);
      zoneKnowledge.unknownCount = unknownCount - existingKnownCount;
    } else {
      zoneKnowledge.knownCards = knownCards;
      zoneKnowledge.unknownCount = unknownCount;
    }
    player.zones.set(key, zoneKnowledge);

    this.identifyUnknownOwnedCardsFromLocations(player, { includeControlledOnlyZones: false });
  }

  private pruneZonesMissingFromSnapshot(snapshot: NavigatorSnapshot): void {
    const visibleZoneKeys = new Set(snapshot.playerZones.map(zoneKey));
    for (const player of this.players.values()) {
      for (const [key, zone] of player.zones) {
        if (visibleZoneKeys.has(key)) continue;
        if (isEventSourcedZone(zone.zoneName)) {
          const replacementKey = this.visibleReplacementZoneKey(snapshot, player, zone);
          if (replacementKey && replacementKey !== key) this.moveZoneKnowledge(player, key, replacementKey);
          continue;
        }
        player.zones.delete(key);
      }
    }
  }

  private visibleReplacementZoneKey(snapshot: NavigatorSnapshot, player: MutablePlayerKnowledge, zone: MutableZoneKnowledge): string | undefined {
    const matches = snapshot.playerZones.filter((item) => item.zoneName === zone.zoneName && playerKey(item.owner) === playerKey(player.player));
    return matches.length === 1 ? zoneKey(matches[0]!) : undefined;
  }

  private moveZoneKnowledge(player: MutablePlayerKnowledge, fromKey: string, toKey: string): void {
    const from = player.zones.get(fromKey);
    if (!from) return;

    const existing = player.zones.get(toKey);
    if (existing) {
      addCounter(existing.knownCards, from.knownCards);
      existing.unknownCount += from.unknownCount;
    } else {
      player.zones.set(toKey, {
        ...from,
        zoneKey: toKey
      });
    }
    player.zones.delete(fromKey);
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
    for (const name of names) {
      const knownInSource = (from.knownCards.get(name) ?? 0) > 0;
      const removedFromSource = this.removeNamedCardFromZone(from, name);
      if (removedFromSource && !knownInSource && this.shouldRemoveStaleNamedLocation(player, name)) {
        this.anonymizeNamedCardInAnyZone(player, name);
      } else if (!removedFromSource && this.shouldRemoveStaleNamedLocation(player, name)) {
        this.removeNamedCardFromAnyZone(player, name);
      }
    }
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
    this.updateConfidence(player);
  }

  private identifyUnknownOwnedCardsFromLocations(player: MutablePlayerKnowledge, options: { includeControlledOnlyZones?: boolean } = {}): void {
    if (!this.locationIdentityRepairEnabled) {
      this.updateConfidence(player);
      return;
    }

    const locatedKnown = new Map<string, number>();
    for (const zone of player.zones.values()) {
      if (options.includeControlledOnlyZones === false && isControlledOnlyZone(zone)) continue;
      addCounter(locatedKnown, zone.knownCards);
    }

    for (const [card, count] of locatedKnown) {
      const knownOwned = player.totalKnownOwned.get(card) ?? 0;
      if (count <= knownOwned) continue;
      // Location evidence can identify anonymous owned cards, but only gain/loss moves change total ownership.
      const delta = Math.min(count - knownOwned, player.totalUnknownOwned);
      if (delta <= 0) continue;
      increment(player.totalKnownOwned, card, delta);
      player.totalUnknownOwned = Math.max(0, player.totalUnknownOwned - delta);
    }

    this.updateConfidence(player);
  }

  private addToOwnedLedger(player: MutablePlayerKnowledge, names: string[], count: number): void {
    for (const name of names) increment(player.totalKnownOwned, name);
    player.totalUnknownOwned += Math.max(0, count - names.length);
    this.updateConfidence(player);
  }

  private removeFromOwnedLedger(player: MutablePlayerKnowledge, names: string[], count: number): void {
    for (const name of names) {
      if ((player.totalKnownOwned.get(name) ?? 0) > 0) {
        decrement(player.totalKnownOwned, name);
      } else {
        player.totalUnknownOwned = Math.max(0, player.totalUnknownOwned - 1);
      }
    }
    const unknownCount = Math.max(0, count - names.length);
    player.totalUnknownOwned = Math.max(0, player.totalUnknownOwned - unknownCount);
    this.updateConfidence(player);
  }

  private updateConfidence(player: MutablePlayerKnowledge): void {
    player.confidence = player.totalUnknownOwned === 0 ? "observed" : "partial";
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

  private removeNamedCardFromZone(zone: MutableZoneKnowledge, name: string): boolean {
    if ((zone.knownCards.get(name) ?? 0) > 0) {
      decrement(zone.knownCards, name);
      return true;
    }

    if (zone.unknownCount > 0) {
      zone.unknownCount -= 1;
      return true;
    }

    return false;
  }

  private shouldRemoveStaleNamedLocation(player: MutablePlayerKnowledge, name: string): boolean {
    if (player.totalUnknownOwned > 0) return false;
    const locatedKnown = [...player.zones.values()].reduce((total, zone) => total + (zone.knownCards.get(name) ?? 0), 0);
    return locatedKnown >= (player.totalKnownOwned.get(name) ?? 0);
  }

  private removeNamedCardFromAnyZone(player: MutablePlayerKnowledge, name: string): void {
    for (const zone of player.zones.values()) {
      if ((zone.knownCards.get(name) ?? 0) <= 0) continue;
      decrement(zone.knownCards, name);
      return;
    }
  }

  private anonymizeNamedCardInAnyZone(player: MutablePlayerKnowledge, name: string): void {
    for (const zone of player.zones.values()) {
      if ((zone.knownCards.get(name) ?? 0) <= 0) continue;
      decrement(zone.knownCards, name);
      zone.unknownCount += 1;
      return;
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

    if (player.totalUnknownOwned > 0) return { zones, ambiguousLocationGroups: [], locationCandidateGroups: [] };

    this.deriveHeroDrawZoneFromOwnedRemainder(player, zones);

    const zonesWithAnonymousCards = zones.filter((zone) => zone.unknownCount > 0);
    if (zonesWithAnonymousCards.length === 0) return { zones, ambiguousLocationGroups: [], locationCandidateGroups: [] };

    const anonymousTotal = zonesWithAnonymousCards.reduce((total, zone) => total + zone.unknownCount, 0);

    const remainder = cloneCounter(player.totalKnownOwned);
    for (const zone of zones) {
      subtractCounterUpToAvailable(remainder, zone.knownCards);
    }

    const remainderTotal = mapTotal(remainder);
    if (remainderTotal < anonymousTotal) return { zones, ambiguousLocationGroups: [], locationCandidateGroups: [] };

    if (zonesWithAnonymousCards.length === 1) {
      const zone = zonesWithAnonymousCards[0]!;
      if (remainderTotal === anonymousTotal) {
        addCounter(zone.knownCards, remainder);
        zone.unknownCount = 0;
        return { zones, ambiguousLocationGroups: [], locationCandidateGroups: [] };
      }

      return {
        zones,
        ambiguousLocationGroups: [],
        locationCandidateGroups: [
          {
            zoneKeys: [zone.zoneKey],
            zoneNames: [zone.zoneName],
            knownCards: toObject(remainder),
            totalCount: anonymousTotal,
            outsideCount: remainderTotal - anonymousTotal
          }
        ]
      };
    }

    if (remainderTotal > anonymousTotal) {
      return {
        zones,
        ambiguousLocationGroups: [],
        locationCandidateGroups: [
          {
            zoneKeys: zonesWithAnonymousCards.map((zone) => zone.zoneKey),
            zoneNames: [...new Set(zonesWithAnonymousCards.map((zone) => zone.zoneName))],
            knownCards: toObject(remainder),
            totalCount: anonymousTotal,
            outsideCount: remainderTotal - anonymousTotal
          }
        ]
      };
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

    return { zones, ambiguousLocationGroups, locationCandidateGroups: [] };
  }

  private deriveHeroDrawZoneFromOwnedRemainder(player: MutablePlayerKnowledge, zones: DerivedZoneKnowledge[]): void {
    if (!player.player.isHero) return;

    const drawZones = zones.filter((zone) => zone.zoneName === "DrawZone");
    if (drawZones.length !== 1) return;

    const nonDrawUnknownCount = zones
      .filter((zone) => zone.zoneName !== "DrawZone")
      .reduce((total, zone) => total + zone.unknownCount + zone.ambiguousCount, 0);
    if (nonDrawUnknownCount > 0) return;

    const remainder = cloneCounter(player.totalKnownOwned);
    for (const zone of zones) {
      if (zone.zoneName === "DrawZone") continue;
      subtractCounterUpToAvailable(remainder, zone.knownCards);
    }

    const drawZone = drawZones[0]!;
    drawZone.knownCards = remainder;
    drawZone.unknownCount = 0;
    drawZone.ambiguousCount = 0;
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
      locationCandidateGroups: derived.locationCandidateGroups,
      unlocatedKnownCards: toObject(unlocatedKnownCards),
      unknownLocatedCount
    };
  }
}
