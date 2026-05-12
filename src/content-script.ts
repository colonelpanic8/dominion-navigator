import {
  CardMoveSummary,
  ContentCommand,
  MESSAGE_SOURCE,
  NavigatorSnapshot,
  ProbeMessage,
  ZoneDetail,
  ZoneSummary
} from "./messages";
import {
  CardCounter,
  DeckKnowledgeTracker,
  KnowledgeSummary,
  PlayerDeckKnowledge,
  SerializedDeckKnowledgeTracker,
  ZoneKnowledge
} from "./knowledge";
import { parseLogCardList, parseReactionLog, parseRevealedHandLog } from "./log-parser";

type RuntimeWithChrome = typeof globalThis & {
  chrome?: {
    runtime?: {
      getURL?: (path: string) => string;
      lastError?: { message?: string };
    };
    storage?: {
      local?: {
        get?: (keys: string | string[] | Record<string, unknown>, callback: (items: Record<string, unknown>) => void) => void;
        set?: (items: Record<string, unknown>, callback?: () => void) => void;
        remove?: (keys: string | string[], callback?: () => void) => void;
      };
    };
  };
};

type SnapshotIdentity = {
  href: string;
  gameNumber?: string;
  players: string[];
  setupCards: string[];
  startingDeck: string[];
  turnNumber?: number;
};

type StoredNavigatorState = {
  version: 1;
  savedAt: string;
  identity: SnapshotIdentity;
  tracker: SerializedDeckKnowledgeTracker;
  recentMoves: CardMoveSummary[];
};

const runtime = globalThis as RuntimeWithChrome;

let latestSnapshot: NavigatorSnapshot | undefined;
const recentMoves: CardMoveSummary[] = [];
const recentAnonymousTopdecks: Array<{ owner?: ZoneSummary["owner"]; count: number; capturedAtMs: number }> = [];
const seenLogLines = new WeakSet<Element>();
let pendingLogLineFirstSeen = new WeakMap<Element, number>();
const tracker = new DeckKnowledgeTracker();
let persistedState: StoredNavigatorState | undefined;
let restoredPersistedState = false;
let logObserverReady = false;

const STORAGE_KEY_PREFIX = "dominion-navigator:knowledge:v1:";
const MAX_RESTORE_AGE_MS = 24 * 60 * 60 * 1000;
const LOG_LINE_RETRY_MS = 5000;
const TOPDECK_LOG_PATTERN = /^(.+?) topdecks (.+?)\.$/;

const root = document.createElement("section");
root.id = "dominion-navigator-root";
root.attachShadow({ mode: "open" });
document.documentElement.appendChild(root);

