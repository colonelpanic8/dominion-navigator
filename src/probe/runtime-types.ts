// Shapes of the dominion.games client objects the probe reads. Every field is
// optional because the client is minified third-party code that can change.

export type AngularLike = {
  element: (element: Element) => {
    injector: () => {
      get: (name: string) => unknown;
    };
  };
};

export type RuntimeCardName = {
  name?: string;
  types?: Array<{ name?: string }>;
  hasHeirloom?: () => boolean;
};

export type RuntimeCard = {
  id?: number;
  cardName?: RuntimeCardName;
};

export type RuntimeBounds = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  zIndex?: number;
};

export type RuntimeCardStack = {
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

export type RuntimePlayer = {
  index?: number;
  playerId?: number;
  name?: string;
  isHero?: boolean;
};

export type RuntimeZone = {
  index?: number;
  zoneName?: string;
  owner?: RuntimePlayer;
  cardStacks?: Array<RuntimeCardStack | null | undefined>;
  primaryStacks?: Array<RuntimeCardStack | null | undefined>;
};

export type RuntimeTurn = {
  ownerId?: number;
  turnNumber?: number;
  controllerId?: number;
};

export type RuntimeState = {
  zones?: Array<RuntimeZone | undefined>;
  cards?: Array<RuntimeCard | undefined>;
  cardNames?: RuntimeCardName[];
  players?: RuntimePlayer[];
  activeTurn?: RuntimeTurn;
  getAnonCard?: (cardName: RuntimeCardName) => RuntimeCard;
};

export type RuntimePlayerModel = {
  hero?: RuntimePlayer;
  playerMe?: RuntimePlayer;
};

export type RuntimeGame = {
  isRunning?: () => boolean;
  state?: RuntimeState;
  playerModel?: RuntimePlayerModel;
  readState?: (isReconnect: boolean, reader: unknown) => unknown;
  gameArea?: {
    cardStacksArea?: Element;
  };
};

export type RuntimeCardMove = {
  fromZoneIndex?: number;
  toZoneIndex?: number;
  cardIds?: number[];
  cardIdsAfterMoving?: number[];
  movementType?: { name?: string };
  cardAnimationClass?: { name?: string };
};

export type DominionGlobals = {
  angular?: AngularLike;
  CardNameAssociations?: Map<RuntimeCardName, RuntimeCardName[]>;
  CardNames?: Partial<Record<string, RuntimeCardName>>;
  CardStack?: new (card: RuntimeCard, zone: RuntimeZone) => RuntimeCardStack;
  CardMove?: {
    prototype?: {
      execute?: (game: RuntimeGame, done?: () => void) => unknown;
    };
  };
};

export const dominion = window as Window & typeof globalThis & DominionGlobals;

export function getGame(): RuntimeGame | undefined {
  try {
    const injector = dominion.angular?.element(document.body).injector();
    return injector?.get("game") as RuntimeGame;
  } catch {
    return undefined;
  }
}
