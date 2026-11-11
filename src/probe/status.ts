import { postNavigatorMessage } from "../message-bus";
import { MESSAGE_SOURCE } from "../messages";

export function postStatus(ok: boolean, reason?: string): void {
  postNavigatorMessage({
    source: MESSAGE_SOURCE,
    type: "status",
    payload: reason === undefined ? { ok } : { ok, reason }
  });
}

export function reportHookError(message: string): void {
  try {
    postStatus(false, message);
  } catch {
    // Keep the probe observational: reporting failures must never affect the game client.
  }
}

export const GAME_NOT_READY = "Dominion game service is not ready yet.";
