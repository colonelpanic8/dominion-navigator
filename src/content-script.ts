import {
  CardMoveSummary,
  ContentCommand,
  MESSAGE_SOURCE,
  NavigatorSnapshot,
  ProbeMessage,
  ZoneDetail,
  ZoneSummary
} from "./messages";
import { CardCounter, DeckKnowledgeTracker, KnowledgeSummary, PlayerDeckKnowledge, ZoneKnowledge } from "./knowledge";

type RuntimeWithChrome = typeof globalThis & {
  chrome?: {
    runtime?: {
      getURL?: (path: string) => string;
    };
  };
};

const runtime = globalThis as RuntimeWithChrome;

let latestSnapshot: NavigatorSnapshot | undefined;
const recentMoves: CardMoveSummary[] = [];
const tracker = new DeckKnowledgeTracker();

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
    .line span:first-child {
      color: #aeb8c5;
      white-space: nowrap;
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
  return [knownText, unknownText].filter(Boolean).join("; ") || "empty";
}

function playerMatches(a: PlayerDeckKnowledge["player"], b: NavigatorSnapshot["hero"]): boolean {
  if (!b) return false;
  if (a.index !== undefined && b.index !== undefined) return a.index === b.index;
  return a.name !== undefined && a.name === b.name;
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

  const unlocatedText = formatCounter(player.unlocatedKnownCards, 4);
  if (unlocatedText) {
    item.append(renderKnowledgeLine("Known, unlocated", unlocatedText));
  }

  if (player.unknownLocatedCount > 0) {
    item.append(renderKnowledgeLine("Located, unknown identity", String(player.unknownLocatedCount)));
  }

  return item;
}

function renderKnowledgeLine(labelText: string, valueText: string): HTMLElement {
  const line = document.createElement("div");
  line.className = "line";

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
  const zoneItems: HTMLElement[] = [];

  for (const rawZone of snapshot.heroZones) {
    const key = `${rawZone.index}:${rawZone.zoneName}`;
    const trackedZone = trackedByKey.get(key);
    renderedKeys.add(key);
    zoneItems.push(renderZoneItem(zoneDisplayName(rawZone), trackedZone?.totalCount ?? (rawZoneIsEventSourced(rawZone) ? 0 : rawZone.cardCount), trackedZone ? trackedZoneCards(trackedZone) : rawZoneIsEventSourced(rawZone) ? "empty" : zoneCards(rawZone)));
  }

  for (const trackedZone of heroKnowledge?.zones ?? []) {
    if (renderedKeys.has(trackedZone.zoneKey)) continue;
    zoneItems.push(renderZoneItem(trackedZone.zoneName, trackedZone.totalCount, trackedZoneCards(trackedZone)));
  }

  zonesElement.replaceChildren(...zoneItems);
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
  tracker.applySnapshot(snapshot);
  const summary = tracker.summary();
  const heroName = snapshot.hero?.name ?? "unknown player";
  const turn = snapshot.activeTurn?.turnNumber === undefined ? "unknown turn" : `turn ${snapshot.activeTurn.turnNumber}`;
  metaElement.textContent = `${heroName} · ${turn} · ${snapshot.gameRunning ? "running" : "not running"}`;
  renderKnowledge(summary);
  renderZones(summary, snapshot);
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

  if (event.data.type === "snapshot") {
    renderSnapshot(event.data.payload);
    return;
  }

  if (event.data.type === "card-move") {
    recentMoves.push(event.data.payload);
    while (recentMoves.length > 30) recentMoves.shift();
    tracker.applyMove(event.data.payload);
    const summary = tracker.summary();
    renderMoves();
    renderKnowledge(summary);
    if (latestSnapshot) renderZones(summary, latestSnapshot);
  }
});

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

injectProbe();
setInterval(() => {
  if (!latestSnapshot?.gameRunning) requestSnapshot();
}, 2000);
