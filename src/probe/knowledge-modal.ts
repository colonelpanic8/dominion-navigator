import { DrawKnowledgeWindowPayload, KnowledgePileSummary } from "../messages";
import { dominion, getGame, RuntimeCardName, RuntimeGame, RuntimeZone } from "./runtime-types";
import { GAME_NOT_READY, postStatus, reportHookError } from "./status";

const KNOWLEDGE_MODAL_ID = "dominion-navigator-knowledge-modal";
let knowledgeModalCleanup: (() => void) | undefined;

function cardNameObject(game: RuntimeGame, name: string): RuntimeCardName | undefined {
  if (name === "Back" || name === "Anonymous" || name === "Unknown") return dominion.CardNames?.BACK;
  return (game.state?.cardNames ?? []).find((card) => card.name === name) ?? Object.values(dominion.CardNames ?? {}).find((card) => card?.name === name);
}

export function closeKnowledgeWindow(): void {
  knowledgeModalCleanup?.();
  knowledgeModalCleanup = undefined;

  document.getElementById(KNOWLEDGE_MODAL_ID)?.remove();
}

function installKnowledgeModalStyle(root: HTMLElement): void {
  const style = document.createElement("style");
  style.textContent = `
    #${KNOWLEDGE_MODAL_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147482999;
      display: grid;
      place-items: center;
      background: rgba(0, 0, 0, .58);
      color: #f5f1e8;
      font: 14px/1.35 "Helvetica Neue", Arial, sans-serif;
    }
    #${KNOWLEDGE_MODAL_ID} .dn-dialog {
      width: min(980px, calc(100vw - 48px));
      max-height: min(760px, calc(100vh - 48px));
      display: grid;
      grid-template-rows: auto 1fr;
      border: 2px solid rgba(211, 185, 119, .85);
      border-radius: 7px;
      background: rgba(31, 25, 18, .96);
      box-shadow: 0 16px 48px rgba(0, 0, 0, .55);
    }
    #${KNOWLEDGE_MODAL_ID} .dn-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 14px;
      border-bottom: 1px solid rgba(211, 185, 119, .45);
      font-weight: 700;
      letter-spacing: .02em;
    }
    #${KNOWLEDGE_MODAL_ID} .dn-close {
      all: unset;
      cursor: pointer;
      min-width: 28px;
      height: 26px;
      display: inline-grid;
      place-items: center;
      border: 1px solid rgba(211, 185, 119, .65);
      border-radius: 4px;
      background: rgba(255, 255, 255, .08);
      color: #f5f1e8;
      font-weight: 700;
    }
    #${KNOWLEDGE_MODAL_ID} .dn-close:hover { background: rgba(255, 255, 255, .16); }
    #${KNOWLEDGE_MODAL_ID} .dn-body {
      overflow: auto;
      padding: 16px;
    }
    #${KNOWLEDGE_MODAL_ID} .dn-section + .dn-section {
      margin-top: 20px;
      padding-top: 14px;
      border-top: 1px solid rgba(211, 185, 119, .35);
    }
    #${KNOWLEDGE_MODAL_ID} .dn-section-title {
      margin-bottom: 10px;
      color: rgba(245, 241, 232, .92);
      font-weight: 700;
    }
    #${KNOWLEDGE_MODAL_ID} .dn-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
      gap: 18px 14px;
      align-items: start;
    }
    #${KNOWLEDGE_MODAL_ID} .dn-card-tile {
      position: relative;
      display: grid;
      justify-items: center;
      gap: 6px;
      min-width: 0;
    }
    #${KNOWLEDGE_MODAL_ID} .dn-card-slot {
      width: 116px;
      height: 182px;
      pointer-events: none;
    }
    #${KNOWLEDGE_MODAL_ID} .dn-fallback-card {
      width: 116px;
      height: 164px;
      display: grid;
      place-items: center;
      box-sizing: border-box;
      padding: 8px;
      border: 2px solid rgba(211, 185, 119, .75);
      border-radius: 8px;
      background: linear-gradient(#f4ead4, #d9c38d);
      color: #211a12;
      font-weight: 700;
      text-align: center;
    }
    #${KNOWLEDGE_MODAL_ID} .dn-name {
      max-width: 132px;
      color: #f5f1e8;
      text-align: center;
      font-weight: 650;
      overflow-wrap: anywhere;
    }
    #${KNOWLEDGE_MODAL_ID} .dn-empty {
      color: rgba(245, 241, 232, .72);
    }
  `;
  root.append(style);
}

function makeKnowledgeModalCardStack(game: RuntimeGame, sourceZone: RuntimeZone, slot: HTMLElement, cardName: RuntimeCardName, count: number): boolean {
  if (!dominion.CardStack || !game.state?.getAnonCard || !game.gameArea?.cardStacksArea) return false;

  try {
    const stack = new dominion.CardStack(game.state.getAnonCard(cardName), sourceZone);
    stack.addFilter?.("dominion-navigator-knowledge");
    for (let index = 0; index < count; index += 1) stack.addAnonymousCard?.();
    stack.render?.(game.gameArea.cardStacksArea);
    stack.reposition?.(0, 0, 116, 182, 0, 0, 1, 0);

    const renderedCard = stack.view?.canvas?.cloneNode(true);
    stack.destroy?.();
    if (!(renderedCard instanceof HTMLElement)) return false;

    renderedCard.style.position = "relative";
    renderedCard.style.left = "0";
    renderedCard.style.top = "0";
    renderedCard.style.width = "116px";
    renderedCard.style.height = "182px";
    renderedCard.style.zIndex = "auto";
    renderedCard.style.opacity = "1";
    renderedCard.style.transform = "none";
    renderedCard.style.display = "block";
    renderedCard.style.pointerEvents = "none";
    slot.append(renderedCard);
    return true;
  } catch (error) {
    reportHookError(`Failed to render knowledge card stack: ${String(error)}`);
    return false;
  }
}

