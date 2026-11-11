import type { InspectOptions, InspectResult } from "../../src/agent/inspect";
import type { ActionResult, AgentView, LogPage, SessionState } from "../../src/agent/types";
import { connectCdp, debugPort, debugUrl, evaluate, fetchJson } from "./cdp.mjs";

export type WaitResult = { status: "decision" | "game-over" | "spectating" | "timeout"; view: AgentView; knowledgeLag: number };
export type AnswerResult = { ok: true; decisionId: string } | { ok: false; error: string };

/** The page-side API on `window.__dominionNavigator` that a harness may call, with results as they arrive over CDP (promises awaited). */
type NavigatorApi = {
  getAgentView(): AgentView;
  waitForDecision(options: { timeoutMs: number }): WaitResult;
  answer(decisionId: string, indices: number[]): AnswerResult;
  debugState(): unknown;
  getSession(): SessionState;
  getLog(options: { afterIndex?: number; limit?: number }): LogPage;
  inspect(path: string, options: InspectOptions): InspectResult;
  startBotGame(options: { bots: number; kingdom?: string[] }): ActionResult;
  resign(): ActionResult;
};

/** Slack on top of a page-side wait before the CDP call itself is given up on. */
const CALL_SLACK_MS = 30_000;

/**
 * Calls the Dominion Navigator probe in the dominion.games tab over CDP. Each
 * call makes its own connection, so it survives tab and extension reloads.
 */
export class DominionClient {
  constructor(private readonly port: number = debugPort()) {}

  async call<Method extends keyof NavigatorApi>(
    method: Method,
    params: Parameters<NavigatorApi[Method]>,
    options: { timeoutMs?: number } = {}
  ): Promise<ReturnType<NavigatorApi[Method]>> {
    let targets: Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
    try {
      targets = (await fetchJson(debugUrl(this.port, "/json/list"))) as typeof targets;
    } catch {
      throw new Error(`No Chrome is listening on debug port ${this.port}. Start one with npm run launch:chrome.`);
    }
    const page = targets.find((target) => target.type === "page" && target.url.startsWith("https://dominion.games/"));
    if (!page) throw new Error(`No dominion.games tab on debug port ${this.port}. Open https://dominion.games/ in that Chrome.`);

    const client = await connectCdp(page.webSocketDebuggerUrl, { timeoutMs: (options.timeoutMs ?? 0) + CALL_SLACK_MS });
    try {
      const args = params.map((param) => JSON.stringify(param)).join(", ");
      const expression = `(() => {
        const navigator = window.__dominionNavigator;
        if (!navigator) throw new Error("The Dominion Navigator extension is not loaded in this tab.");
        if (typeof navigator.${method} !== "function") throw new Error("The loaded extension has no ${method}(); rebuild and reload it.");
        return navigator.${method}(${args});
      })()`;
      return (await evaluate(client, expression)) as ReturnType<NavigatorApi[Method]>;
    } catch (error) {
      // A page exception arrives as "Error: message" followed by the page's stack.
      const [summary = ""] = (error instanceof Error ? error.message : String(error)).split("\n");
      throw new Error(summary.replace(/^(\w*Error: )+/, ""));
    } finally {
      client.close();
    }
  }
}
