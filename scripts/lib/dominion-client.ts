import type { JoinResult } from "../../src/agent/agent-token";
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
  agentJoin(token: string): JoinResult;
  getLog(options: { afterIndex?: number; limit?: number }): LogPage;
  inspect(path: string, options: InspectOptions): InspectResult;
  startBotGame(options: { bots: number; kingdom?: string[] }): ActionResult;
  resign(): ActionResult;
};

/** Slack on top of a page-side wait before the CDP call itself is given up on. */
const CALL_SLACK_MS = 30_000;

type Page = { id: string; type: string; url: string; webSocketDebuggerUrl: string };

/**
 * Calls the Dominion Navigator probe in a dominion.games tab over CDP. Each
 * call makes its own connection, so it survives tab and extension reloads.
 * It uses the first dominion.games tab until `join` ties it to one.
 */
export class DominionClient {
  private joinedTab: string | undefined;

  constructor(private readonly port: number = debugPort()) {}

  private async pages(): Promise<Page[]> {
    let targets: Page[];
    try {
      targets = (await fetchJson(debugUrl(this.port, "/json/list"))) as Page[];
    } catch {
      throw new Error(`No Chrome is listening on debug port ${this.port}. Start one with npm run launch:chrome.`);
    }
    return targets.filter((target) => target.type === "page" && target.url.startsWith("https://dominion.games/"));
  }

  private async callOn<Method extends keyof NavigatorApi>(
    page: Page,
    method: Method,
    params: Parameters<NavigatorApi[Method]>,
    options: { timeoutMs?: number } = {}
  ): Promise<ReturnType<NavigatorApi[Method]>> {
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

  async call<Method extends keyof NavigatorApi>(
    method: Method,
    params: Parameters<NavigatorApi[Method]>,
    options: { timeoutMs?: number } = {}
  ): Promise<ReturnType<NavigatorApi[Method]>> {
    const pages = await this.pages();
    const page = this.joinedTab ? pages.find((candidate) => candidate.id === this.joinedTab) : pages[0];
    if (!page) {
      throw new Error(
        this.joinedTab ? "The tab this session joined is closed." : `No dominion.games tab on debug port ${this.port}. Open https://dominion.games/ in that Chrome.`
      );
    }
    return this.callOn(page, method, params, options);
  }

  /** Ties this client to the tab whose overlay handed out `token`. */
  async join(token: string): Promise<JoinResult> {
    const pages = await this.pages();
    let refusal: JoinResult = { ok: false, error: `No dominion.games tab on debug port ${this.port}.` };
    for (const page of pages) {
      const result = await this.callOn(page, "agentJoin", [token]).catch((error: unknown): JoinResult => ({ ok: false, error: String(error) }));
      if (result.ok) {
        this.joinedTab = page.id;
        return result;
      }
      // With one tab its reason is the answer; with several, no tab knowing the token says more.
      refusal = pages.length === 1 ? result : { ok: false, error: "No dominion.games tab has this agent token: the player took the game back, or a new game started." };
    }
    return refusal;
  }
}
