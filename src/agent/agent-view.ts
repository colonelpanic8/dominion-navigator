import type { CardCounter, KnowledgeSummary, PlayerDeckKnowledge, ZoneKnowledge } from "../knowledge";
import { AGENT_VIEW_SCHEMA, AgentView, Decision, PlayerView, TableState, TurnView, ZoneView } from "./types";

export type AgentViewInput = {
  table: TableState;
  /** The content script's knowledge model; the only source of per-player card identities. */
  knowledge: KnowledgeSummary | undefined;
  decision: Decision | null;
  sinceLastDecision: string[];
};

const ZONE_FIELDS: Record<string, "hand" | "inPlay" | "deck" | "discard"> = {
  HandZone: "hand",
  InPlayZone: "inPlay",
  DrawZone: "deck",
  DiscardZone: "discard"
};

/** Reported as `points` or on the turn view instead of under per-player counters. */
const TURN_COUNTERS = new Set(["Points", "Actions", "Buys", "Coins", "Potions"]);

function emptyZone(): ZoneView {
  return { count: 0, known: {}, unknown: 0 };
}

function addCounter(target: CardCounter, source: CardCounter): void {
  for (const [card, count] of Object.entries(source)) target[card] = (target[card] ?? 0) + count;
}

function sortedCounter(counter: CardCounter): CardCounter {
  return Object.fromEntries(Object.entries(counter).sort(([a], [b]) => a.localeCompare(b)));
}

function otherZoneKey(zoneName: string): string {
  const base = zoneName.replace(/Zone$/, "");
  return base.charAt(0).toLowerCase() + base.slice(1);
}

/** Known cards come only from the zone's exact knowledge; candidates stay in `uncertain`. */
function addZone(view: ZoneView, zone: ZoneKnowledge): void {
  view.count += zone.totalCount;
  addCounter(view.known, zone.knownCards);
  view.unknown += zone.unknownCount + zone.ambiguousCount;
}

function playerCounters(table: TableState, playerIndex: number): Record<string, number> {
  const counters: Record<string, number> = {};
  for (const counter of table.counters) {
    if (counter.playerIndex === playerIndex) counters[counter.name] = counter.value;
  }
  return counters;
}

function playerView(table: TableState, player: { index: number; name: string }, knowledge: PlayerDeckKnowledge | undefined): PlayerView {
  const fields: Record<"hand" | "inPlay" | "deck" | "discard", ZoneView> = {
    hand: emptyZone(),
    inPlay: emptyZone(),
    deck: emptyZone(),
    discard: emptyZone()
  };
  const otherZones: Record<string, ZoneView> = {};

  for (const zone of knowledge?.zones ?? []) {
    const field = ZONE_FIELDS[zone.zoneName];
    if (field) {
      addZone(fields[field], zone);
    } else {
      const key = otherZoneKey(zone.zoneName);
      addZone((otherZones[key] ??= emptyZone()), zone);
    }
  }
  for (const view of [...Object.values(fields), ...Object.values(otherZones)]) view.known = sortedCounter(view.known);

  const zoneLabel = (zoneName: string): string => ZONE_FIELDS[zoneName] ?? otherZoneKey(zoneName);
  const uncertain = [
    ...(knowledge?.ambiguousLocationGroups ?? []).map((group) => ({ ...group, outsideCount: 0 })),
    ...(knowledge?.locationCandidateGroups ?? [])
  ].map((group) => ({
    zones: group.zoneNames.map(zoneLabel),
    count: group.totalCount,
    candidates: sortedCounter(group.knownCards),
    outside: group.outsideCount
  }));

  const counters = playerCounters(table, player.index);
  const points = counters.Points;
  const otherCounters = Object.fromEntries(Object.entries(counters).filter(([name]) => !TURN_COUNTERS.has(name)));
  return {
    name: player.name,
    index: player.index,
    ...(points !== undefined ? { points } : {}),
    hand: fields.hand,
    inPlay: fields.inPlay,
    deck: { ...fields.deck, orderKnown: false },
    discard: fields.discard,
    otherZones,
    owned: { known: sortedCounter(knowledge?.totalKnownOwned ?? {}), unknown: knowledge?.totalUnknownOwned ?? 0 },
    uncertain,
    unlocated: sortedCounter(knowledge?.unlocatedKnownCards ?? {}),
    counters: otherCounters
  };
}

function derivePhase(decision: Decision | null): TurnView["phase"] {
  if (!decision) return null;
  if (decision.questionId.includes("BUY_PHASE")) return "buy";
  if (decision.questionId.includes("ACTION_PHASE")) return "action";
  return null;
}

function turnView(table: TableState, decision: Decision | null): TurnView {
  const active = table.players.find((player) => player.index === table.turn.activePlayerIndex);
  const counters = active ? playerCounters(table, active.index) : {};
  const counter = (name: string): Record<string, number> => (counters[name] !== undefined ? { [name.toLowerCase()]: counters[name]! } : {});
  return {
    ...(table.turn.number !== undefined ? { number: table.turn.number } : {}),
    ...(active ? { activePlayer: active.name } : {}),
    yourTurn: table.playerMeIndex !== undefined && table.turn.activePlayerIndex === table.playerMeIndex,
    phase: derivePhase(decision),
    phaseSource: "derived-from-decision",
    ...counter("Actions"),
    ...counter("Buys"),
    ...counter("Coins"),
    ...counter("Potions"),
    ...counter("Debt")
  };
}

export function buildAgentView({ table, knowledge, decision, sinceLastDecision }: AgentViewInput): AgentView {
  const spectating = table.playerMeIndex === undefined;
  const knowledgeFor = (index: number): PlayerDeckKnowledge | undefined =>
    knowledge?.players.find((player) => player.player.index === index);
  const me = spectating ? undefined : table.players.find((player) => player.index === table.playerMeIndex);

  return {
    schema: AGENT_VIEW_SCHEMA,
    game: {
      ...(table.gameNumber ? { number: table.gameNumber } : {}),
      running: table.running,
      ...(table.result ? { result: table.result } : {})
    },
    spectating,
    turn: turnView(table, spectating ? null : decision),
    you: me ? playerView(table, me, knowledgeFor(me.index)) : null,
    opponents: table.players.filter((player) => player !== me).map((player) => playerView(table, player, knowledgeFor(player.index))),
    supply: table.supply,
    nonSupply: table.nonSupply,
    landscapes: table.landscapes,
    trash: table.trash,
    ...(table.notes?.length ? { notes: table.notes } : {}),
    decision: spectating ? null : decision,
    sinceLastDecision
  };
}
