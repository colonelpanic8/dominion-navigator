import { AGENT_TOKEN_KEY, newAgentToken, parseAgentTokenRecord } from "../agent/agent-token";

function stored(): string | undefined {
  try {
    return parseAgentTokenRecord(window.sessionStorage.getItem(AGENT_TOKEN_KEY))?.token;
  } catch {
    return undefined;
  }
}

/** Whether an agent holding this tab's token may still play. */
export function agentTokenActive(): boolean {
  return stored() !== undefined;
}

/** This tab's agent token, issuing one when there is none. */
export function agentToken(): string {
  const existing = stored();
  if (existing) return existing;
  const token = newAgentToken(crypto.getRandomValues(new Uint8Array(16)));
  window.sessionStorage.setItem(AGENT_TOKEN_KEY, JSON.stringify({ token }));
  return token;
}

/** Takes the game back: the token stops working, and the next prompt carries a new one. */
export function revokeAgentToken(): void {
  window.sessionStorage.removeItem(AGENT_TOKEN_KEY);
}
