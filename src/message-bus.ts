import { NavigatorMessage } from "./messages";
import { parseNavigatorMessage } from "./message-validation";

export function postNavigatorMessage(message: NavigatorMessage): void {
  window.postMessage(message, window.location.origin);
}

/**
 * Both sides share one window, so each listener also sees messages meant for the
 * other side. Any page script can post too, so messages are validated first.
 */
export function listenForNavigatorMessages(handler: (message: NavigatorMessage) => void): void {
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window) return;
    const message = parseNavigatorMessage(event.data);
    if (message) handler(message);
  });
}
