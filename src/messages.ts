export const MESSAGE_SOURCE = "dominion-navigator";

export type ZoneOwnerSummary = {
  index?: number;
  name?: string;
  isHero: boolean;
};

export type ZoneSummary = {
  index: number;
  zoneName: string;
  runtimeType: string;
  owner?: ZoneOwnerSummary;
  cardCount: number;
  stackCount: number;
  topCards: string[];
};

export type CardSummary = {
  id: number;
  name: string;
};

export type BoundsSummary = {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
};

export type ZoneStackSummary = {
  cardCount: number;
  anonymousCards: number;
  topCard?: string;
  bounds?: BoundsSummary;
  cards: CardSummary[];
};

export type ZoneDetail = ZoneSummary & {
  stacks: ZoneStackSummary[];
};

export type TurnSummary = {
  ownerId?: number;
  turnNumber?: number;
  controllerId?: number;
};

export type PlayerSummary = {
  index?: number;
  name?: string;
  isHero: boolean;
};

export type NavigatorSnapshot = {
  kind: "snapshot";
  gameInstanceId: string;
  gameRunning: boolean;
  capturedAt: string;
  setupCards?: string[];
  startingDeck?: string[];
  players: PlayerSummary[];
  hero?: PlayerSummary;
  activeTurn?: TurnSummary;
  heroZones: ZoneDetail[];
  playerZones: ZoneDetail[];
};

export type CardMoveSummary = {
  kind: "card-move";
  capturedAt: string;
  phase: "before" | "after";
  turn?: TurnSummary;
  from?: ZoneSummary;
  to?: ZoneSummary;
  cardIds: number[];
  cards: string[];
  cardIdsAfterMoving: number[];
  cardsAfterMoving: string[];
  movementType?: string;
  animationClass?: string;
};

export type KnowledgeWindowCardSummary = {
  name: string;
  count: number;
};

export type ProbeStatusMessage = {
  source: typeof MESSAGE_SOURCE;
  type: "status";
  payload: {
    ok: boolean;
    reason?: string;
  };
};

export type ProbeSnapshotMessage = {
  source: typeof MESSAGE_SOURCE;
  type: "snapshot";
  payload: NavigatorSnapshot;
};

export type ProbeMoveMessage = {
  source: typeof MESSAGE_SOURCE;
  type: "card-move";
  payload: CardMoveSummary;
};

export type ProbeMessage = ProbeStatusMessage | ProbeSnapshotMessage | ProbeMoveMessage;

export type ContentCommand =
  | {
      source: typeof MESSAGE_SOURCE;
      type: "request-snapshot";
    }
  | {
      source: typeof MESSAGE_SOURCE;
      type: "show-draw-knowledge-window";
      payload: {
        sourceZoneIndex: number;
        playerName: string;
        cards: KnowledgeWindowCardSummary[];
        unknownCount: number;
        discardPile?: {
          cards: KnowledgeWindowCardSummary[];
          unknownCount: number;
        };
        excludedFromActiveDeck?: {
          cards: KnowledgeWindowCardSummary[];
          unknownCount: number;
        };
        entireDeck?: {
          cards: KnowledgeWindowCardSummary[];
          unknownCount: number;
        };
      };
    };
