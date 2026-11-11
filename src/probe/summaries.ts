import {
  BoundsSummary,
  CardMoveSummary,
  CardSummary,
  NavigatorSnapshot,
  PlayerSummary,
  TurnSummary,
  ZoneDetail,
  ZoneStackSummary,
  ZoneSummary
} from "../messages";
import {
  dominion,
  RuntimeBounds,
  RuntimeCard,
  RuntimeCardMove,
  RuntimeCardName,
  RuntimeCardStack,
  RuntimeGame,
  RuntimePlayer,
  RuntimeTurn,
  RuntimeZone
} from "./runtime-types";

function runtimeType(value: unknown): string {
  if (value === null || value === undefined) return "Unknown";
  return Object.getPrototypeOf(value)?.constructor?.name || typeof value;
}

function summarizePlayer(player: RuntimePlayer | undefined): PlayerSummary | undefined {
  if (!player) return undefined;
  return {
    ...(player.index !== undefined ? { index: player.index } : {}),
    ...(player.name !== undefined ? { name: player.name } : {}),
    isHero: Boolean(player.isHero)
  };
}

function summarizeTurn(turn: RuntimeTurn | undefined): TurnSummary | undefined {
  if (!turn) return undefined;
  return {
    ...(turn.ownerId !== undefined ? { ownerId: turn.ownerId } : {}),
    ...(turn.turnNumber !== undefined ? { turnNumber: turn.turnNumber } : {}),
    ...(turn.controllerId !== undefined ? { controllerId: turn.controllerId } : {})
  };
}

function summarizeCard(card: RuntimeCard | undefined): CardSummary | undefined {
  if (!card || card.id === undefined) return undefined;
  return {
    id: card.id,
    name: card.cardName?.name ?? "Unknown"
  };
}

function summarizeBounds(bounds: RuntimeBounds | undefined): BoundsSummary | undefined {
  if (
    bounds?.x === undefined ||
    bounds.y === undefined ||
    bounds.width === undefined ||
    bounds.height === undefined ||
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return undefined;
  }

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    ...(bounds.zIndex !== undefined && Number.isFinite(bounds.zIndex) ? { zIndex: bounds.zIndex } : {})
  };
}

/** Draw piles are hidden information, so snapshots only report their size. */
function isSnapshotAnonymousZone(zoneName: string | undefined): boolean {
  return zoneName === "DrawZone";
}

function summarizeStack(stack: RuntimeCardStack, zoneName?: string): ZoneStackSummary {
  const bounds = summarizeBounds(stack.view?.bbox);
  if (isSnapshotAnonymousZone(zoneName)) {
    const cardCount = stack.cardCount ?? 0;
    return {
      cardCount,
      anonymousCards: cardCount,
      ...(cardCount > 0 ? { topCard: "Back" } : {}),
      ...(bounds ? { bounds } : {}),
      cards: []
    };
  }

  return {
    cardCount: stack.cardCount ?? 0,
    anonymousCards: stack.anonymousCards ?? 0,
    ...(stack.topCard?.cardName?.name !== undefined ? { topCard: stack.topCard.cardName.name } : {}),
    ...(bounds ? { bounds } : {}),
    cards: (stack.cards ?? []).map(summarizeCard).filter((card): card is CardSummary => Boolean(card))
  };
}

function effectiveStacks(zone: RuntimeZone): RuntimeCardStack[] {
  const stacks = zone.primaryStacks && zone.primaryStacks.length > 0 ? zone.primaryStacks : zone.cardStacks ?? [];
  return stacks.filter((stack): stack is RuntimeCardStack => Boolean(stack));
}

function effectiveCardCount(zone: RuntimeZone): number {
  return effectiveStacks(zone).reduce((total, stack) => total + (stack.cardCount ?? 0), 0);
}

function summarizeZone(zone: RuntimeZone | undefined): ZoneSummary | undefined {
  if (!zone || zone.index === undefined) return undefined;
  const owner = summarizePlayer(zone.owner);
  const stacks = effectiveStacks(zone);
  const zoneName = zone.zoneName ?? runtimeType(zone);
  const topCards = isSnapshotAnonymousZone(zoneName)
    ? stacks.filter((stack) => (stack.cardCount ?? 0) > 0).map(() => "Back")
    : stacks.map((stack) => stack.topCard?.cardName?.name).filter((name): name is string => Boolean(name));

  return {
    index: zone.index,
    zoneName,
    runtimeType: runtimeType(zone),
    ...(owner ? { owner } : {}),
    cardCount: effectiveCardCount(zone),
    stackCount: stacks.length,
    topCards
  };
}

