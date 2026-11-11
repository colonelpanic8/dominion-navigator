import { Policy } from "../policy";
import { BigMoneyPolicy } from "./big-money";

export type PolicyOptions = {
  terminal?: string;
};

/** Policies selectable by name from scripts/agent-play.ts. Add model-backed policies here. */
export const POLICIES: Record<string, (options: PolicyOptions) => Policy> = {
  "big-money": (options) => new BigMoneyPolicy(options.terminal ? { terminal: options.terminal } : {})
};

export function createPolicy(name: string, options: PolicyOptions = {}): Policy {
  const factory = POLICIES[name];
  if (!factory) throw new Error(`Unknown policy "${name}". Available: ${Object.keys(POLICIES).join(", ")}`);
  return factory(options);
}
