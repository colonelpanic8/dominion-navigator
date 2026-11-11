import { ActionResult, SessionState } from "../agent/types";
import { FIRST_BOT_PLAYER_ID, getGame, getService } from "./runtime-types";

const POLL_MS = 200;
const START_TIMEOUT_MS = 30_000;
const SCREEN_CHANGE_TIMEOUT_MS = 10_000;

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

async function waitFor(done: (session: SessionState) => boolean, timeoutMs: number): Promise<SessionState> {
  const started = Date.now();
  for (;;) {
    const session = readSession();
    if (done(session) || Date.now() - started >= timeoutMs) return session;
    await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
  }
}

const inFreshGame = (session: SessionState): boolean => session.screen === "game" && !session.game?.over;

function dismissGameEndedNotice(): boolean {
  const button = document.querySelector<HTMLElement>('game-ended-notification [ng-click="$ctrl.ok()"]');
  button?.click();
  return Boolean(button);
}

/**
 * Starts an unrated game against bots from wherever the client is: it dismisses a
 * finished game, reuses a table that already seats the right bots, and otherwise
 * leaves for the lobby and asks for a bot match there.
 */
export async function startBotGame(bots: number): Promise<ActionResult> {
  if (!Number.isInteger(bots) || bots < 1 || bots > 3) return { ok: false, error: "bots must be 1, 2 or 3" };

  // Each pass moves one screen closer to a running game, so a few passes cover every route.
  for (let pass = 0; pass < 4; pass += 1) {
    const session = readSession();
    switch (session.screen) {
      case "login":
        return { ok: false, error: "not logged in to dominion.games" };
      case "game": {
        if (!session.game?.over) return { ok: false, error: "a game is in progress; resign it first" };
        if (!dismissGameEndedNotice()) return { ok: false, error: "the end-of-game notice could not be dismissed" };
        await waitFor((next) => next.screen !== "game", SCREEN_CHANGE_TIMEOUT_MS);
        break;
      }
      case "table": {
        const table = session.table;
        const tableService = getService("tableService");
        if (table?.host && table.players.length === 1 && table.bots.length === bots && table.openSeats === 0) {
          tableService?.ready?.();
          const started = await waitFor(inFreshGame, START_TIMEOUT_MS);
          return inFreshGame(started) ? { ok: true, session: started } : { ok: false, error: "the table did not start a game" };
        }
        tableService?.leave?.();
        await waitFor((next) => next.screen === "lobby", SCREEN_CHANGE_TIMEOUT_MS);
        break;
      }
      case "lobby": {
        const automatch = getService("automatch");
        if (!automatch?.botMatch) return { ok: false, error: "the client's automatch service is not available" };
        automatch.botMatch(bots);
        const started = await waitFor(inFreshGame, START_TIMEOUT_MS);
        return inFreshGame(started) ? { ok: true, session: started } : { ok: false, error: "no bot game started" };
      }
    }
  }
  return { ok: false, error: `could not reach a new game from the ${readSession().screen} screen` };
}

/** Resigns the running game. The result arrives on the game screen; a new game dismisses it. */
export async function resignGame(): Promise<ActionResult> {
  const session = readSession();
  if (session.screen !== "game") return { ok: false, error: `no game is running (the client is on the ${session.screen} screen)` };
  if (session.game?.over) return { ok: true, session };
  if (!getGame()?.playerModel?.playerMe) return { ok: false, error: "spectating: this account is not a player in this game" };
  const messenger = getService("serverMessenger");
  if (!messenger?.resign) return { ok: false, error: "the client's server messenger is not available" };
  messenger.resign();
  const after = await waitFor((next) => next.screen !== "game" || Boolean(next.game?.over), SCREEN_CHANGE_TIMEOUT_MS);
  return after.screen !== "game" || after.game?.over ? { ok: true, session: after } : { ok: false, error: "the game did not end after resigning" };
}
