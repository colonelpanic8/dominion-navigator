import { chromeApi } from "./content/environment";
import { InvariantReporter } from "./content/invariants";
import { buildDrawKnowledgeWindowPayload, clickedKnowledgeZone, heroDrawZone } from "./content/knowledge-window";
import { LogKnowledgeWatcher } from "./content/log-watcher";
import { createOverlay } from "./content/overlay";
import {
  loadPersistedState,
  persistState,
  snapshotHasRestorableIdentity,
  StoredNavigatorState,
  storedStateMatchesSnapshot
} from "./content/persistence";
import { DeckKnowledgeTracker, KnowledgeSummary } from "./knowledge";
import { listenForNavigatorMessages, postNavigatorMessage } from "./message-bus";
import { CardMoveSummary, MESSAGE_SOURCE, NavigatorSnapshot, ZoneDetail } from "./messages";
import { AnonymousTopdeckQueue } from "./topdeck-tracking";

const RECENT_MOVE_LIMIT = 30;
const RESIZE_SNAPSHOT_DELAY_MS = 150;
const IDLE_SNAPSHOT_INTERVAL_MS = 2000;

const tracker = new DeckKnowledgeTracker();
const topdecks = new AnonymousTopdeckQueue();
const recentMoves: CardMoveSummary[] = [];
let latestSnapshot: NavigatorSnapshot | undefined;
let persistedState: StoredNavigatorState | undefined;
let restoredPersistedState = false;
let pendingHeroDrawWindowOpen = false;
let resizeSnapshotTimer: number | undefined;
/** The latest probe event folded into the tracker; echoed back so the probe knows how fresh its knowledge is. */
let latestEventSeq = 0;

const overlay = createOverlay(
  {
    onRefresh: requestSnapshot,
    onShowDrawWindow: showHeroDrawKnowledgeWindow,
    onIdentityRepairChange: (enabled) => {
      tracker.setLocationIdentityRepairEnabled(enabled);
      refreshKnowledge();
    }
  },
  { identityRepairEnabled: tracker.isLocationIdentityRepairEnabled() }
);

const invariants = new InvariantReporter(tracker, () => ({
  latestSnapshot,
  recentMoves: recentMoves.slice(-RECENT_MOVE_LIMIT)
}));

const logWatcher = new LogKnowledgeWatcher({
  tracker,
  topdecks,
  latestSnapshot: () => latestSnapshot,
  onKnowledgeChanged: () => refreshKnowledge()
});

function requestSnapshot(): void {
  postNavigatorMessage({ source: MESSAGE_SOURCE, type: "request-snapshot" });
}

function persist(snapshot: NavigatorSnapshot): void {
  persistState(snapshot, tracker, recentMoves.slice(-RECENT_MOVE_LIMIT));
}

function publishKnowledge(summary: KnowledgeSummary): void {
  postNavigatorMessage({ source: MESSAGE_SOURCE, type: "knowledge-update", payload: { seq: latestEventSeq, summary } });
}

/** Re-renders tracker-derived views, persists the tracker, and shares it with the probe. */
function refreshKnowledge(summary: KnowledgeSummary = tracker.summary()): void {
  publishKnowledge(summary);
  overlay.renderKnowledge(summary);
  if (!latestSnapshot) return;
  overlay.renderZones(summary, latestSnapshot);
  persist(latestSnapshot);
}

function restorePersistedStateForSnapshot(snapshot: NavigatorSnapshot): boolean {
  if (restoredPersistedState) return false;
  if (!persistedState || persistedState.identity.gameNumber === undefined) {
    restoredPersistedState = true;
    return false;
  }
  if (!snapshotHasRestorableIdentity(snapshot)) return false;
  if (!storedStateMatchesSnapshot(persistedState, snapshot)) return false;
  restoredPersistedState = true;

  tracker.restoreForSnapshot(persistedState.tracker, snapshot);
  recentMoves.splice(0, recentMoves.length, ...persistedState.recentMoves.slice(-RECENT_MOVE_LIMIT));
  overlay.renderMoves(recentMoves);
  return true;
}

function showDrawKnowledgeWindow(zone: ZoneDetail, snapshot: NavigatorSnapshot): void {
  postNavigatorMessage({
    source: MESSAGE_SOURCE,
    type: "show-draw-knowledge-window",
    payload: buildDrawKnowledgeWindowPayload(zone, tracker.summary(), snapshot)
  });
}

function showHeroDrawKnowledgeWindow(): void {
  const zone = latestSnapshot ? heroDrawZone(latestSnapshot) : undefined;
  if (latestSnapshot && zone) {
    showDrawKnowledgeWindow(zone, latestSnapshot);
    return;
  }

  pendingHeroDrawWindowOpen = true;
  requestSnapshot();
}

function handleSnapshot(snapshot: NavigatorSnapshot): void {
  latestSnapshot = snapshot;
  if (!restorePersistedStateForSnapshot(snapshot)) tracker.applySnapshot(snapshot);
  const summary = invariants.checkSnapshot(snapshot);
  publishKnowledge(summary);
  overlay.renderSnapshotStatus(snapshot);
  overlay.renderKnowledge(summary);
  overlay.renderZones(summary, snapshot);
  if (pendingHeroDrawWindowOpen) {
    pendingHeroDrawWindowOpen = false;
    const zone = heroDrawZone(snapshot);
    if (zone) showDrawKnowledgeWindow(zone, snapshot);
  }
  persist(snapshot);
  logWatcher.startAfterCurrentHistory();
}

function handleCardMove(move: CardMoveSummary): void {
  recentMoves.push(move);
  while (recentMoves.length > RECENT_MOVE_LIMIT) recentMoves.shift();
  tracker.applyMove(move);
  topdecks.record(move);
  const summary = invariants.checkMove(move);
  overlay.renderMoves(recentMoves);
  refreshKnowledge(summary);
}

function handleDocumentClick(event: MouseEvent): void {
  if (event.button !== 0) return;
  if (event.composedPath().includes(overlay.root)) return;
  if (!latestSnapshot) return;

  const zone = clickedKnowledgeZone(latestSnapshot, event.clientX, event.clientY);
  if (!zone) return;

  event.preventDefault();
  event.stopPropagation();
  showDrawKnowledgeWindow(zone, latestSnapshot);
}

function injectProbe(): void {
  const src = chromeApi?.runtime?.getURL?.("page-probe.js");
  if (!src) {
    overlay.setStatus("Unable to resolve extension probe URL.");
    return;
  }

  const script = document.createElement("script");
  script.src = src;
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

document.addEventListener("click", handleDocumentClick, true);
window.addEventListener("resize", () => {
  if (resizeSnapshotTimer !== undefined) window.clearTimeout(resizeSnapshotTimer);
  resizeSnapshotTimer = window.setTimeout(() => {
    resizeSnapshotTimer = undefined;
    requestSnapshot();
  }, RESIZE_SNAPSHOT_DELAY_MS);
});

listenForNavigatorMessages((message) => {
  switch (message.type) {
    case "status":
      if (!message.payload.ok) overlay.setStatus(message.payload.reason ?? "Probe is not ready.");
      return;
    case "snapshot":
      latestEventSeq = message.seq;
      handleSnapshot(message.payload);
      return;
    case "card-move":
      latestEventSeq = message.seq;
      handleCardMove(message.payload);
      return;
  }
});

void (async () => {
  persistedState = await loadPersistedState();
  logWatcher.install();
  injectProbe();
  setInterval(() => {
    if (!latestSnapshot?.gameRunning) requestSnapshot();
  }, IDLE_SNAPSHOT_INTERVAL_MS);
})();