const shadow = root.shadowRoot!;
shadow.innerHTML = `
  <style>
    :host { all: initial; }
    .panel {
      position: fixed;
      right: 12px;
      top: 72px;
      z-index: 2147483647;
      width: 300px;
      max-height: calc(100vh - 96px);
      overflow: auto;
      box-sizing: border-box;
      padding: 10px;
      border: 1px solid rgba(255,255,255,.32);
      background: rgba(15, 18, 22, .92);
      color: #f5f5f5;
      font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 10px 28px rgba(0,0,0,.35);
      border-radius: 6px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .title {
      font-weight: 700;
      font-size: 13px;
    }
    button {
      all: unset;
      cursor: pointer;
      box-sizing: border-box;
      min-width: 26px;
      height: 24px;
      display: inline-grid;
      place-items: center;
      border: 1px solid rgba(255,255,255,.28);
      border-radius: 4px;
      background: rgba(255,255,255,.08);
      color: #fff;
      font-weight: 700;
    }
    button:hover { background: rgba(255,255,255,.16); }
    .meta {
      color: #b9c0c9;
      margin-bottom: 8px;
    }
    .zone {
      border-top: 1px solid rgba(255,255,255,.14);
      padding: 7px 0;
    }
    .zone-title {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-weight: 650;
      margin-bottom: 4px;
    }
    .cards {
      color: #dce2ea;
      overflow-wrap: anywhere;
    }
    .muted { color: #8f99a6; }
    .moves {
      margin-top: 8px;
      border-top: 1px solid rgba(255,255,255,.18);
      padding-top: 8px;
    }
    .knowledge {
      margin-top: 8px;
      border-top: 1px solid rgba(255,255,255,.18);
      padding-top: 8px;
    }
    .player {
      padding: 7px 0;
      border-top: 1px solid rgba(255,255,255,.12);
    }
    .player:first-of-type { border-top: 0; }
    .player-name {
      font-weight: 650;
      margin-bottom: 4px;
    }
    .line {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: #dce2ea;
      margin-top: 3px;
    }
    .line-stacked {
      display: block;
    }
    .line span:first-child {
      color: #aeb8c5;
      white-space: nowrap;
    }
    .line-stacked span:first-child {
      display: block;
      white-space: normal;
    }
    .line-stacked b {
      display: block;
      margin-top: 2px;
      text-align: left;
    }
    .move {
      margin-top: 5px;
      color: #dce2ea;
    }
    .hidden { display: none; }
  </style>
  <div class="panel">
    <div class="header">
      <div class="title">Dominion Navigator</div>
      <div>
        <button id="refresh" title="Refresh snapshot">↻</button>
        <button id="toggle" title="Collapse">−</button>
      </div>
    </div>
    <div id="body">
      <div class="meta" id="meta">Waiting for game model...</div>
      <div class="knowledge">
        <div class="zone-title"><span>Knowledge Model</span></div>
        <div id="knowledge"><span class="muted">No deck knowledge yet.</span></div>
      </div>
      <div id="zones"></div>
      <div class="moves">
        <div class="zone-title"><span>Recent Moves</span></div>
        <div id="moves"><span class="muted">No moves captured yet.</span></div>
      </div>
    </div>
  </div>
`;

const bodyElement = shadow.querySelector<HTMLElement>("#body")!;
const metaElement = shadow.querySelector<HTMLElement>("#meta")!;
const zonesElement = shadow.querySelector<HTMLElement>("#zones")!;
const movesElement = shadow.querySelector<HTMLElement>("#moves")!;
const knowledgeElement = shadow.querySelector<HTMLElement>("#knowledge")!;
const toggleButton = shadow.querySelector<HTMLButtonElement>("#toggle")!;
const refreshButton = shadow.querySelector<HTMLButtonElement>("#refresh")!;

toggleButton.addEventListener("click", () => {
  bodyElement.classList.toggle("hidden");
  toggleButton.textContent = bodyElement.classList.contains("hidden") ? "+" : "-";
});

refreshButton.addEventListener("click", requestSnapshot);

function requestSnapshot(): void {
  const command: ContentCommand = {
    source: MESSAGE_SOURCE,
    type: "request-snapshot"
  };
  window.postMessage(command, window.location.origin);
}

function storageKey(): string {
  return `${STORAGE_KEY_PREFIX}${window.location.href}`;
}

