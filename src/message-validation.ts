import { MESSAGE_SOURCE, NavigatorMessage } from "./messages";

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item));
}

function isCounter(value: unknown): boolean {
  return isObject(value) && Object.values(value).every(isCount);
}

function isPlayer(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.isHero === "boolean" &&
    (value.index === undefined || Number.isInteger(value.index)) &&
    (value.name === undefined || typeof value.name === "string")
  );
}

function isZoneSummary(value: unknown): boolean {
  return (
    isObject(value) &&
    Number.isInteger(value.index) &&
    typeof value.zoneName === "string" &&
    isCount(value.cardCount) &&
    isStringArray(value.topCards) &&
    (value.owner === undefined || isPlayer(value.owner))
  );
}

function isZoneDetail(value: unknown): boolean {
  return (
    isZoneSummary(value) &&
    Array.isArray((value as Json).stacks) &&
    ((value as Json).stacks as unknown[]).every(
      (stack) => isObject(stack) && isCount(stack.cardCount) && isCount(stack.anonymousCards) && Array.isArray(stack.cards)
    )
  );
}

function isSnapshot(value: unknown): boolean {
  return (
    isObject(value) &&
    value.kind === "snapshot" &&
    typeof value.gameInstanceId === "string" &&
    typeof value.gameRunning === "boolean" &&
    Array.isArray(value.players) &&
    value.players.every(isPlayer) &&
    Array.isArray(value.heroZones) &&
    value.heroZones.every(isZoneDetail) &&
    Array.isArray(value.playerZones) &&
    value.playerZones.every(isZoneDetail)
  );
}

function isCardMove(value: unknown): boolean {
  return (
    isObject(value) &&
    value.kind === "card-move" &&
    (value.phase === "before" || value.phase === "after") &&
    isIntegerArray(value.cardIds) &&
    isStringArray(value.cards) &&
    isIntegerArray(value.cardIdsAfterMoving) &&
    isStringArray(value.cardsAfterMoving) &&
    (value.from === undefined || isZoneSummary(value.from)) &&
    (value.to === undefined || isZoneSummary(value.to))
  );
}

function isPile(value: unknown): boolean {
  return (
    isObject(value) &&
    isCount(value.unknownCount) &&
    Array.isArray(value.cards) &&
    value.cards.every((card) => isObject(card) && typeof card.name === "string" && Number.isInteger(card.count))
  );
}

/** Returns the message if `data` is a well-formed navigator message, otherwise undefined. */
export function parseNavigatorMessage(data: unknown): NavigatorMessage | undefined {
  if (!isObject(data) || data.source !== MESSAGE_SOURCE) return undefined;
  const payload = data.payload;
  switch (data.type) {
    case "status":
      return isObject(payload) && typeof payload.ok === "boolean" && (payload.reason === undefined || typeof payload.reason === "string")
        ? (data as NavigatorMessage)
        : undefined;
    case "snapshot":
      return isSnapshot(payload) ? (data as NavigatorMessage) : undefined;
    case "card-move":
      return isCardMove(payload) ? (data as NavigatorMessage) : undefined;
    case "request-snapshot":
      return data as NavigatorMessage;
    case "show-draw-knowledge-window":
      return isObject(payload) &&
        Number.isInteger(payload.sourceZoneIndex) &&
        typeof payload.playerName === "string" &&
        isPile(payload) &&
        isPile(payload.discardPile) &&
        isPile(payload.excludedFromActiveDeck) &&
        isPile(payload.entireDeck)
        ? (data as NavigatorMessage)
        : undefined;
    default:
      return undefined;
  }
}
