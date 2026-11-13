import { findPlayerKnowledge, KnowledgeSummary, PlayerDeckKnowledge, zoneKey } from "../knowledge";
import type { AgentStatus, LauncherReply } from "../agent/launcher-protocol";
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
  /** The prompt the Agent box copies: a question for an agent, or a hand-over of the game. */
  agentPrompt: (request: { kind: "ask"; question: string } | { kind: "play" }) => string;
  /** Whether an agent holding this tab's token may still play. */
  agentTokenActive: () => boolean;
  onTakeBack: () => void;
  /** Starts and follows agents through the Dominion launcher, in the Chrome it started. */
  agents: AgentControls;
};

export type AgentRequest = { kind: "ask"; question: string } | { kind: "play" };

export type AgentControls = {
  available: () => boolean;
  start: (request: AgentRequest) => Promise<LauncherReply>;
  status: () => Promise<LauncherReply>;
  stop: (agentId: string) => Promise<LauncherReply>;
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

const AGENT_KIND_LABELS = { ask: "Question", play: "Take-over" } as const;

function renderAgent(agent: AgentStatus, onStop: (id: string) => void): HTMLElement {
  const entry = document.createElement("div");
  entry.className = "agent-entry";
  const head = document.createElement("div");
  head.className = "agent-head";
  const title = document.createElement("span");
  const moves = agent.kind === "play" ? ` · ${agent.moves} moves` : "";
  title.textContent = `${AGENT_KIND_LABELS[agent.kind]} · ${agent.state}${moves}`;
  head.append(title);
  if (agent.state === "running") {
    const stop = document.createElement("button");
    stop.className = "text-button";
    stop.textContent = "Stop";
    stop.title = "Stop this agent now";
    stop.addEventListener("click", () => onStop(agent.id));
    head.append(stop);
  }
  const body = document.createElement("div");
  body.className = "agent-text";
  body.textContent = agent.error ?? (agent.state === "running" && agent.kind === "play" ? agent.lastReason : agent.text) ?? agent.text ?? "";
  body.title = `Log: ${agent.logPath}`;
  entry.append(head, body);
  return entry;
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
  const advisorQuestion = element<HTMLTextAreaElement>("#advisor-question");
  const advisorAsk = element<HTMLButtonElement>("#advisor-ask");
  const advisorPlay = element<HTMLButtonElement>("#advisor-play");
  const advisorTakeBack = element<HTMLButtonElement>("#advisor-take-back");
  const advisorStatus = element("#advisor-status");
  const advisorPrompt = element("#advisor-prompt");
  const agentButtons = element("#agent-buttons");
  const agentAsk = element<HTMLButtonElement>("#agent-ask");
  const agentPlay = element<HTMLButtonElement>("#agent-play");
  const agentList = element("#agent-list");

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

  const askLabel = (): string => (advisorQuestion.value.trim() ? "Copy Question" : "Copy Kingdom Evaluation");
  advisorQuestion.addEventListener("input", () => {
    advisorAsk.textContent = askLabel();
  });
  // Keys typed here are the overlay's, not shortcuts for the game underneath.
  advisorQuestion.addEventListener("keydown", (event) => event.stopPropagation());

  let agentPoll: ReturnType<typeof setTimeout> | undefined;
  /** Copies a prompt for the player to paste into an agent, and shows it in case the clipboard refuses. */
  const showTakeBack = (): void => {
    advisorTakeBack.classList.toggle("hidden", !handlers.agentTokenActive());
  };
  const copyPrompt = (prompt: string): void => {
    advisorPrompt.textContent = prompt;
    advisorPrompt.classList.remove("hidden");
    showTakeBack();
    advisorStatus.classList.remove("hidden");
    advisorStatus.textContent = "Copying...";
    navigator.clipboard.writeText(prompt).then(
      () => {
        advisorStatus.textContent = "Copied. Paste it into an agent started in the dominion-navigator repository.";
      },
      () => {
        advisorStatus.textContent = "Could not reach the clipboard. Select the text below and copy it.";
      }
    );
  };
  advisorAsk.addEventListener("click", () => copyPrompt(handlers.agentPrompt({ kind: "ask", question: advisorQuestion.value })));
  advisorPlay.addEventListener("click", () => copyPrompt(handlers.agentPrompt({ kind: "play" })));
  advisorTakeBack.addEventListener("click", () => {
    handlers.onTakeBack();
    clearTimeout(agentPoll);
    agentList.replaceChildren();
    agentList.classList.add("hidden");
    showTakeBack();
    advisorPrompt.classList.add("hidden");
    advisorStatus.classList.remove("hidden");
    advisorStatus.textContent = "Taken back. The agent's token no longer works, so its next move is refused.";
  });
  showTakeBack();

  const renderAgents = (reply: LauncherReply): void => {
    const agents = reply.agents ?? [];
    agentList.replaceChildren(...agents.slice(-3).map((agent) => renderAgent(agent, (id) => void handlers.agents.stop(id).then(renderAgents))));
    agentList.classList.toggle("hidden", agents.length === 0);
    if (!reply.ok) {
      advisorStatus.classList.remove("hidden");
      advisorStatus.textContent = reply.error;
    }
    showTakeBack();
    clearTimeout(agentPoll);
    if (agents.some((agent) => agent.state === "running")) agentPoll = setTimeout(() => void handlers.agents.status().then(renderAgents), 2500);
  };
  const startAgent = (request: AgentRequest): void => {
    advisorPrompt.classList.add("hidden");
    advisorStatus.classList.remove("hidden");
    advisorStatus.textContent = "Starting an agent...";
    void handlers.agents.start(request).then((reply) => {
      if (reply.ok) advisorStatus.textContent = request.kind === "play" ? "The agent has the game. Take Back stops it." : "The agent is answering.";
      renderAgents(reply);
    });
  };
  agentAsk.addEventListener("click", () => startAgent({ kind: "ask", question: advisorQuestion.value }));
  agentPlay.addEventListener("click", () => startAgent({ kind: "play" }));
  // The launcher binds each tab just after it opens, so look again once the tab has settled.
  const showAgentButtons = (): void => {
    const available = handlers.agents.available();
    agentButtons.classList.toggle("hidden", !available);
    if (available && handlers.agentTokenActive()) void handlers.agents.status().then(renderAgents);
  };
  showAgentButtons();
  for (const delay of [1000, 3000, 8000]) setTimeout(showAgentButtons, delay);

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
