import {
  CardMoveSummary,
  CardSummary,
  ContentCommand,
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
};

type RuntimeCardStack = {
  cardCount?: number;
  anonymousCards?: number;
  topCard?: RuntimeCard;
  cards?: RuntimeCard[];
};

type RuntimePlayer = {
  index?: number;
  playerId?: number;
  name?: string;
  isHero?: boolean;
};

type RuntimeZone = {
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
  zones?: Array<RuntimeZone | undefined>;
  cards?: Array<RuntimeCard | undefined>;
  cardNames?: RuntimeCardName[];
  players?: RuntimePlayer[];
  activeTurn?: RuntimeTurn;
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
};

type RuntimeCardMove = {
  fromZoneIndex?: number;
  toZoneIndex?: number;
  cardIds?: number[];
  cardIdsAfterMoving?: number[];
  movementType?: { name?: string };
  cardAnimationClass?: { name?: string };
};

type WindowWithDominion = Window &
  typeof globalThis & {
    angular?: AngularLike;
    CardNameAssociations?: Map<RuntimeCardName, RuntimeCardName[]>;
    CardNames?: {
      COPPER?: RuntimeCardName;
      ESTATE?: RuntimeCardName;
    };
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
};

const win = window as WindowWithDominion;

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

function summarizeStack(stack: RuntimeCardStack): ZoneStackSummary {
  return {
    cardCount: stack.cardCount ?? 0,
    anonymousCards: stack.anonymousCards ?? 0,
    ...(stack.topCard?.cardName?.name !== undefined ? { topCard: stack.topCard.cardName.name } : {}),
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
  return {
    index: zone.index,
    zoneName: zone.zoneName ?? runtimeType(zone),
    runtimeType: runtimeType(zone),
    ...(owner ? { owner } : {}),
    cardCount: effectiveCardCount(zone),
    stackCount: stacks.length,
    topCards: stacks.map((stack) => stack.topCard?.cardName?.name).filter((name): name is string => Boolean(name))
  };
}

function summarizeZoneDetail(zone: RuntimeZone): ZoneDetail | undefined {
  const summary = summarizeZone(zone);
  if (!summary) return undefined;
  return {
    ...summary,
    stacks: effectiveStacks(zone).map(summarizeStack)
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
    setupCards: setupCardNames(game),
    zoneIndexes: (game.state.zones ?? [])
      .filter((zone): zone is RuntimeZone => Boolean(zone?.owner && zone.owner.index !== undefined && zone.owner.index >= 0))
      .map((zone) => `${zone.owner?.index}:${zone.index}:${zone.zoneName}`)
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
    }
  });
}

install();
