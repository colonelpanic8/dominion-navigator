import { AgentView, CardGlossary, Decision } from "./types";

export type DecidableView = AgentView & { decision: Decision };

export type PolicyContext = {
  glossary: CardGlossary;
};

export type PolicyChoice = {
  /** Option indices from `view.decision.options`. */
  indices: number[];
  reason?: string;
};

/**
 * Chooses an answer for the open decision. A model-backed policy can render the
 * view with `renderAgentViewText` (or send the JSON) and parse indices back.
 */
export interface Policy {
  readonly name: string;
  decide(view: DecidableView, context: PolicyContext): PolicyChoice | Promise<PolicyChoice>;
}
