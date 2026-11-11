import type { CardCounter } from "../knowledge";
import { Cost, HandTreasure, PileView, SupplyPileView, TableState } from "../agent/types";
import { splitPiles } from "../agent/split-piles";
import { extraTurnKind, tableNotes } from "../agent/table-notes";
import { dominion, isRuntimeInstance, RuntimeCard, RuntimeGame, RuntimeZone } from "./runtime-types";
import { NeutralZoneKind, neutralZoneKind } from "./zone-kind";

export function runtimeCost(card: RuntimeCard | undefined): Cost | undefined {
  const value = card?.cost;
  if (!value || value.coin === undefined) return undefined;
  return {
    coins: value.coin,
    ...(value.potion ? { potions: value.potion } : {}),
    ...(value.debt ? { debt: value.debt } : {})
  };
}

function zoneCardCount(zone: RuntimeZone): number {
  return (zone.cardStacks ?? []).reduce((total, stack) => total + (stack?.cardCount ?? 0), 0);
}

function topCard(zone: RuntimeZone): RuntimeCard | undefined {
  return (zone.cardStacks ?? []).find((stack) => stack?.topCard?.cardName?.name)?.topCard;
}

let splitPileCache: Map<string, string[]> | undefined;

function splitPileMembers(): Map<string, string[]> {
  if (splitPileCache) return splitPileCache;
  const cards = Object.values(dominion.CardNames ?? {}).map((card) => ({
    name: card?.name ?? "",
    types: (card?.types ?? []).map((type) => type.name ?? "")
  }));
  const piles = splitPiles(cards);
  if (cards.length) splitPileCache = piles;
  return piles;
}

function pile(zone: RuntimeZone): PileView | undefined {
  const top = topCard(zone);
  const card = top?.cardName?.name ?? zone.pileName?.name;
  if (!card || card === "Back") return undefined;
  const pileCost = runtimeCost(top);
  const others = splitPileMembers().get(card)?.filter((name) => name !== card);
  const trait = zone.attachedTrait?.name;
  return {
    card,
    count: zoneCardCount(zone),
    ...(pileCost ? { cost: pileCost } : {}),
    types: (top?.cardName?.types ?? []).map((type) => type.name).filter((name): name is string => Boolean(name)),
    ...(others?.length ? { others } : {}),
    ...(trait && trait !== "Back" ? { trait } : {})
  };
}

function trash(zones: RuntimeZone[]): TableState["trash"] {
  const cards: CardCounter = {};
  let unknown = 0;
  for (const zone of zones) {
    for (const stack of zone.cardStacks ?? []) {
      if (!stack) continue;
      for (const card of stack.cards ?? []) {
        const name = card.cardName?.name;
        if (name && name !== "Back") cards[name] = (cards[name] ?? 0) + 1;
        else unknown += 1;
      }
      unknown += stack.anonymousCards ?? 0;
    }
  }
  return { cards: Object.fromEntries(Object.entries(cards).sort(([a], [b]) => a.localeCompare(b))), unknown };
}

/**
 * The log opens with the game's id. The page text shows it too, but it still
 * names the previous game while a new one loads, so no number is better than that one.
 */
function gameNumber(game: RuntimeGame): string | undefined {
  for (const argument of game.logModel?.entries?.[0]?.logArguments ?? []) {
    const gameId = (argument as { argument?: { gameId?: unknown } } | null)?.argument?.gameId;
    if (typeof gameId === "number") return String(gameId);
  }
  return undefined;
}

function handTreasure(game: RuntimeGame, zones: RuntimeZone[]): HandTreasure | undefined {
  const me = game.playerModel?.playerMe;
  if (me?.index === undefined) return undefined;
  const made: NonNullable<HandTreasure["made"]> = {};
  const result: HandTreasure = { coins: 0, potions: 0, variable: [], made };
  for (const zone of zones) {
    if (!isRuntimeInstance(zone, "HandZone") || zone.owner?.index !== me.index) continue;
    for (const stack of zone.cardStacks ?? []) {
      for (const card of stack?.cards ?? []) {
        const name = card.cardName;
        if (!name?.name || !(name.types ?? []).some((type) => type.name === "Treasure")) continue;
        const production = name.coinProduction;
        if (production && !production.isSpecial && typeof production.coin === "number") {
          const potions = typeof production.potion === "number" ? production.potion : 0;
          result.coins += production.coin;
          result.potions += potions;
          made[name.name] = { coins: production.coin, potions };
        } else {
          result.variable.push(name.name);
        }
      }
    }
  }
  return result;
}

export function summarizeTable(game: RuntimeGame): TableState {
  const zones = (game.state?.zones ?? []).filter((zone): zone is RuntimeZone => Boolean(zone));
  const neutral = zones.filter((zone) => (zone.owner?.index ?? -1) < 0);
  const ofKind = (kind: NeutralZoneKind): RuntimeZone[] =>
    neutral.filter((zone) => neutralZoneKind((className) => isRuntimeInstance(zone, className)) === kind);

  const supply: SupplyPileView[] = ofKind("supply")
    .map((zone) => {
      const view = pile(zone);
      return view ? { ...view, kingdom: isRuntimeInstance(zone, "SupplyCardZone") } : undefined;
    })
    .filter((view): view is SupplyPileView => Boolean(view));
  const landscapeZones = ofKind("landscape");
  const landscapes = landscapeZones
    .map(pile)
    .filter((view): view is PileView => Boolean(view));
  const nonSupply = ofKind("non-supply")
    .map(pile)
    .filter((view): view is PileView => Boolean(view && view.count > 0));

  const number = gameNumber(game);
  const notes = tableNotes(game.state, new Set(landscapeZones));
  const treasure = handTreasure(game, zones);
  const players = (game.state?.players ?? [])
    .filter((player) => player.index !== undefined && player.index >= 0)
    .map((player) => ({ index: player.index!, name: player.name ?? `Player ${player.index}` }));
  const playerMeIndex = game.playerModel?.playerMe?.index;
  const turn = game.state?.activeTurn;
  const extra = extraTurnKind(turn?.turnType, Object.keys(dominion.ExtraTurnTypes ?? {}));

  return {
    ...(number ? { gameNumber: number } : {}),
    running: Boolean(game.isRunning?.()),
    players,
    ...(playerMeIndex !== undefined ? { playerMeIndex } : {}),
    turn: {
      ...(turn?.turnNumber !== undefined ? { number: turn.turnNumber } : {}),
      ...(turn?.ownerId !== undefined ? { activePlayerIndex: turn.ownerId } : {}),
      ...(extra ? { extra } : {})
    },
    ...(treasure ? { handTreasure: treasure } : {}),
    counters: (game.state?.counters ?? [])
      .filter((counter) => counter.owner?.index !== undefined && counter.counterName?.name && counter.value !== undefined)
      .map((counter) => ({ playerIndex: counter.owner!.index!, name: counter.counterName!.name!, value: counter.value! })),
    supply,
    nonSupply,
    landscapes,
    trash: trash(ofKind("trash")),
    ...(notes.length ? { notes } : {})
  };
}
