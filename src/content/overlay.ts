import { findPlayerKnowledge, KnowledgeSummary, PlayerDeckKnowledge, zoneKey } from "../knowledge";
import { CardMoveSummary, NavigatorSnapshot } from "../messages";
import {
  counterTotal,
  formatCounter,
  playerDisplayName,
  playerRole,
  prioritizedZones,
  rawZoneCards,
  trackedZoneCards,
  zoneDisplayName
} from "./formatting";
import { OVERLAY_HTML } from "./overlay-template";

const VISIBLE_MOVE_COUNT = 6;

export type OverlayHandlers = {
  onRefresh: () => void;
  onShowDrawWindow: () => void;
  onIdentityRepairChange: (enabled: boolean) => void;
};

export type Overlay = {
  root: HTMLElement;
  setStatus: (text: string) => void;
  renderSnapshotStatus: (snapshot: NavigatorSnapshot) => void;
  renderKnowledge: (summary: KnowledgeSummary) => void;
  renderZones: (summary: KnowledgeSummary, snapshot: NavigatorSnapshot) => void;
  renderMoves: (moves: CardMoveSummary[]) => void;
};

type ZoneRenderRow = {
  zoneName: string;
  count: number;
  cardsText: string;
};

function isEmptyZoneRenderRow(row: ZoneRenderRow): boolean {
  return row.count === 0 && row.cardsText === "empty";
}

/** Adds a row, letting non-empty rows replace empty ones of the same name and numbering real duplicates. */
function appendZoneRenderRow(rows: ZoneRenderRow[], next: ZoneRenderRow): void {
  const existingIndex = rows.findIndex((row) => row.zoneName === next.zoneName);
  if (existingIndex === -1) {
    rows.push(next);
    return;
  }

  if (isEmptyZoneRenderRow(next)) return;
  if (isEmptyZoneRenderRow(rows[existingIndex]!)) {
    rows[existingIndex] = next;
    return;
  }

  const duplicateCount = rows.filter((row) => row.zoneName === next.zoneName || row.zoneName.startsWith(`${next.zoneName} #`)).length + 1;
  rows.push({ ...next, zoneName: `${next.zoneName} #${duplicateCount}` });
}

