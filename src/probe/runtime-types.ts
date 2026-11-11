// Shapes of the dominion.games client objects the probe reads. Every field is
// optional because the client is minified third-party code that can change.

export type AngularLike = {
  element: (element: Element) => {
    injector: () => {
      get: (name: string) => unknown;
    };
    /** Holds a component's controller under `$<componentName>Controller`. */
    data?: () => Record<string, unknown> | undefined;
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
  cost?: { coin?: number; potion?: number; debt?: number };
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
  isMe?: boolean;
  boughtProjects?: unknown[];
  activeReminders?: Array<{ cardName?: RuntimeCardName }>;
};

/** Bots have player ids at or above this value. */
export const FIRST_BOT_PLAYER_ID = 2 ** 30;

export type RuntimeZone = {
  index?: number;
  zoneName?: string;
  pileName?: RuntimeCardName;
  owner?: RuntimePlayer;
  attachedTrait?: RuntimeCardName;
  cardStacks?: Array<RuntimeCardStack | null | undefined>;
  primaryStacks?: Array<RuntimeCardStack | null | undefined>;
};

export type RuntimeTurn = {
  ownerId?: number;
  turnNumber?: number;
  controllerId?: number;
  /** 0 for a normal turn; other values are extra turns. */
  turnType?: number;
};

export type RuntimeCounter = {
  counterName?: { name?: string };
  owner?: RuntimePlayer;
  value?: number;
  /** The pile a counter sits on, or the ownerless "nowhere" zone for a player's own counters. */
  associatedPile?: RuntimeZone;
  associatedCard?: RuntimeCard | null;
};

export type RuntimeToken = {
  tokenName?: { name?: string };
  owner?: RuntimePlayer;
  zone?: RuntimeZone;
  isFlipped?: boolean;
};

export type RuntimeState = {
  zones?: Array<RuntimeZone | undefined>;
  counters?: RuntimeCounter[];
  tokens?: RuntimeToken[];
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

/** Client enum values are opaque objects; their names are the keys of the enum object. */
export type RuntimeEnumValue = object;

export type RuntimeStory = {
  questionId?: RuntimeEnumValue;
};

export type RuntimeQuestion = {
  questionIndex?: number[];
  type?: RuntimeEnumValue;
  story?: RuntimeStory;
  association?: number;
  min?: number;
  max?: number;
  declineButtonId?: number;
  content?: { elements?: unknown[] };
  accumulatedAnswers?: unknown[];
  subquestions?: RuntimeQuestion[];
  answer?: (value: unknown) => void;
  answerDecline?: () => void;
  send?: () => void;
};

export type RuntimeGameResult = {
  playerResults?: Array<{
    playerId?: number;
    rank?: number;
    score?: { totalPoints?: number; usedTurns?: number };
    resignIndex?: number;
  }>;
};

export type RuntimeLogEntry = {
  index?: number;
  depth?: number;
  name?: RuntimeEnumValue;
  logArguments?: unknown[];
};

export type RuntimeMeta = {
  model?: { me?: { id?: number; name?: string } };
};

export type RuntimeTableDetails = {
  tableId?: number;
  bots?: Array<{ name?: string }>;
};

export type RuntimeTableService = {
  hasTable?: () => boolean;
  getTable?: () => RuntimeTableDetails;
  getPlayers?: () => Array<{ name?: string }>;
  heroIsHost?: () => boolean;
  openSeatCount?: () => number;
  ready?: () => void;
  leave?: () => void;
  addBot?: () => void;
  getRuleValue?: (ruleId: RuntimeEnumValue) => unknown;
};

/** One entry of the table's REQUIRED_CARDS rule: a named card, or a random landscape slot. */
export type RuntimeRequiredCard = {
  cardName?: RuntimeCardName;
};

export type RuntimeKingdomService = {
  /** Requires several cards or landscapes in one rule change. `mode` is CardNames.BACK for a plain pick. */
  addMultiple?: (picks: Array<{ card: RuntimeCardName; mode: RuntimeCardName }>) => void;
};

export type RuntimeAutomatch = {
  botMatch?: (bots: number) => void;
};

export type RuntimeServerMessenger = {
  resign?: () => void;
  newTableRequest?: (rules: unknown[]) => void;
};

export type RuntimeServices = {
  game: RuntimeGame;
  meta: RuntimeMeta;
  tableService: RuntimeTableService;
  automatch: RuntimeAutomatch;
  serverMessenger: RuntimeServerMessenger;
  kingdomService: RuntimeKingdomService;
};

export type RuntimeGame = {
  isRunning?: () => boolean;
  state?: RuntimeState;
  playerModel?: RuntimePlayerModel;
  questionModel?: { openQuestions?: RuntimeQuestion[] };
  metaGameModel?: { gameResult?: RuntimeGameResult | null };
  logModel?: { entries?: RuntimeLogEntry[] };
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

type RuntimeClass = abstract new (...args: never[]) => unknown;
type RuntimeTextPart = { text?: string };

export type DominionGlobals = {
  angular?: AngularLike;
  LANGUAGE?: {
    getLogEntry?: Map<RuntimeEnumValue, string> | Record<string, string>;
    getDeclineButtonText?: Record<string, string>;
    getGameButton?: Record<string, string>;
    getCardMode?: Record<string, string>;
    getDelayedQuestionButton?: Record<string, string>;
  };
  LogLineParser?: new (state: RuntimeState, players: RuntimePlayer[] | undefined, showFullNames: boolean) => {
    parseStory: (story: unknown) => RuntimeTextPart[];
    parseLineWithArguments: (template: string, args: unknown[]) => RuntimeTextPart[];
  };
  QuestionTypes?: Record<string, RuntimeEnumValue>;
  QuestionIds?: Record<string, RuntimeEnumValue>;
  TableRuleIds?: Record<string, RuntimeEnumValue>;
  TableRule?: new (id: RuntimeEnumValue, value: unknown, args?: unknown) => unknown;
  Expansions?: Record<string, unknown>;
  DeclineButtonIds?: Record<string, RuntimeEnumValue>;
  getByOrdinal?: (enumObject: Record<string, RuntimeEnumValue>, ordinal: number) => RuntimeEnumValue | undefined;
  getOrdinal?: (enumObject: Partial<Record<string, RuntimeCardName>>, value: RuntimeCardName) => number;
  [className: string]: unknown;
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

export function getService<Name extends keyof RuntimeServices>(name: Name): RuntimeServices[Name] | undefined {
  try {
    const injector = dominion.angular?.element(document.body).injector();
    return injector?.get(name) as RuntimeServices[Name];
  } catch {
    return undefined;
  }
}

/** The controller of the first `tag` component in the page, e.g. ("kingdom-rules", "$kingdomRulesController"). */
export function getComponentController<Controller>(tag: string, key: string): Controller | undefined {
  const element = document.querySelector(tag);
  return element ? (dominion.angular?.element(element).data?.()?.[key] as Controller | undefined) : undefined;
}

export function getGame(): RuntimeGame | undefined {
  return getService("game");
}

export function isRuntimeInstance(value: unknown, className: string): boolean {
  const constructor = dominion[className];
  return typeof constructor === "function" && value instanceof (constructor as RuntimeClass);
}

/** The key under which `value` appears in a client enum object, e.g. "BUY" for QuestionTypes.BUY. */
export function enumKey(enumObject: Record<string, RuntimeEnumValue> | undefined, value: unknown): string | undefined {
  if (!enumObject || value === undefined || value === null) return undefined;
  return Object.keys(enumObject).find((key) => enumObject[key] === value);
}
