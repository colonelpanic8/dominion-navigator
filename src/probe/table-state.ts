import type { CardCounter } from "../knowledge";
import { Cost, HandTreasure, PileView, SupplyPileView, TableState } from "../agent/types";
import { tableNotes } from "../agent/table-notes";
import { dominion, isRuntimeInstance, RuntimeCard, RuntimeGame, RuntimeZone } from "./runtime-types";

function cost(card: RuntimeCard | undefined): Cost | undefined {
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

function pile(zone: RuntimeZone): PileView | undefined {
  const top = topCard(zone);
  const card = top?.cardName?.name ?? zone.pileName?.name;
  if (!card || card === "Back") return undefined;
  const pileCost = cost(top);
  return {
    card,
    count: zoneCardCount(zone),
    ...(pileCost ? { cost: pileCost } : {}),
    types: (top?.cardName?.types ?? []).map((type) => type.name).filter((name): name is string => Boolean(name))
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
  const result: HandTreasure = { coins: 0, potions: 0, variable: [] };
  for (const zone of zones) {
    if (!isRuntimeInstance(zone, "HandZone") || zone.owner?.index !== me.index) continue;
    for (const stack of zone.cardStacks ?? []) {
      for (const card of stack?.cards ?? []) {
        const name = card.cardName;
        if (!name?.name || !(name.types ?? []).some((type) => type.name === "Treasure")) continue;
        const made = name.coinProduction;
        if (made && !made.isSpecial && typeof made.coin === "number") {
          result.coins += made.coin;
          result.potions += typeof made.potion === "number" ? made.potion : 0;
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
  const isLandscape = (zone: RuntimeZone): boolean =>
    isRuntimeInstance(zone, "SingleLandscapeZone") || isRuntimeInstance(zone, "ReducedLandscapeZone");

  const supply: SupplyPileView[] = neutral
    .filter((zone) => isRuntimeInstance(zone, "SupplyZone"))
    .map((zone) => {
      const view = pile(zone);
      return view ? { ...view, kingdom: isRuntimeInstance(zone, "SupplyCardZone") } : undefined;
    })
    .filter((view): view is SupplyPileView => Boolean(view));
  const landscapes = neutral
    .filter(isLandscape)
    .map(pile)
    .filter((view): view is PileView => Boolean(view));
  const nonSupply = neutral
    .filter((zone) => isRuntimeInstance(zone, "NonSupplyZone") && !isLandscape(zone) && !isRuntimeInstance(zone, "SupplyZone"))
    .map(pile)
    .filter((view): view is PileView => Boolean(view && view.count > 0));

  const number = gameNumber(game);
  const notes = tableNotes(game.state, Object.keys(dominion.ExtraTurnTypes ?? {}));
  const treasure = handTreasure(game, zones);
  const players = (game.state?.players ?? [])
    .filter((player) => player.index !== undefined && player.index >= 0)
    .map((player) => ({ index: player.index!, name: player.name ?? `Player ${player.index}` }));
  const playerMeIndex = game.playerModel?.playerMe?.index;
  const turn = game.state?.activeTurn;

  return {
    ...(number ? { gameNumber: number } : {}),
    running: Boolean(game.isRunning?.()),
    players,
    ...(playerMeIndex !== undefined ? { playerMeIndex } : {}),
    turn: {
      ...(turn?.turnNumber !== undefined ? { number: turn.turnNumber } : {}),
      ...(turn?.ownerId !== undefined ? { activePlayerIndex: turn.ownerId } : {})
    },
    ...(treasure ? { handTreasure: treasure } : {}),
    counters: (game.state?.counters ?? [])
      .filter((counter) => counter.owner?.index !== undefined && counter.counterName?.name && counter.value !== undefined)
      .map((counter) => ({ playerIndex: counter.owner!.index!, name: counter.counterName!.name!, value: counter.value! })),
    supply,
    nonSupply,
    landscapes,
    trash: trash(neutral.filter((zone) => isRuntimeInstance(zone, "TrashZone"))),
    ...(notes.length ? { notes } : {})
  };
}