function renderZoneItem({ zoneName, count, cardsText }: ZoneRenderRow): HTMLElement {
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

function renderPlayerKnowledge(player: PlayerDeckKnowledge): HTMLElement {
  const item = document.createElement("div");
  item.className = "player";

  const name = document.createElement("div");
  name.className = "player-name";
  const confidence = player.confidence === "observed" ? "observed" : "partial";
  name.textContent = `${playerDisplayName(player.player)} · ${playerRole(player.player)} · ${confidence}`;
  item.append(name);

  item.append(renderKnowledgeLine("Known owned", String(counterTotal(player.totalKnownOwned))));
  const ownedText = formatCounter(player.totalKnownOwned);
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

  for (const group of player.locationCandidateGroups) {
    const outsideText = group.outsideCount > 0 ? `; ${group.outsideCount} not in those slots` : "";
    item.append(
      renderKnowledgeLine(
        `${group.zoneNames.join(" + ")} candidates`,
        `${group.totalCount} of ${formatCounter(group.knownCards)}${outsideText}`,
        true
      )
    );
  }

  const unlocatedText = formatCounter(player.unlocatedKnownCards);
  if (unlocatedText) {
    item.append(renderKnowledgeLine(player.unknownLocatedCount > 0 ? "Known, uncertain location" : "Known, unlocated", unlocatedText));
  }

  if (player.unknownLocatedCount > 0) {
    item.append(renderKnowledgeLine("Located, unknown identity", String(player.unknownLocatedCount)));
  }

  return item;
}

function renderMoveItem(move: CardMoveSummary): HTMLElement {
  const item = document.createElement("div");
  item.className = "move";
  const cards = move.cardsAfterMoving.filter((name) => name !== "Anonymous").join(", ") || move.cards.join(", ");
  const from = move.from ? zoneDisplayName(move.from) : "?";
  const to = move.to ? zoneDisplayName(move.to) : "?";
  item.textContent = `${move.phase}: ${cards || "unknown cards"} · ${from} → ${to}`;
  return item;
}

export function createOverlay(handlers: OverlayHandlers, options: { identityRepairEnabled: boolean }): Overlay {
  const root = document.createElement("section");
  root.id = "dominion-navigator-root";
  root.attachShadow({ mode: "open" });
  document.documentElement.appendChild(root);

  const shadow = root.shadowRoot!;
  shadow.innerHTML = OVERLAY_HTML;

  const element = <T extends HTMLElement>(selector: string): T => shadow.querySelector<T>(selector)!;
  const bodyElement = element("#body");
  const panelElement = element(".panel");
  const metaElement = element("#meta");
  const zonesElement = element("#zones");
  const movesElement = element("#moves");
  const knowledgeElement = element("#knowledge");
  const showDeckButton = element<HTMLButtonElement>("#show-deck");
  const toggleButton = element<HTMLButtonElement>("#toggle");
  const refreshButton = element<HTMLButtonElement>("#refresh");
  const identityRepairInput = element<HTMLInputElement>("#identity-repair");

  toggleButton.addEventListener("click", () => {
    const isCollapsed = panelElement.classList.toggle("collapsed");
    bodyElement.classList.toggle("hidden", isCollapsed);
    toggleButton.textContent = isCollapsed ? "+" : "-";
    toggleButton.title = isCollapsed ? "Open navigator" : "Collapse navigator";
  });

  refreshButton.addEventListener("click", handlers.onRefresh);
  showDeckButton.addEventListener("click", handlers.onShowDrawWindow);

  identityRepairInput.checked = options.identityRepairEnabled;
  identityRepairInput.addEventListener("change", () => handlers.onIdentityRepairChange(identityRepairInput.checked));

  return {
    root,

    setStatus(text) {
      metaElement.textContent = text;
    },

    renderSnapshotStatus(snapshot) {
      const heroName = snapshot.hero?.name ?? "unknown player";
      const turn = snapshot.activeTurn?.turnNumber === undefined ? "unknown turn" : `turn ${snapshot.activeTurn.turnNumber}`;
      metaElement.textContent = `${heroName} · ${turn} · ${snapshot.gameRunning ? "running" : "not running"}`;
    },

    renderKnowledge(summary) {
      if (summary.players.length === 0) {
        knowledgeElement.innerHTML = '<span class="muted">No deck knowledge yet.</span>';
        return;
      }

      knowledgeElement.replaceChildren(
        ...[...summary.players]
          .sort((a, b) => Number(b.player.isHero) - Number(a.player.isHero) || (a.player.index ?? 999) - (b.player.index ?? 999))
          .map(renderPlayerKnowledge)
      );
    },

    renderZones(summary, snapshot) {
      const heroKnowledge = findPlayerKnowledge(summary, snapshot.hero);
      const trackedByKey = new Map((heroKnowledge?.zones ?? []).map((zone) => [zone.zoneKey, zone]));
      const renderedKeys = new Set<string>();
      const rows: ZoneRenderRow[] = [];

      for (const rawZone of snapshot.heroZones) {
        const key = zoneKey(rawZone);
        const trackedZone = trackedByKey.get(key);
        // Discard contents come from tracked moves; raw discard snapshots only expose the top card.
        const isEventSourced = rawZone.zoneName === "DiscardZone";
        renderedKeys.add(key);
        appendZoneRenderRow(rows, {
          zoneName: zoneDisplayName(rawZone),
          count: trackedZone?.totalCount ?? (isEventSourced ? 0 : rawZone.cardCount),
          cardsText: trackedZone ? trackedZoneCards(trackedZone) : isEventSourced ? "empty" : rawZoneCards(rawZone)
        });
      }

      for (const trackedZone of heroKnowledge?.zones ?? []) {
        if (renderedKeys.has(trackedZone.zoneKey)) continue;
        appendZoneRenderRow(rows, {
          zoneName: trackedZone.zoneName,
          count: trackedZone.totalCount,
          cardsText: trackedZoneCards(trackedZone)
        });
      }

      zonesElement.replaceChildren(...rows.map(renderZoneItem));
    },

    renderMoves(moves) {
      if (!moves.length) {
        movesElement.innerHTML = '<span class="muted">No moves captured yet.</span>';
        return;
      }

      movesElement.replaceChildren(...moves.slice(-VISIBLE_MOVE_COUNT).reverse().map(renderMoveItem));
    }
  };
}
