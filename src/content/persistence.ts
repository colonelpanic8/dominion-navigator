import { DeckKnowledgeTracker, SerializedDeckKnowledgeTracker } from "../knowledge";
import { CardMoveSummary, NavigatorSnapshot } from "../messages";
import { chromeApi, currentGameNumber, extensionStorage, isObject } from "./environment";

const STORAGE_KEY_PREFIX = "dominion-navigator:knowledge:v4:";
const MAX_RESTORE_AGE_MS = 24 * 60 * 60 * 1000;

type SnapshotIdentity = {
  href: string;
  gameNumber?: string;
  players: string[];
  setupCards: string[];
  startingDeck: string[];
  turnNumber?: number;
};

export type StoredNavigatorState = {
  version: 1;
  savedAt: string;
  identity: SnapshotIdentity;
  tracker: SerializedDeckKnowledgeTracker;
  recentMoves: CardMoveSummary[];
};

function storageKey(): string {
  return `${STORAGE_KEY_PREFIX}${window.location.href}`;
}

function sortedStrings(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function snapshotIdentity(snapshot: NavigatorSnapshot): SnapshotIdentity {
  const gameNumber = currentGameNumber();
  return {
    href: window.location.href,
    ...(gameNumber ? { gameNumber } : {}),
    players: sortedStrings(snapshot.players.map((player) => `${player.index ?? ""}:${player.name ?? ""}:${player.isHero ? "hero" : "other"}`)),
    setupCards: sortedStrings(snapshot.setupCards ?? []),
    startingDeck: sortedStrings(snapshot.startingDeck ?? []),
    ...(snapshot.activeTurn?.turnNumber !== undefined ? { turnNumber: snapshot.activeTurn.turnNumber } : {})
  };
}

function isStoredNavigatorState(value: unknown): value is StoredNavigatorState {
  if (!isObject(value)) return false;
  return (
    value.version === 1 &&
    typeof value.savedAt === "string" &&
    isObject(value.identity) &&
    isObject(value.tracker) &&
    value.tracker.version === 1 &&
    Array.isArray(value.recentMoves)
  );
}

export function storedStateMatchesSnapshot(state: StoredNavigatorState, snapshot: NavigatorSnapshot): boolean {
  const identity = snapshotIdentity(snapshot);
  const savedAt = Date.parse(state.savedAt);
  if (!Number.isFinite(savedAt) || Date.now() - savedAt > MAX_RESTORE_AGE_MS) return false;
  if (state.identity.href !== identity.href) return false;
  if (state.identity.gameNumber !== identity.gameNumber) return false;
  if (!arraysEqual(state.identity.players, identity.players)) return false;
  if (!arraysEqual(state.identity.setupCards, identity.setupCards)) return false;
  if (!arraysEqual(state.identity.startingDeck, identity.startingDeck)) return false;
  if (state.identity.turnNumber !== undefined && identity.turnNumber !== undefined && identity.turnNumber < state.identity.turnNumber) return false;
  return true;
}

export function snapshotHasRestorableIdentity(snapshot: NavigatorSnapshot): boolean {
  return currentGameNumber() !== undefined && snapshot.players.length > 0 && (snapshot.setupCards?.length ?? 0) > 0;
}

export async function loadPersistedState(): Promise<StoredNavigatorState | undefined> {
  const storage = extensionStorage();
  const get = storage?.get;
  if (!get) return undefined;

  return new Promise((resolve) => {
    get.call(storage, storageKey(), (items) => {
      if (chromeApi?.runtime?.lastError) {
        resolve(undefined);
        return;
      }

      const stored = items[storageKey()];
      resolve(isStoredNavigatorState(stored) ? stored : undefined);
    });
  });
}

export function persistState(snapshot: NavigatorSnapshot, tracker: DeckKnowledgeTracker, recentMoves: CardMoveSummary[]): void {
  const storage = extensionStorage();
  if (!storage?.set) return;
  if (!snapshotHasRestorableIdentity(snapshot)) return;

  const state: StoredNavigatorState = {
    version: 1,
    savedAt: new Date().toISOString(),
    identity: snapshotIdentity(snapshot),
    tracker: tracker.serialize(),
    recentMoves
  };

  storage.set({ [storageKey()]: state });
}
