import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAgentView } from "../src/agent/agent-view";
import { buildDecision } from "../src/agent/decisions";
import { AgentView, RawQuestion, TableState } from "../src/agent/types";
import type { KnowledgeSummary } from "../src/knowledge";

/** Decisions recorded from live bot games through window.__dominionNavigator.debugState(). */
export type LiveFixture = {
  source: string;
  decisionId: string;
  sinceLastDecision: string[];
  table: TableState;
  knowledge: KnowledgeSummary;
  rawQuestions: RawQuestion[];
  liveView: AgentView;
};

export const fixtures: LiveFixture[] = JSON.parse(readFileSync(new URL("./fixtures/live-decisions.json", import.meta.url), "utf8"));

export function fixture(questionId: string, groupKinds?: string[]): LiveFixture {
  const found = fixtures.find(
    (item) =>
      item.rawQuestions[0]?.questionId === questionId &&
      (!groupKinds || buildDecision(item.rawQuestions[0]!, item.decisionId).groups.map((group) => group.kind).join(",") === groupKinds.join(","))
  );
  assert.ok(found, `missing fixture for ${questionId}`);
  return found;
}

export function view(item: LiveFixture, overrides: Partial<TableState> = {}): AgentView {
  return buildAgentView({
    table: { ...item.table, ...overrides },
    knowledge: item.knowledge,
    decision: buildDecision(item.rawQuestions[0]!, item.decisionId),
    sinceLastDecision: item.sinceLastDecision
  });
}

export function optionIndex(item: AgentView, kind: string, label: string): number {
  const option = item.decision?.options.find((candidate) => candidate.label === label && item.decision?.groups[candidate.group]?.kind === kind);
  assert.ok(option, `no ${kind} option ${label}`);
  return option.index;
}
