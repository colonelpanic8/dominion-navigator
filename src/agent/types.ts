import type { CardCounter } from "../knowledge";

export const AGENT_VIEW_SCHEMA = "dominion-navigator/agent-view@1";

export type Cost = {
  coins: number;
  potions?: number;
  debt?: number;
};

export type PileView = {
  card: string;
  count: number;
  cost?: Cost;
  types: string[];
};

export type SupplyPileView = PileView & {
  kingdom: boolean;
};

/** Public table state read from the client: everything here is visible to all players. */
export type TableState = {
  gameNumber?: string;
  running: boolean;
  result?: GameResult;
  players: Array<{ index: number; name: string }>;
  /** Undefined when the account is spectating. */
  playerMeIndex?: number;
  turn: {
    number?: number;
    activePlayerIndex?: number;
  };
  /** The Treasures in this seat's hand, not yet played. Undefined when spectating. */
  handTreasure?: HandTreasure;
  counters: Array<{ playerIndex: number; name: string; value: number }>;
  supply: SupplyPileView[];
  nonSupply: PileView[];
  landscapes: PileView[];
  trash: { cards: CardCounter; unknown: number };
  /**
   * Public state with no field of its own, one sentence each: tokens, counters on
   * piles or cards, bought projects, traits, reminders and unusual turns. Absent when there is none.
   */
  notes?: string[];
};

/**
 * One open client question, flattened to plain data. Complex questions keep
 * their subquestion tree; `path` locates a node from the top-level question.
 */
export type RawQuestion = {
  questionClass: "choice" | "number" | "name" | "delayed" | "complex";
  type: string;
  questionId: string;
  prompt: string;
  path: number[];
  min?: number;
  max?: number;
  declineLabel?: string;
  elements?: RawQuestionElement[];
  subquestions?: RawQuestion[];
  /** For delayed questions: the label of the accept button. */
  acceptLabel?: string;
  /** For name questions: names that can be chosen. */
  nameChoices?: string[];
};

export type RawQuestionElement = {
  kind: "card" | "button" | "mode" | "card-name" | "ability" | "zone" | "other";
  label: string;
  card?: string;
  /** The card's current cost, for card elements. */
  cost?: Cost;
};

export type DecisionOptionKind = RawQuestionElement["kind"] | "decline" | "number" | "accept" | "keep-order";

export type DecisionOption = {
  index: number;
  group: number;
  kind: DecisionOptionKind;
  label: string;
  card?: string;
  /** The card's current cost, when the client gave one. */
  cost?: Cost;
  value?: number;
};

export type DecisionGroup = {
  group: number;
  kind: string;
  prompt: string;
  min: number;
  max: number;
  /** Set when the order of the chosen options is the answer: the first goes on the bottom, the last on top. */
  order?: "bottom-to-top";
};

export type Decision = {
  id: string;
  prompt: string;
  questionId: string;
  kind: string;
  /** Present when the decision has a single option group. */
  min?: number;
  max?: number;
  groups: DecisionGroup[];
  /**
   * Present when the groups are alternatives: an answer takes options from one
   * entry's groups only. Groups in the same entry may be answered together.
   */
  alternatives?: number[][];
  options: DecisionOption[];
};

export type ZoneView = {
  count: number;
  known: CardCounter;
  unknown: number;
};

export type UncertainCards = {
  zones: string[];
  count: number;
  /** Cards that are somewhere in these zones, in some combination. */
  candidates: CardCounter;
  /** How many of the candidates are outside these zones. */
  outside: number;
};

export type PlayerView = {
  name: string;
  index: number;
  points?: number;
  hand: ZoneView;
  inPlay: ZoneView;
  deck: ZoneView & { orderKnown: false };
  discard: ZoneView;
  otherZones: Record<string, ZoneView>;
  owned: { known: CardCounter; unknown: number };
  uncertain: UncertainCards[];
  /** Known owned cards whose location is not tracked. */
  unlocated: CardCounter;
  counters: Record<string, number>;
};

export type HandTreasure = {
  /** What the fixed-value Treasures in hand make together. */
  coins: number;
  potions: number;
  /** Treasures whose value depends on the game (Bank, Fool's Gold, ...), by name. */
  variable: string[];
};

export type TurnView = {
  number?: number;
  activePlayer?: string;
  yourTurn: boolean;
  phase: "action" | "buy" | null;
  phaseSource: "derived-from-decision";
  actions?: number;
  buys?: number;
  coins?: number;
  potions?: number;
  debt?: number;
  /** On your turn: what the Treasures still in your hand would add. */
  treasureInHand?: HandTreasure;
};

export type GameResult = {
  players: Array<{ name: string; rank: number; points: number; turns: number; resigned: boolean }>;
};

export type AgentView = {
  schema: typeof AGENT_VIEW_SCHEMA;
  game: { number?: string; running: boolean; result?: GameResult };
  spectating: boolean;
  turn: TurnView;
  you: PlayerView | null;
  opponents: PlayerView[];
  supply: SupplyPileView[];
  nonSupply: PileView[];
  landscapes: PileView[];
  trash: { cards: CardCounter; unknown: number };
  /** See `TableState.notes`. */
  notes?: string[];
  decision: Decision | null;
  sinceLastDecision: string[];
};

export type GlossaryEntry = {
  name: string;
  types: string[];
  expansion?: string;
  cost?: Cost;
  text: string;
};

export type CardGlossary = Record<string, GlossaryEntry>;

/** Where the client is, so a harness can tell why there is no decision without looking at the page. */
export type SessionState = {
  screen: "login" | "lobby" | "table" | "game";
  user?: string;
  table?: { id?: number; host: boolean; players: string[]; bots: string[]; openSeats: number };
  /** Present on the game screen. `over`: the result is in and the end-of-game notice is still up. */
  game?: { over: boolean; opponentsAreBots: boolean };
};

export type LogEntry = {
  index: number;
  /** Nesting depth the client indents the line by. */
  depth: number;
  text: string;
};

export type LogPage = {
  entries: LogEntry[];
  /** Index of the newest entry in the game log, or -1 when it is empty. */
  lastIndex: number;
};

export type ActionResult = { ok: true; session: SessionState } | { ok: false; error: string };