function summarizeZoneDetail(zone: RuntimeZone): ZoneDetail | undefined {
  const summary = summarizeZone(zone);
  if (!summary) return undefined;
  return {
    ...summary,
    stacks: effectiveStacks(zone).map((stack) => summarizeStack(stack, summary.zoneName))
  };
}

function cardName(game: RuntimeGame, id: number): string {
  if (id === -1) return "Anonymous";
  return game.state?.cards?.[id]?.cardName?.name ?? "Unknown";
}

function setupCardNames(game: RuntimeGame): string[] {
  return [...new Set((game.state?.cardNames ?? []).map((card) => card.name).filter((name): name is string => Boolean(name)))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function hasCardType(card: RuntimeCardName | undefined, typeName: string): boolean {
  return Boolean(card?.types?.some((type) => type.name === typeName));
}

function startingDeck(game: RuntimeGame): string[] {
  const setupCards = game.state?.cardNames ?? [];
  const deck: string[] = [];
  const copper = dominion.CardNames?.COPPER?.name ?? "Copper";
  const estate = dominion.CardNames?.ESTATE?.name ?? "Estate";

  for (let index = 0; index < 7; index += 1) deck.push(copper);

  const shelters = setupCards.filter((card) => hasCardType(card, "Shelter"));
  if (shelters.length > 0) {
    for (const shelter of shelters) if (shelter.name) deck.push(shelter.name);
  } else {
    for (let index = 0; index < 3; index += 1) deck.push(estate);
  }

  for (const card of setupCards) {
    if (!card.hasHeirloom?.()) continue;
    const heirloom = dominion.CardNameAssociations?.get(card)?.find((associated) => hasCardType(associated, "Heirloom"));
    if (!heirloom?.name) continue;
    const copperIndex = deck.indexOf(copper);
    if (copperIndex >= 0) deck.splice(copperIndex, 1, heirloom.name);
  }

  return deck;
}

export function makeSnapshot(game: RuntimeGame, gameInstanceId: string): NavigatorSnapshot {
  const zones = game.state?.zones ?? [];
  const playerZones = zones
    .filter((zone): zone is RuntimeZone => Boolean(zone?.owner && zone.owner.index !== undefined && zone.owner.index >= 0))
    .map(summarizeZoneDetail)
    .filter((zone): zone is ZoneDetail => Boolean(zone));
  const heroZones = zones
    .filter((zone): zone is RuntimeZone => Boolean(zone?.owner?.isHero))
    .map(summarizeZoneDetail)
    .filter((zone): zone is ZoneDetail => Boolean(zone));
  const hero = summarizePlayer(game.playerModel?.hero ?? game.playerModel?.playerMe);
  const activeTurn = summarizeTurn(game.state?.activeTurn);

  return {
    kind: "snapshot",
    gameInstanceId,
    gameRunning: Boolean(game.isRunning?.()),
    capturedAt: new Date().toISOString(),
    setupCards: setupCardNames(game),
    startingDeck: startingDeck(game),
    players: (game.state?.players ?? []).map(summarizePlayer).filter((player): player is PlayerSummary => Boolean(player)),
    ...(hero ? { hero } : {}),
    ...(activeTurn ? { activeTurn } : {}),
    heroZones,
    playerZones
  };
}

export function gameFingerprint(game: RuntimeGame): string | undefined {
  if (!game.state) return undefined;
  return JSON.stringify({
    players: (game.state.players ?? []).map((player) => player.playerId ?? player.name ?? player.index),
    setupCards: setupCardNames(game)
  });
}

export function makeMoveSummary(game: RuntimeGame, move: RuntimeCardMove, phase: CardMoveSummary["phase"]): CardMoveSummary {
  const cardIds = move.cardIds ?? [];
  const cardIdsAfterMoving = move.cardIdsAfterMoving ?? [];
  const turn = summarizeTurn(game.state?.activeTurn);
  const from = summarizeZone(game.state?.zones?.[move.fromZoneIndex ?? -1]);
  const to = summarizeZone(game.state?.zones?.[move.toZoneIndex ?? -1]);
  return {
    kind: "card-move",
    capturedAt: new Date().toISOString(),
    phase,
    ...(turn ? { turn } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    cardIds,
    cards: cardIds.map((id) => cardName(game, id)),
    cardIdsAfterMoving,
    cardsAfterMoving: cardIdsAfterMoving.map((id) => cardName(game, id)),
    ...(move.movementType?.name !== undefined ? { movementType: move.movementType.name } : {}),
    ...(move.cardAnimationClass?.name !== undefined ? { animationClass: move.cardAnimationClass.name } : {})
  };
}
