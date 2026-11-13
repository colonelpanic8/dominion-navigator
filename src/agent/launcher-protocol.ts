// The channel between the overlay and the Chrome launcher (`npm run launch:chrome`), which starts
// agents for the player. The launcher adds a CDP binding to the extension's content-script world
// only, so the page's own scripts cannot call it, and answers by calling the reply function there.

export const LAUNCHER_BINDING = "__dominionNavigatorLauncher";
export const LAUNCHER_REPLY = "__dominionNavigatorLauncherReply";
export const MAX_AGENT_PROMPT_CHARS = 20_000;

export type AgentKind = "ask" | "play";

export type LauncherRequest =
  | { id: number; type: "start"; kind: AgentKind; token: string; prompt: string }
  | { id: number; type: "status"; token: string }
  | { id: number; type: "stop"; token: string; agentId?: string };

export type AgentState = "running" | "done" | "failed" | "stopped";

export type AgentStatus = {
  id: string;
  kind: AgentKind;
  state: AgentState;
  startedAt: number;
  /** Moves answered with `step`. */
  moves: number;
  /** The reason given with the latest `step`. */
  lastReason?: string;
  /** The latest text the agent wrote, or its final answer once it is done. */
  text?: string;
  error?: string;
  logPath: string;
};

export type LauncherReply = { id: number } & ({ ok: true; agents: AgentStatus[] } | { ok: false; error: string; agents?: AgentStatus[] });

const TOKEN_PATTERN = /^dn-[0-9a-f]{8,64}$/;

/** The request in a binding payload, or why it is not one. */
export function parseLauncherRequest(payload: string): { ok: true; request: LauncherRequest } | { ok: false; id?: number; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return { ok: false, error: "The request is not JSON." };
  }
  if (typeof value !== "object" || value === null) return { ok: false, error: "The request is not an object." };
  const { id, type, token, kind, prompt, agentId } = value as Record<string, unknown>;
  if (typeof id !== "number") return { ok: false, error: "The request has no id." };
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return { ok: false, id, error: "The request has no valid agent token." };
  switch (type) {
    case "status":
      return { ok: true, request: { id, type, token } };
    case "stop":
      if (agentId !== undefined && typeof agentId !== "string") return { ok: false, id, error: "agentId must be a string." };
      return { ok: true, request: { id, type, token, ...(agentId !== undefined ? { agentId } : {}) } };
    case "start":
      if (kind !== "ask" && kind !== "play") return { ok: false, id, error: "kind must be ask or play." };
      if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_AGENT_PROMPT_CHARS) return { ok: false, id, error: "The prompt is empty or too long." };
      return { ok: true, request: { id, type, kind, token, prompt } };
    default:
      return { ok: false, id, error: `Unknown request type ${JSON.stringify(type)}.` };
  }
}
