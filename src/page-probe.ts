import {
  CardMoveSummary,
  CardSummary,
  BoundsSummary,
  ContentCommand,
  KnowledgeWindowCardSummary,
  MESSAGE_SOURCE,
  NavigatorSnapshot,
  PlayerSummary,
  ProbeMessage,
  TurnSummary,
  ZoneDetail,
  ZoneStackSummary,
  ZoneSummary
} from "./messages";

type AngularLike = {
  element: (element: Element) => {
    injector: () => {
      get: (name: string) => unknown;
    };
  };
};

type RuntimeCardName = {
  name?: string;
  types?: Array<{ name?: string }>;
  hasHeirloom?: () => boolean;
};

type RuntimeCard = {
  id?: number;
  cardName?: RuntimeCardName;
  addToStack?: (stack: RuntimeCardStack) => void;
  removeFromStack?: (stack: RuntimeCardStack) => void;
};

type RuntimeCardStack = {
  cardCount?: number;
  anonymousCards?: number;
  topCard?: RuntimeCard;
  cards?: RuntimeCard[];
  view?: {
    bbox?: RuntimeBounds;
    canvas?: HTMLElement;
  };
  render?: (node: Element) => void;
  destroy?: () => void;
  addAnonymousCard?: () => void;
  addFilter?: (name: string) => void;
  reposition?: (x: number, y: number, width: number, height: number, zIndex?: number, rotZ?: number, opacity?: number, rotY?: number) => void;
};

type RuntimeBounds = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  zIndex?: number;
};

type RuntimePlayer = {
  index?: number;
  playerId?: number;
  name?: string;
  isHero?: boolean;
};

type RuntimeZone = {
  state?: RuntimeState;
  index?: number;
  zoneName?: string;
  owner?: RuntimePlayer;
  cardCount?: number;
  cardStacks?: Array<RuntimeCardStack | null | undefined>;
  primaryStacks?: Array<RuntimeCardStack | null | undefined>;
};

type RuntimeTurn = {
  ownerId?: number;
  turnNumber?: number;
  controllerId?: number;
};

type RuntimeState = {
  game?: RuntimeGame;
  zones?: Array<RuntimeZone | undefined>;
  cards?: Array<RuntimeCard | undefined>;
  cardNames?: RuntimeCardName[];
  players?: RuntimePlayer[];
  activeTurn?: RuntimeTurn;
  nobody?: RuntimePlayer;
  getAnonCard?: (cardName: RuntimeCardName) => RuntimeCard;
};

type RuntimePlayerModel = {
  hero?: RuntimePlayer;
  playerMe?: RuntimePlayer;
};

type RuntimeGame = {
  isRunning?: () => boolean;
  state?: RuntimeState;
  playerModel?: RuntimePlayerModel;
  readState?: (isReconnect: boolean, reader: unknown) => unknown;
  gameArea?: {
    cardStacksArea?: Element;
    gameTabArea?: Element;
  };
};

type RuntimeCardMove = {
  fromZoneIndex?: number;
  toZoneIndex?: number;
  cardIds?: number[];
  cardIdsAfterMoving?: number[];
  movementType?: { name?: string };
  cardAnimationClass?: { name?: string };
};

type RuntimeKnowledgeWindowZone = RuntimeZone & {
  bbox?: RuntimeBounds;
  cardStacks: RuntimeCardStack[];
  show?: (cause: unknown) => void;
  hideAll?: () => void;
  unload?: () => void;
  reposition?: () => void;
  windowView?: {
    render?: (node: Element) => void;
    unload?: () => void;
  };
};

