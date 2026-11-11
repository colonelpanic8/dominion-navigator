import { ActionResult, SessionState } from "../agent/types";
import {
  dominion,
  FIRST_BOT_PLAYER_ID,
  getComponentController,
  getGame,
  getService,
  RuntimeCardName,
  RuntimeRequiredCard,
  RuntimeTableService
} from "./runtime-types";

const POLL_MS = 200;
const START_TIMEOUT_MS = 30_000;
const SCREEN_CHANGE_TIMEOUT_MS = 10_000;
const RULE_CHANGE_TIMEOUT_MS = 5_000;

export type NewGameOptions = {
  bots: number;
  /** Cards and landscapes the kingdom must contain; the server fills the rest at random. */
  kingdom?: string[];
};

class ActionError extends Error {}

export function readSession(): SessionState {
  const name = getService("meta")?.model?.me?.name;
  const user = name && name !== "NoName" ? name : undefined;
  const game = getGame();
  const tableService = getService("tableService");

  let table: SessionState["table"];
  if (tableService?.hasTable?.()) {
    const details = tableService.getTable?.();
    const names = (list: Array<{ name?: string }> | undefined): string[] => (list ?? []).map((item) => item.name ?? "?");
    table = {
      ...(details?.tableId !== undefined ? { id: details.tableId } : {}),
      host: Boolean(tableService.heroIsHost?.()),
      players: names(tableService.getPlayers?.()),
      bots: names(details?.bots),
      openSeats: tableService.openSeatCount?.() ?? 0
    };
  }

  const base = { ...(user ? { user } : {}), ...(table ? { table } : {}) };
  if (game?.isRunning?.()) {
    const opponents = (game.state?.players ?? []).filter((player) => !player.isMe);
    return {
      screen: "game",
      ...base,
      game: {
        over: Boolean(game.metaGameModel?.gameResult),
        opponentsAreBots: opponents.length > 0 && opponents.every((player) => (player.playerId ?? 0) >= FIRST_BOT_PLAYER_ID)
      }
    };
  }
  if (table) return { screen: "table", ...base };
  return { screen: user ? "lobby" : "login", ...base };
}

async function waitUntil(done: () => boolean, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (!done()) {
    if (Date.now() - started >= timeoutMs) return false;
    await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
  }
  return true;
}

const inFreshGame = (): boolean => {
  const session = readSession();
  return session.screen === "game" && !session.game?.over;
};

function requiredCards(tableService: RuntimeTableService): RuntimeRequiredCard[] {
  const ruleId = dominion.TableRuleIds?.REQUIRED_CARDS;
  const value = ruleId ? tableService.getRuleValue?.(ruleId) : undefined;
  return Array.isArray(value) ? (value as RuntimeRequiredCard[]) : [];
}

function requiredCardNames(tableService: RuntimeTableService): string[] {
  return requiredCards(tableService)
    .map((entry) => entry.cardName?.name)
    .filter((name): name is string => Boolean(name));
}

function resolveKingdom(names: string[]): RuntimeCardName[] {
  const known = new Map(
    Object.values(dominion.CardNames ?? {})
      .filter((card): card is RuntimeCardName => Boolean(card?.name))
      .map((card) => [card.name!.toLowerCase(), card])
  );
  const unknown = names.filter((name) => !known.has(name.toLowerCase()));
  if (unknown.length > 0) throw new ActionError(`unknown card name(s): ${unknown.join(", ")}`);
  return names.map((name) => known.get(name.toLowerCase())!);
}

/** Rule changes round-trip through the server, so each step waits for the table to show it. */
async function setKingdom(tableService: RuntimeTableService, cards: RuntimeCardName[]): Promise<void> {
  if (requiredCardNames(tableService).length > 0) {
    const rules = getComponentController<{ clearKingdom?: () => void }>("kingdom-rules", "$kingdomRulesController");
    if (!rules?.clearKingdom) throw new ActionError("the table's kingdom editor is not available");
    rules.clearKingdom();
    if (!(await waitUntil(() => requiredCardNames(tableService).length === 0, RULE_CHANGE_TIMEOUT_MS))) {
      throw new ActionError("the table's kingdom could not be cleared");
    }
  }
  if (cards.length === 0) return;

  const kingdomService = getService("kingdomService");
  const back = dominion.CardNames?.BACK;
  if (!kingdomService?.addMultiple || !back) throw new ActionError("the client's kingdom service is not available");
  kingdomService.addMultiple(cards.map((card) => ({ card, mode: back })));
  const missing = (): string[] => {
    const required = new Set(requiredCardNames(tableService));
    return cards.map((card) => card.name!).filter((name) => !required.has(name));
  };
  if (!(await waitUntil(() => missing().length === 0, RULE_CHANGE_TIMEOUT_MS))) {
    throw new ActionError(`the table did not accept: ${missing().join(", ")}`);
  }
}

