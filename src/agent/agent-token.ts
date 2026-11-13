// The token the overlay's Agent box hands to an agent, which joins the game with it through the
// `join` MCP tool. It lives in the tab's sessionStorage, which the content script and the page probe
// share, so it survives a reload of the tab and ends when the player takes the game back.

export const AGENT_TOKEN_KEY = "dominionNavigatorAgentToken";

/** `gameNumber` is set by the first join, and ties the token to that game. */
export type AgentTokenRecord = { token: string; gameNumber?: string };

export type JoinResult = { ok: true; gameNumber?: string } | { ok: false; error: string };

export function parseAgentTokenRecord(raw: string | null): AgentTokenRecord | undefined {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (typeof value !== "object" || value === null) return undefined;
    const { token, gameNumber } = value as Record<string, unknown>;
    if (typeof token !== "string" || !token) return undefined;
    return { token, ...(typeof gameNumber === "string" ? { gameNumber } : {}) };
  } catch {
    return undefined;
  }
}

export function newAgentToken(random: Uint8Array): string {
  return `dn-${Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Whether `token` is this tab's and still good for the game on screen, with the record to store when it is. */
export function claimAgentToken(
  record: AgentTokenRecord | undefined,
  token: string,
  gameNumber: string | undefined
): { ok: true; record: AgentTokenRecord } | { ok: false; error: string } {
  if (!record || record.token !== token) return { ok: false, error: "This tab has no such agent token: the player took the game back, or a new game started." };
  if (record.gameNumber && gameNumber && record.gameNumber !== gameNumber) {
    return { ok: false, error: `This agent token was for game #${record.gameNumber}, which is over.` };
  }
  return { ok: true, record: { token, ...(record.gameNumber ?? gameNumber ? { gameNumber: (record.gameNumber ?? gameNumber)! } : {}) } };
}