type WindowWithDominion = Window &
  typeof globalThis & {
    angular?: AngularLike;
    CardNameAssociations?: Map<RuntimeCardName, RuntimeCardName[]>;
    CardNames?: {
      BACK?: RuntimeCardName;
      COPPER?: RuntimeCardName;
      ESTATE?: RuntimeCardName;
    };
    CardStack?: new (card: RuntimeCard, zone: RuntimeKnowledgeWindowZone) => RuntimeCardStack;
    WindowedZone?: new (
      state: RuntimeState,
      index: number,
      pileName: RuntimeCardName | undefined,
      owner: RuntimePlayer | undefined,
      createdBy: unknown,
      attachedTrait: unknown,
      isVisible?: boolean
    ) => RuntimeKnowledgeWindowZone;
    CardMove?: {
      prototype?: {
        execute?: (game: RuntimeGame, done?: () => void) => unknown;
      };
    };
    __dominionNavigator?: ProbeState;
  };

type ProbeState = {
  installed: true;
  game?: RuntimeGame;
  gameInstanceId: string;
  gameInstanceSerial: number;
  gameFingerprint: string | undefined;
  lastTurnNumber: number | undefined;
  events: Array<CardMoveSummary | NavigatorSnapshot>;
  requestSnapshot: () => void;
  knowledgeWindow?: RuntimeKnowledgeWindowZone;
};

const win = window as WindowWithDominion;
const KNOWLEDGE_MODAL_ID = "dominion-navigator-knowledge-modal";
let knowledgeModalCleanup: (() => void) | undefined;

function post(message: ProbeMessage): void {
  window.postMessage(message, window.location.origin);
}

function status(ok: boolean, reason?: string): void {
  post({
    source: MESSAGE_SOURCE,
    type: "status",
    payload: reason === undefined ? { ok } : { ok, reason }
  });
}

function reportHookError(message: string): void {
  try {
    status(false, message);
  } catch {
    // Keep the probe observational: reporting failures must never affect the game client.
  }
}

function runtimeType(value: unknown): string {
  if (value === null || value === undefined) return "Unknown";
  return Object.getPrototypeOf(value)?.constructor?.name || typeof value;
}