function makeKnowledgeModalCardTile(game: RuntimeGame, sourceZone: RuntimeZone, name: string, count: number): HTMLElement {
  const tile = document.createElement("div");
  tile.className = "dn-card-tile";

  const slot = document.createElement("div");
  slot.className = "dn-card-slot";

  const label = document.createElement("div");
  label.className = "dn-name";
  label.textContent = name;

  const cardName = name === "Unknown" ? dominion.CardNames?.BACK : cardNameObject(game, name);
  const renderedStack = cardName ? makeKnowledgeModalCardStack(game, sourceZone, slot, cardName, count) : false;
  if (!renderedStack) {
    const fallback = document.createElement("div");
    fallback.className = "dn-fallback-card";
    fallback.textContent = name;
    slot.append(fallback);
  }

  tile.append(slot, label);
  return tile;
}

function handleKnowledgeModalKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") closeKnowledgeWindow();
}

function knowledgePileTotal(pile: KnowledgePileSummary): number {
  return pile.cards.reduce((sum, item) => sum + Math.max(0, item.count), 0) + Math.max(0, pile.unknownCount);
}

function appendKnowledgePileSection(
  body: HTMLElement,
  game: RuntimeGame,
  sourceZone: RuntimeZone,
  titleText: string,
  pile: KnowledgePileSummary,
  emptyText: string
): void {
  const section = document.createElement("section");
  section.className = "dn-section";

  const sectionTitle = document.createElement("div");
  sectionTitle.className = "dn-section-title";
  sectionTitle.textContent = `${titleText} (${knowledgePileTotal(pile)})`;

  const grid = document.createElement("div");
  grid.className = "dn-grid";
  for (const item of pile.cards) {
    if (item.count <= 0) continue;
    grid.append(makeKnowledgeModalCardTile(game, sourceZone, item.name, item.count));
  }
  if (pile.unknownCount > 0) grid.append(makeKnowledgeModalCardTile(game, sourceZone, "Unknown", pile.unknownCount));

  if (grid.childElementCount === 0) {
    const empty = document.createElement("div");
    empty.className = "dn-empty";
    empty.textContent = emptyText;
    grid.append(empty);
  }

  section.append(sectionTitle, grid);
  body.append(section);
}

export function showDrawKnowledgeWindow(payload: DrawKnowledgeWindowPayload): void {
  const game = getGame();
  if (!game?.state) {
    postStatus(false, GAME_NOT_READY);
    return;
  }

  const sourceZone = game.state.zones?.[payload.sourceZoneIndex] ?? game.state.zones?.find((zone) => zone?.zoneName === "DrawZone");
  if (!sourceZone) {
    postStatus(false, "Unable to find the source pile in the Dominion runtime.");
    return;
  }

  closeKnowledgeWindow();

  const modal = document.createElement("div");
  modal.id = KNOWLEDGE_MODAL_ID;
  installKnowledgeModalStyle(modal);

  const dialog = document.createElement("div");
  dialog.className = "dn-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  const header = document.createElement("div");
  header.className = "dn-header";

  const title = document.createElement("div");
  title.textContent = `${payload.playerName} Card Details`;

  const close = document.createElement("button");
  close.className = "dn-close";
  close.type = "button";
  close.textContent = "x";
  close.addEventListener("click", closeKnowledgeWindow);
  header.append(title, close);

  const body = document.createElement("div");
  body.className = "dn-body";

  appendKnowledgePileSection(
    body,
    game,
    sourceZone,
    "Draw Pile",
    { cards: payload.cards, unknownCount: payload.unknownCount },
    "No draw pile cards are currently tracked."
  );
  appendKnowledgePileSection(
    body,
    game,
    sourceZone,
    "Discard Pile",
    payload.discardPile,
    "No discard pile cards are currently tracked."
  );
  appendKnowledgePileSection(
    body,
    game,
    sourceZone,
    "Excluded from Active Deck",
    payload.excludedFromActiveDeck,
    "No out-of-reshuffle cards are currently tracked."
  );
  appendKnowledgePileSection(
    body,
    game,
    sourceZone,
    "Entire Deck",
    payload.entireDeck,
    "No full-deck totals are currently tracked."
  );
  dialog.append(header, body);
  modal.append(dialog);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeKnowledgeWindow();
  });
  document.addEventListener("keydown", handleKnowledgeModalKeydown);
  knowledgeModalCleanup = () => {
    document.removeEventListener("keydown", handleKnowledgeModalKeydown);
  };
  document.body.append(modal);
}