async function seatBots(tableService: RuntimeTableService, bots: number): Promise<void> {
  for (let seated = readSession().table?.bots.length ?? 0; seated < bots; seated += 1) {
    tableService.addBot?.();
    if (!(await waitUntil(() => (readSession().table?.bots.length ?? 0) > seated, RULE_CHANGE_TIMEOUT_MS))) {
      throw new ActionError(`the table would not seat ${bots} bot(s)`);
    }
  }
}

async function startGame(options: NewGameOptions): Promise<SessionState> {
  const { bots } = options;
  if (!Number.isInteger(bots) || bots < 1 || bots > 3) throw new ActionError("bots must be 1, 2 or 3");
  const kingdom = resolveKingdom(options.kingdom ?? []);
  // A table made here seats two; only the lobby's bot match makes bigger ones, and it picks the kingdom.
  if (kingdom.length > 0 && bots !== 1) throw new ActionError("a chosen kingdom is only supported against 1 bot");

  // Each pass moves one screen closer to a running game, so a few passes cover every route.
  for (let pass = 0; pass < 5; pass += 1) {
    const session = readSession();
    switch (session.screen) {
      case "login":
        throw new ActionError("not logged in to dominion.games");
      case "game": {
        if (!session.game?.over) throw new ActionError("a game is in progress; resign it first");
        const dismiss = document.querySelector<HTMLElement>('game-ended-notification [ng-click="$ctrl.ok()"]');
        if (!dismiss) throw new ActionError("the end-of-game notice could not be dismissed");
        dismiss.click();
        await waitUntil(() => readSession().screen !== "game", SCREEN_CHANGE_TIMEOUT_MS);
        break;
      }
      case "lobby": {
        if (kingdom.length === 0) {
          const automatch = getService("automatch");
          if (!automatch?.botMatch) throw new ActionError("the client's automatch service is not available");
          automatch.botMatch(bots);
          if (!(await waitUntil(inFreshGame, START_TIMEOUT_MS))) throw new ActionError("no bot game started");
          return readSession();
        }
        const starter = getComponentController<{ start?: () => void }>("table-starter", "$tableStarterController");
        if (!starter?.start) throw new ActionError("the lobby's table starter is not available");
        starter.start();
        if (!(await waitUntil(() => readSession().screen === "table", SCREEN_CHANGE_TIMEOUT_MS))) throw new ActionError("no table was created");
        break;
      }
      case "table": {
        const tableService = getService("tableService");
        const table = session.table;
        const seatsFit = table?.bots.length === bots || (kingdom.length > 0 && table?.bots.length === 0);
        if (!tableService || !table?.host || table.players.length !== 1 || !seatsFit) {
          tableService?.leave?.();
          await waitUntil(() => readSession().screen === "lobby", SCREEN_CHANGE_TIMEOUT_MS);
          break;
        }
        await seatBots(tableService, bots);
        await setKingdom(tableService, kingdom);
        tableService.ready?.();
        if (!(await waitUntil(inFreshGame, START_TIMEOUT_MS))) {
          throw new ActionError(
            kingdom.length > 0
              ? "the table did not start a game; the kingdom may name cards this account cannot play (a subscription unlocks the expansions)"
              : "the table did not start a game"
          );
        }
        return readSession();
      }
    }
  }
  throw new ActionError(`could not reach a new game from the ${readSession().screen} screen`);
}

async function attempt(action: () => Promise<SessionState>): Promise<ActionResult> {
  try {
    return { ok: true, session: await action() };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Starts an unrated game against bots from wherever the client is: it dismisses a
 * finished game, reuses a table it hosts alone, and otherwise goes through the
 * lobby (a bot match for a random kingdom, a new table for a chosen one).
 */
export function startBotGame(options: NewGameOptions): Promise<ActionResult> {
  return attempt(() => startGame(options));
}

/** Resigns the running game. The result arrives on the game screen; a new game dismisses it. */
export function resignGame(): Promise<ActionResult> {
  return attempt(async () => {
    const session = readSession();
    if (session.screen !== "game") throw new ActionError(`no game is running (the client is on the ${session.screen} screen)`);
    if (session.game?.over) return session;
    if (!getGame()?.playerModel?.playerMe) throw new ActionError("spectating: this account is not a player in this game");
    const messenger = getService("serverMessenger");
    if (!messenger?.resign) throw new ActionError("the client's server messenger is not available");
    messenger.resign();
    const ended = (): boolean => {
      const next = readSession();
      return next.screen !== "game" || Boolean(next.game?.over);
    };
    if (!(await waitUntil(ended, SCREEN_CHANGE_TIMEOUT_MS))) throw new ActionError("the game did not end after resigning");
    return readSession();
  });
}