function getGame(): RuntimeGame | undefined {
  try {
    const injector = win.angular?.element(document.body).injector();
    return injector?.get("game") as RuntimeGame;
  } catch {
    return undefined;
  }
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
  const stacks = effectiveStacks(zone);
  if (stacks.length === 0) return 0;
  return stacks.reduce((total, stack) => total + (stack.cardCount ?? 0), 0);
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

function cardNameObject(game: RuntimeGame, name: string): RuntimeCardName | undefined {
  if (name === "Back" || name === "Anonymous" || name === "Unknown") return win.CardNames?.BACK;
  return (game.state?.cardNames ?? []).find((card) => card.name === name) ?? Object.values(win.CardNames ?? {}).find((card) => card?.name === name);
}

function hasCardType(card: RuntimeCardName | undefined, typeName: string): boolean {
  return Boolean(card?.types?.some((type) => type.name === typeName));
}

function startingDeck(game: RuntimeGame): string[] {
  const setupCards = game.state?.cardNames ?? [];
  const deck: string[] = [];
  const copper = win.CardNames?.COPPER?.name ?? "Copper";
  const estate = win.CardNames?.ESTATE?.name ?? "Estate";

  for (let index = 0; index < 7; index += 1) deck.push(copper);

  const shelters = setupCards.filter((card) => hasCardType(card, "Shelter"));
  if (shelters.length > 0) {
    for (const shelter of shelters) if (shelter.name) deck.push(shelter.name);
  } else {
    for (let index = 0; index < 3; index += 1) deck.push(estate);
  }

  for (const card of setupCards) {
    if (!card.hasHeirloom?.()) continue;
    const heirloom = win.CardNameAssociations?.get(card)?.find((associated) => hasCardType(associated, "Heirloom"));
    if (!heirloom?.name) continue;
    const copperIndex = deck.indexOf(copper);
    if (copperIndex >= 0) deck.splice(copperIndex, 1, heirloom.name);
  }

  return deck;
}

function makeSnapshot(game: RuntimeGame): NavigatorSnapshot {
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
    gameInstanceId: win.__dominionNavigator?.gameInstanceId ?? "unknown-game",
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

function gameFingerprint(game: RuntimeGame): string | undefined {
  if (!game.state) return undefined;
  return JSON.stringify({
    players: (game.state.players ?? []).map((player) => player.playerId ?? player.name ?? player.index),
    setupCards: setupCardNames(game)
  });
}

function makeMoveSummary(game: RuntimeGame, move: RuntimeCardMove, phase: "before" | "after"): CardMoveSummary {
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

function emitMoveSummary(game: RuntimeGame, move: RuntimeCardMove, phase: "before" | "after"): void {
  try {
    const summary = makeMoveSummary(game, move, phase);
    win.__dominionNavigator?.events.push(summary);
    post({ source: MESSAGE_SOURCE, type: "card-move", payload: summary });
  } catch (error) {
    status(false, `Failed to summarize ${phase} card move: ${String(error)}`);
  }
}

function emitSnapshot(): void {
  const game = getGame();
  if (!game?.state) {
    status(false, "Dominion game service is not ready yet.");
    return;
  }

  const snapshot = makeSnapshot(game);
  win.__dominionNavigator?.events.push(snapshot);
  post({ source: MESSAGE_SOURCE, type: "snapshot", payload: snapshot });
}

function closeKnowledgeWindow(): void {
  knowledgeModalCleanup?.();
  knowledgeModalCleanup = undefined;

  document.getElementById(KNOWLEDGE_MODAL_ID)?.remove();
  delete win.__dominionNavigator?.knowledgeWindow;
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
  if (!win.CardStack || !game.state?.getAnonCard || !game.gameArea?.cardStacksArea) return false;

  try {
    const stack = new win.CardStack(game.state.getAnonCard(cardName), sourceZone as RuntimeKnowledgeWindowZone);
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

  const cardName = name === "Unknown" ? win.CardNames?.BACK : cardNameObject(game, name);
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

function showDrawKnowledgeWindow(payload: Extract<ContentCommand, { type: "show-draw-knowledge-window" }>["payload"]): void {
  const game = getGame();
  if (!game?.state) {
    status(false, "Dominion game service is not ready yet.");
    return;
  }

  const sourceZone = game.state.zones?.[payload.sourceZoneIndex] ?? game.state.zones?.find((zone) => zone?.zoneName === "DrawZone");
  if (!sourceZone) {
    status(false, "Unable to find a draw pile in the Dominion runtime.");
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
  const knownCount = payload.cards.reduce((sum, item) => sum + Math.max(0, item.count), 0);
  const totalCount = knownCount + Math.max(0, payload.unknownCount);
  title.textContent = `Your Draw Pile (${totalCount})`;

  const close = document.createElement("button");
  close.className = "dn-close";
  close.type = "button";
  close.textContent = "x";
  close.addEventListener("click", closeKnowledgeWindow);
  header.append(title, close);

  const body = document.createElement("div");
  body.className = "dn-body";

  const grid = document.createElement("div");
  grid.className = "dn-grid";
  for (const item of payload.cards) {
    if (item.count <= 0) continue;
    grid.append(makeKnowledgeModalCardTile(game, sourceZone, item.name, item.count));
  }
  if (payload.unknownCount > 0) grid.append(makeKnowledgeModalCardTile(game, sourceZone, "Unknown", payload.unknownCount));

  if (grid.childElementCount === 0) {
    const empty = document.createElement("div");
    empty.className = "dn-empty";
    empty.textContent = "No draw pile cards are currently tracked.";
    grid.append(empty);
  }

  body.append(grid);
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

function startNewGameInstance(game: RuntimeGame, fingerprint?: string): void {
  const probe = win.__dominionNavigator;
  if (!probe) return;
  probe.game = game;
  probe.gameFingerprint = fingerprint ?? gameFingerprint(game);
  probe.lastTurnNumber = game.state?.activeTurn?.turnNumber;
  probe.gameInstanceSerial += 1;
  probe.gameInstanceId = `game-${probe.gameInstanceSerial}-${Date.now()}`;
  probe.events = [];
}

function updateGameInstance(game: RuntimeGame): void {
  const probe = win.__dominionNavigator;
  if (!probe) return;

  const fingerprint = gameFingerprint(game);
  const turnNumber = game.state?.activeTurn?.turnNumber;
  const isDifferentGame = Boolean(probe.gameFingerprint && fingerprint && probe.gameFingerprint !== fingerprint);
  const turnMovedBackwards = probe.lastTurnNumber !== undefined && turnNumber !== undefined && turnNumber < probe.lastTurnNumber;

  if (isDifferentGame || turnMovedBackwards) {
    startNewGameInstance(game, fingerprint);
  } else {
    probe.game = game;
    probe.gameFingerprint = fingerprint ?? probe.gameFingerprint;
    probe.lastTurnNumber = turnNumber ?? probe.lastTurnNumber;
  }
}

function installGameLifecycleHook(game: RuntimeGame): void {
  const readState = game.readState;
  if (!readState || Reflect.get(readState, "__dominionNavigatorPatched")) return;

  const patched = function patchedReadState(this: RuntimeGame, isReconnect: boolean, reader: unknown): unknown {
    const result = readState.call(this, isReconnect, reader);
    window.setTimeout(() => {
      updateGameInstance(this);
      installCardMoveHook(this);
      emitSnapshot();
    }, 0);
    window.setTimeout(emitSnapshot, 500);
    return result;
  };

  Reflect.set(patched, "__dominionNavigatorPatched", true);
  game.readState = patched;
}

function installCardMoveHook(game: RuntimeGame): void {
  const execute = win.CardMove?.prototype?.execute;
  if (!execute || Reflect.get(execute, "__dominionNavigatorPatched")) return;

  const patched = function patchedCardMoveExecute(this: RuntimeCardMove, gameArg: RuntimeGame, done?: () => void): unknown {
    emitMoveSummary(gameArg, this, "before");

    return execute.call(this, gameArg, () => {
      try {
        emitMoveSummary(gameArg, this, "after");
        emitSnapshot();
      } catch (error) {
        status(false, `Failed to finish card move hook: ${String(error)}`);
      } finally {
        done?.();
      }
    });
  };

  Reflect.set(patched, "__dominionNavigatorPatched", true);
  win.CardMove!.prototype!.execute = patched;
}

function install(): void {
  if (win.__dominionNavigator?.installed) {
    emitSnapshot();
    return;
  }

  const game = getGame();
  win.__dominionNavigator = {
    installed: true,
    gameInstanceId: `game-0-${Date.now()}`,
    gameInstanceSerial: 0,
    gameFingerprint: undefined,
    lastTurnNumber: undefined,
    events: [],
    requestSnapshot: emitSnapshot
  };
  if (game) win.__dominionNavigator.game = game;
  if (game?.state) {
    win.__dominionNavigator.gameFingerprint = gameFingerprint(game);
    win.__dominionNavigator.lastTurnNumber = game.state.activeTurn?.turnNumber;
  }

  if (!game?.state) {
    status(false, "Dominion game service is not ready yet.");
  } else {
    installGameLifecycleHook(game);
    installCardMoveHook(game);
    status(true);
    emitSnapshot();
  }

  window.addEventListener("message", (event: MessageEvent<ContentCommand>) => {
    if (event.source !== window || event.data?.source !== MESSAGE_SOURCE) return;
    if (event.data.type === "request-snapshot") {
      const currentGame = getGame();
      if (currentGame) {
        win.__dominionNavigator!.game = currentGame;
        installGameLifecycleHook(currentGame);
        installCardMoveHook(currentGame);
      }
      emitSnapshot();
      return;
    }

    if (event.data.type === "show-draw-knowledge-window") {
      showDrawKnowledgeWindow(event.data.payload);
    }
  });
}

install();
