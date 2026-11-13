import { join } from "node:path";
import { expandHome, loadConfig, stateDir } from "./config.mjs";

export const DEFAULT_DEBUG_PORT = 9226;
export const LAUNCHER_PID_FILE = "launcher.pid";

export function chromeProfile() {
  return process.env.DOMINION_NAVIGATOR_CHROME_PROFILE ?? expandHome(loadConfig().chrome?.profile) ?? join(stateDir(), "chrome-profile");
}

export function debugPort(...legacyEnvNames) {
  for (const name of ["DOMINION_NAVIGATOR_DEBUG_PORT", ...legacyEnvNames]) {
    const value = process.env[name];
    if (value) return Number(value);
  }
  return loadConfig().chrome?.debugPort ?? DEFAULT_DEBUG_PORT;
}

export function debugUrl(port, path) {
  return `http://127.0.0.1:${port}${path}`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

/**
 * Request/response bookkeeping for a CDP transport. `write` sends one serialized
 * command; the caller feeds each raw incoming message to `receive`. Messages that
 * answer no command (events) go to `onEvent`.
 */
export function createCdpSession(write, { timeoutMs, onEvent } = {}) {
  let nextId = 1;
  const pending = new Map();

  return {
    send(method, params = {}, sessionId = undefined) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const timer =
          timeoutMs === undefined
            ? undefined
            : setTimeout(() => {
                if (pending.delete(id)) reject(new Error(`${method} timed out`));
              }, timeoutMs);
        pending.set(id, (message) => {
          clearTimeout(timer);
          resolve(message);
        });
        write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    receive(raw) {
      const message = JSON.parse(raw);
      if (!message.id) {
        onEvent?.(message);
        return;
      }
      const resolve = pending.get(message.id);
      if (!resolve) return;
      pending.delete(message.id);
      resolve(message);
    }
  };
}

export async function connectCdp(webSocketDebuggerUrl, options) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  const session = createCdpSession((data) => ws.send(data), options);
  ws.onmessage = (event) => session.receive(typeof event.data === "string" ? event.data : event.data.toString());
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  return {
    send: session.send,
    close: () => ws.close()
  };
}

export async function evaluate(client, expression, options = {}) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    ...options
  });
  if (response.error) throw new Error(JSON.stringify(response.error));
  const details = response.result?.exceptionDetails;
  if (details) throw new Error(details.exception?.description ?? details.text ?? JSON.stringify(details));
  return response.result?.result?.value;
}