function currentGameNumber(): string | undefined {
  return document.body?.innerText.match(/Game #(\d+)/)?.[1];
}

function snapshotIdentity(snapshot: NavigatorSnapshot): SnapshotIdentity {
  const gameNumber = currentGameNumber();
  return {
    href: window.location.href,
    ...(gameNumber ? { gameNumber } : {}),
    players: snapshot.players
      .map((player) => `${player.index ?? ""}:${player.name ?? ""}:${player.isHero ? "hero" : "other"}`)
      .sort((a, b) => a.localeCompare(b)),
    setupCards: [...(snapshot.setupCards ?? [])].sort((a, b) => a.localeCompare(b)),
    startingDeck: [...(snapshot.startingDeck ?? [])].sort((a, b) => a.localeCompare(b)),
    ...(snapshot.activeTurn?.turnNumber !== undefined ? { turnNumber: snapshot.activeTurn.turnNumber } : {})
  };
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
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

function storedStateMatchesSnapshot(state: StoredNavigatorState, snapshot: NavigatorSnapshot): boolean {
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

function snapshotHasRestorableIdentity(snapshot: NavigatorSnapshot): boolean {
  return currentGameNumber() !== undefined && snapshot.players.length > 0 && (snapshot.setupCards?.length ?? 0) > 0;
}

async function loadPersistedState(): Promise<StoredNavigatorState | undefined> {
  const localStorage = runtime.chrome?.storage?.local;
  if (!localStorage?.get) return undefined;

  return new Promise((resolve) => {
    localStorage.get!(storageKey(), (items) => {
      if (runtime.chrome?.runtime?.lastError) {
        resolve(undefined);
        return;
      }

      const stored = items[storageKey()];
      resolve(isStoredNavigatorState(stored) ? stored : undefined);
    });
  });
}

function persistState(snapshot: NavigatorSnapshot): void {
  const localStorage = runtime.chrome?.storage?.local;
  if (!localStorage?.set) return;

  const state: StoredNavigatorState = {
    version: 1,
    savedAt: new Date().toISOString(),
    identity: snapshotIdentity(snapshot),
    tracker: tracker.serialize(),
    recentMoves: recentMoves.slice(-30)
  };

  localStorage.set({ [storageKey()]: state });
}

function restorePersistedStateForSnapshot(snapshot: NavigatorSnapshot): boolean {
  if (restoredPersistedState) return false;
  if (!persistedState) {
    restoredPersistedState = true;
    return false;
  }
  if (persistedState.identity.gameNumber === undefined) {
    restoredPersistedState = true;
    return false;
  }
  if (!snapshotHasRestorableIdentity(snapshot)) return false;
  restoredPersistedState = true;
  if (!storedStateMatchesSnapshot(persistedState, snapshot)) return false;

  tracker.restoreForSnapshot(persistedState.tracker, snapshot);
  recentMoves.splice(0, recentMoves.length, ...persistedState.recentMoves.slice(-30));
  renderMoves();
  return true;
}

function zoneCards(zone: ZoneDetail): string {
  const visibleCards = zone.stacks.flatMap((stack) => stack.cards.map((card) => card.name));
  const anonymousCount = zone.stacks.reduce((total, stack) => total + stack.anonymousCards, 0);
  const parts: string[] = [];
  if (visibleCards.length) parts.push(visibleCards.join(", "));
  if (anonymousCount) parts.push(`${anonymousCount} unknown`);
  return parts.join("; ") || "empty";
}

function trackedZoneCards(zone: ZoneKnowledge): string {
  const knownText = formatCounter(zone.knownCards);
  const unknownText = zone.unknownCount > 0 ? `${zone.unknownCount} unknown` : "";
  const ambiguousText = zone.ambiguousCount > 0 ? `${zone.ambiguousCount} location-ambiguous` : "";
  return [knownText, ambiguousText, unknownText].filter(Boolean).join("; ") || "empty";
}

function playerMatches(a: PlayerDeckKnowledge["player"], b: NavigatorSnapshot["hero"]): boolean {
  if (!b) return false;
  if (a.index !== undefined && b.index !== undefined) return a.index === b.index;
  return a.name !== undefined && a.name === b.name;
}

function samePlayer(a: ZoneSummary["owner"] | undefined, b: NavigatorSnapshot["players"][number] | undefined): boolean {
  if (!a || !b) return false;
  if (a.index !== undefined && b.index !== undefined) return a.index === b.index;
  return a.name !== undefined && a.name === b.name;
}

function playerForLogToken(token: string): NavigatorSnapshot["players"][number] | undefined {
  const players = latestSnapshot?.players ?? [];
  const exactMatches = players.filter((player) => player.name === token);
  if (exactMatches.length === 1) return exactMatches[0];

  const prefixMatches = players.filter((player) => player.name?.startsWith(token));
  return prefixMatches.length === 1 ? prefixMatches[0] : undefined;
}

function isAnonymousTopdeckMove(move: CardMoveSummary): boolean {
  return (
    move.phase === "after" &&
    move.from?.owner?.index !== undefined &&
    move.from.owner.index >= 0 &&
    move.to?.zoneName === "DrawZone" &&
    move.to.owner?.index !== undefined &&
    move.to.owner.index >= 0 &&
    samePlayer(move.from.owner, move.to.owner) &&
    move.cardIdsAfterMoving.length > 0 &&
    move.cardIdsAfterMoving.every((id) => id === -1) &&
    move.cardsAfterMoving.every((card) => card === "Anonymous")
  );
}

function recordAnonymousTopdeck(move: CardMoveSummary): void {
  if (!isAnonymousTopdeckMove(move)) return;
  recentAnonymousTopdecks.push({ owner: move.to?.owner, count: move.cardIdsAfterMoving.length, capturedAtMs: Date.now() });
  while (recentAnonymousTopdecks.length > 12) recentAnonymousTopdecks.shift();
}

function consumeRecentAnonymousTopdeck(player: NavigatorSnapshot["players"][number], count: number): boolean {
  const now = Date.now();
  while (recentAnonymousTopdecks.length > 0 && now - recentAnonymousTopdecks[0]!.capturedAtMs > 5000) {
    recentAnonymousTopdecks.shift();
  }

  let available = 0;
  for (const item of recentAnonymousTopdecks) {
    if (!samePlayer(item.owner, player)) continue;
    available += item.count;
    if (available >= count) break;
  }
  if (available < count) return false;

  let remaining = count;
  for (let index = 0; index < recentAnonymousTopdecks.length && remaining > 0; index += 1) {
    const item = recentAnonymousTopdecks[index]!;
    if (!samePlayer(item.owner, player)) continue;
    const consumed = Math.min(item.count, remaining);
    item.count -= consumed;
    remaining -= consumed;
    if (item.count === 0) {
      recentAnonymousTopdecks.splice(index, 1);
      index -= 1;
    }
  }
  return true;
}

function applyKnownCardInZoneFromLogText(text: string): boolean {
  const topdeck = text.match(TOPDECK_LOG_PATTERN);
  if (!topdeck) return false;
  const [, playerToken, cardText] = topdeck;
  if (!playerToken || !cardText) return false;
  const player = playerForLogToken(playerToken);
  if (!player) return false;
  const cardNames = parseLogCardList(cardText, knownCardNamesForLogParsing());
  if (cardNames.length === 0) return false;
  if (!consumeRecentAnonymousTopdeck(player, cardNames.length)) return false;
  return tracker.markKnownCardsInZone(player, "DrawZone", cardNames, { idempotent: false });
}

function knownCardNamesForLogParsing(): string[] {
  const names = new Set<string>([...(latestSnapshot?.setupCards ?? []), ...(latestSnapshot?.startingDeck ?? [])]);
  for (const player of tracker.summary().players) {
    for (const cardName of Object.keys(player.totalKnownOwned)) names.add(cardName);
    for (const zone of player.zones) for (const cardName of Object.keys(zone.knownCards)) names.add(cardName);
  }
  return [...names];
}

function applyKnownHandFromLogText(text: string): boolean {
  const revealedHand = parseRevealedHandLog(text, knownCardNamesForLogParsing());
  if (!revealedHand) return false;
  const player = playerForLogToken(revealedHand.playerToken);
  if (!player) return false;

  return tracker.markExactKnownCardsInZone(player, "HandZone", revealedHand.cards);
}

function applyKnownReactionFromLogText(text: string): boolean {
  const reaction = parseReactionLog(text, knownCardNamesForLogParsing());
  if (!reaction) return false;
  const player = playerForLogToken(reaction.playerToken);
  if (!player) return false;
  return tracker.markKnownCardsInZone(player, "HandZone", [reaction.card]);
}

function playerDisplayName(player: PlayerDeckKnowledge["player"] | ZoneSummary["owner"] | undefined): string {
  return player?.name ?? (player?.index !== undefined ? `Player ${player.index}` : "unknown");
}

function playerRole(player: PlayerDeckKnowledge["player"]): string {
  return player.isHero ? "you" : "other player";
}

function zoneDisplayName(zone: Pick<ZoneSummary, "zoneName" | "owner">): string {
  if (!zone.owner || zone.owner.index === undefined || zone.owner.index < 0) return zone.zoneName;
  const owner = zone.owner.isHero ? "your" : playerDisplayName(zone.owner);
  return `${owner} ${zone.zoneName}`;
}

function rawZoneIsEventSourced(zone: ZoneDetail): boolean {
  return zone.zoneName === "DiscardZone";
}

function total(counter: CardCounter): number {
  return Object.values(counter).reduce((sum, count) => sum + count, 0);
}

function formatCounter(counter: CardCounter, limit = Number.POSITIVE_INFINITY): string {
  const entries = Object.entries(counter).sort(([aName, aCount], [bName, bCount]) => bCount - aCount || aName.localeCompare(bName));
  if (entries.length === 0) return "";
  const visible = entries.slice(0, limit).map(([name, count]) => `${count} ${name}`);
  const hiddenCount = entries.slice(limit).reduce((sum, [, count]) => sum + count, 0);
  if (hiddenCount > 0) visible.push(`${hiddenCount} more`);
  return visible.join(", ");
}

function prioritizedZones(zones: ZoneKnowledge[]): ZoneKnowledge[] {
  const order = ["HandZone", "InPlayZone", "DiscardZone", "DrawZone", "TavernZone", "ExileZone", "SetAsideZone", "RevealZone"];
  return [...zones].sort((a, b) => {
    const aIndex = order.indexOf(a.zoneName);
    const bIndex = order.indexOf(b.zoneName);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex) || a.zoneKey.localeCompare(b.zoneKey);
  });
}

function renderPlayerKnowledge(player: PlayerDeckKnowledge): HTMLElement {
  const item = document.createElement("div");
  item.className = "player";

  const name = document.createElement("div");
  name.className = "player-name";
  const confidence = player.confidence === "observed" ? "observed" : "partial";
  name.textContent = `${playerDisplayName(player.player)} · ${playerRole(player.player)} · ${confidence}`;
  item.append(name);

  item.append(renderKnowledgeLine("Known owned", String(total(player.totalKnownOwned))));
  const ownedText = formatCounter(player.totalKnownOwned, 7);
  if (ownedText) item.append(renderKnowledgeLine("Owned cards", ownedText));
  if (player.totalUnknownOwned > 0) {
    item.append(renderKnowledgeLine("Owned, unknown identity", String(player.totalUnknownOwned)));
  }

  for (const zone of prioritizedZones(player.zones)) {
    item.append(renderKnowledgeLine(zone.zoneName, trackedZoneCards(zone)));
  }

  for (const group of player.ambiguousLocationGroups) {
    item.append(renderKnowledgeLine(`${group.zoneNames.join(" + ")} identities`, formatCounter(group.knownCards), true));
  }

  const unlocatedText = formatCounter(player.unlocatedKnownCards, 4);
  if (unlocatedText) {
    item.append(renderKnowledgeLine("Known, unlocated", unlocatedText));
  }

  if (player.unknownLocatedCount > 0) {
    item.append(renderKnowledgeLine("Located, unknown identity", String(player.unknownLocatedCount)));
  }

  return item;
}

function renderKnowledgeLine(labelText: string, valueText: string, stacked = false): HTMLElement {
  const line = document.createElement("div");
  line.className = stacked ? "line line-stacked" : "line";

  const label = document.createElement("span");
  label.textContent = labelText;

  const value = document.createElement("b");
  value.textContent = valueText;

  line.append(label, value);
  return line;
}

function renderKnowledge(summary: KnowledgeSummary): void {
  if (summary.players.length === 0) {
    knowledgeElement.innerHTML = '<span class="muted">No deck knowledge yet.</span>';
    return;
  }

  knowledgeElement.replaceChildren(
    ...[...summary.players]
      .sort((a, b) => Number(b.player.isHero) - Number(a.player.isHero) || (a.player.index ?? 999) - (b.player.index ?? 999))
      .map(renderPlayerKnowledge)
  );
}

function renderZones(summary: KnowledgeSummary, snapshot: NavigatorSnapshot): void {
  const heroKnowledge = summary.players.find((player) => playerMatches(player.player, snapshot.hero));
  const trackedByKey = new Map((heroKnowledge?.zones ?? []).map((zone) => [zone.zoneKey, zone]));
  const renderedKeys = new Set<string>();
  const zoneRows: ZoneRenderRow[] = [];

  for (const rawZone of snapshot.heroZones) {
    const key = `${rawZone.index}:${rawZone.zoneName}`;
    const trackedZone = trackedByKey.get(key);
    renderedKeys.add(key);
    appendZoneRenderRow(zoneRows, {
      zoneName: zoneDisplayName(rawZone),
      count: trackedZone?.totalCount ?? (rawZoneIsEventSourced(rawZone) ? 0 : rawZone.cardCount),
      cardsText: trackedZone ? trackedZoneCards(trackedZone) : rawZoneIsEventSourced(rawZone) ? "empty" : zoneCards(rawZone)
    });
  }

  for (const trackedZone of heroKnowledge?.zones ?? []) {
    if (renderedKeys.has(trackedZone.zoneKey)) continue;
    appendZoneRenderRow(zoneRows, {
      zoneName: trackedZone.zoneName,
      count: trackedZone.totalCount,
      cardsText: trackedZoneCards(trackedZone)
    });
  }

  zonesElement.replaceChildren(...zoneRows.map((row) => renderZoneItem(row.zoneName, row.count, row.cardsText)));
}

type ZoneRenderRow = {
  zoneName: string;
  count: number;
  cardsText: string;
};

function appendZoneRenderRow(rows: ZoneRenderRow[], next: ZoneRenderRow): void {
  const existingIndex = rows.findIndex((row) => row.zoneName === next.zoneName);
  if (existingIndex === -1) {
    rows.push(next);
    return;
  }

  const existing = rows[existingIndex]!;
  const existingEmpty = isEmptyZoneRenderRow(existing);
  const nextEmpty = isEmptyZoneRenderRow(next);

  if (nextEmpty) return;
  if (existingEmpty) {
    rows[existingIndex] = next;
    return;
  }

  const duplicateCount = rows.filter((row) => row.zoneName === next.zoneName || row.zoneName.startsWith(`${next.zoneName} #`)).length + 1;
  rows.push({ ...next, zoneName: `${next.zoneName} #${duplicateCount}` });
}

function isEmptyZoneRenderRow(row: ZoneRenderRow): boolean {
  return row.count === 0 && row.cardsText === "empty";
}

function renderZoneItem(zoneName: string, count: number, cardsText: string): HTMLElement {
  const item = document.createElement("div");
  item.className = "zone";

  const title = document.createElement("div");
  title.className = "zone-title";

  const name = document.createElement("span");
  name.textContent = zoneName;

  const countElement = document.createElement("span");
  countElement.textContent = String(count);

  const cards = document.createElement("div");
  cards.className = "cards";
  cards.textContent = cardsText;

  title.append(name, countElement);
  item.append(title, cards);
  return item;
}

function renderSnapshot(snapshot: NavigatorSnapshot): void {
  latestSnapshot = snapshot;
  if (!restorePersistedStateForSnapshot(snapshot)) tracker.applySnapshot(snapshot);
  const summary = tracker.summary();
  const heroName = snapshot.hero?.name ?? "unknown player";
  const turn = snapshot.activeTurn?.turnNumber === undefined ? "unknown turn" : `turn ${snapshot.activeTurn.turnNumber}`;
  metaElement.textContent = `${heroName} · ${turn} · ${snapshot.gameRunning ? "running" : "not running"}`;
  renderKnowledge(summary);
  renderZones(summary, snapshot);
  persistState(snapshot);
}

function renderMoves(): void {
  if (!recentMoves.length) {
    movesElement.innerHTML = '<span class="muted">No moves captured yet.</span>';
    return;
  }

  movesElement.replaceChildren(
    ...recentMoves.slice(-6).reverse().map((move) => {
      const item = document.createElement("div");
      item.className = "move";
      const cards = move.cardsAfterMoving.filter((name) => name !== "Anonymous").join(", ") || move.cards.join(", ");
      const from = move.from ? zoneDisplayName(move.from) : "?";
      const to = move.to ? zoneDisplayName(move.to) : "?";
      item.textContent = `${move.phase}: ${cards || "unknown cards"} · ${from} → ${to}`;
      return item;
    })
  );
}

window.addEventListener("message", (event: MessageEvent<ProbeMessage>) => {
  if (event.source !== window || event.data?.source !== MESSAGE_SOURCE) return;

  if (event.data.type === "status" && !event.data.payload.ok) {
    metaElement.textContent = event.data.payload.reason ?? "Probe is not ready.";
    return;
  }
  if (event.data.type === "status") return;

  if (event.data.type === "snapshot") {
    renderSnapshot(event.data.payload);
    initializeLogHistoryBoundary();
    return;
  }

  if (event.data.type === "card-move") {
    recentMoves.push(event.data.payload);
    while (recentMoves.length > 30) recentMoves.shift();
    tracker.applyMove(event.data.payload);
    recordAnonymousTopdeck(event.data.payload);
    const summary = tracker.summary();
    renderMoves();
    renderKnowledge(summary);
    if (latestSnapshot) renderZones(summary, latestSnapshot);
    if (latestSnapshot) persistState(latestSnapshot);
    return;
  }
});

function processLogLine(element: Element, seen: WeakSet<Element>): void {
  if (seen.has(element)) return;
  if (!logObserverReady) {
    seen.add(element);
    return;
  }

  const text = element.textContent?.replace(/\s+/g, " ").trim();
  const isTopdeckLog = Boolean(text && TOPDECK_LOG_PATTERN.test(text));
  const isRevealedHandLog = Boolean(text && parseRevealedHandLog(text));
  const isReactionLog = Boolean(text && parseReactionLog(text));
  if (!text) return;
  if (!isTopdeckLog && !isRevealedHandLog && !isReactionLog) {
    seen.add(element);
    return;
  }

  if (!applyKnownCardInZoneFromLogText(text) && !applyKnownHandFromLogText(text) && !applyKnownReactionFromLogText(text)) {
    const firstSeen = pendingLogLineFirstSeen.get(element) ?? Date.now();
    pendingLogLineFirstSeen.set(element, firstSeen);
    if (Date.now() - firstSeen > LOG_LINE_RETRY_MS) {
      pendingLogLineFirstSeen.delete(element);
      seen.add(element);
    }
    return;
  }

  pendingLogLineFirstSeen.delete(element);
  seen.add(element);
  const summary = tracker.summary();
  renderKnowledge(summary);
  if (latestSnapshot) renderZones(summary, latestSnapshot);
  if (latestSnapshot) persistState(latestSnapshot);
}

function initializeLogHistoryBoundary(): void {
  if (logObserverReady) return;
  for (const element of Array.from(document.querySelectorAll(".log-line"))) seenLogLines.add(element);
  pendingLogLineFirstSeen = new WeakMap<Element, number>();
  logObserverReady = true;
}

function installLogObserver(): void {
  const scan = (): void => {
    for (const element of Array.from(document.querySelectorAll(".log-line"))) processLogLine(element, seenLogLines);
  };

  const containingLogLine = (node: Node): Element | undefined => {
    if (node instanceof Element) {
      if (node.classList.contains("log-line")) return node;
      return node.closest(".log-line") ?? undefined;
    }
    return node.parentNode instanceof Element ? node.parentNode.closest(".log-line") ?? undefined : undefined;
  };

  for (const element of Array.from(document.querySelectorAll(".log-line"))) seenLogLines.add(element);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        const logLine = containingLogLine(mutation.target);
        if (logLine) processLogLine(logLine, seenLogLines);
      }

      for (const node of Array.from(mutation.addedNodes)) {
        const logLine = containingLogLine(node);
        if (logLine) processLogLine(logLine, seenLogLines);
        if (node instanceof Element) {
          for (const child of Array.from(node.querySelectorAll(".log-line"))) processLogLine(child, seenLogLines);
        }
      }
    }
  });
  observer.observe(document.body, { characterData: true, childList: true, subtree: true });
  window.setInterval(scan, 1000);
}

function injectProbe(): void {
  const src = runtime.chrome?.runtime?.getURL?.("page-probe.js");
  if (!src) {
    metaElement.textContent = "Unable to resolve extension probe URL.";
    return;
  }

  const script = document.createElement("script");
  script.src = src;
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

void (async () => {
  persistedState = await loadPersistedState();
  installLogObserver();
  injectProbe();
  setInterval(() => {
    if (!latestSnapshot?.gameRunning) requestSnapshot();
  }, 2000);
})();
