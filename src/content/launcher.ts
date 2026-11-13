// The overlay's side of the launcher channel (see agent/launcher-protocol.ts). The binding exists
// only when this tab is in the Chrome that `npm run launch:chrome` started.
import { LAUNCHER_BINDING, LAUNCHER_REPLY, LauncherReply, LauncherRequest } from "../agent/launcher-protocol";

const REPLY_TIMEOUT_MS = 10_000;

type Globals = typeof globalThis & {
  [LAUNCHER_BINDING]?: (payload: string) => void;
  [LAUNCHER_REPLY]?: (payload: string) => void;
};

const globals = globalThis as Globals;
const pending = new Map<number, (reply: LauncherReply) => void>();
let nextId = 1;

globals[LAUNCHER_REPLY] = (payload: string) => {
  let reply: LauncherReply;
  try {
    reply = JSON.parse(payload) as LauncherReply;
  } catch {
    return;
  }
  pending.get(reply.id)?.(reply);
  pending.delete(reply.id);
};

export function launcherAvailable(): boolean {
  return typeof globals[LAUNCHER_BINDING] === "function";
}

type Request = LauncherRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

export function callLauncher(request: Request): Promise<LauncherReply> {
  const binding = globals[LAUNCHER_BINDING];
  const id = nextId++;
  if (!binding) return Promise.resolve({ id, ok: false, error: "This Chrome has no Dominion launcher. Start it with the dominion command." });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ id, ok: false, error: "The launcher did not answer." });
    }, REPLY_TIMEOUT_MS);
    pending.set(id, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    binding(JSON.stringify({ ...request, id }));
  });
}
