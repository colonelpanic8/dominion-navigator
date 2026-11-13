import assert from "node:assert/strict";
import test from "node:test";
import { claimAgentToken, newAgentToken, parseAgentTokenRecord } from "../src/agent/agent-token";
import { buildAskPrompt, buildPlayPrompt, KINGDOM_QUESTION, MAX_QUESTION_CHARS, MIDGAME_KINGDOM_QUESTION } from "../src/agent/advisor";

const token = "dn-00ff";

test("a blank question asks for a kingdom evaluation that fits the stage of the game", () => {
  const opening = buildAskPrompt("  ", { token, player: "colonelpanic8", turn: 1 });
  assert.match(opening, /advising the player colonelpanic8/);
  assert.ok(opening.includes(KINGDOM_QUESTION));
  assert.ok(opening.includes('call `join` with {"token":"dn-00ff"}'));
  assert.match(opening, /Do not make moves/);

  assert.ok(buildAskPrompt("", { token, turn: 7 }).includes(MIDGAME_KINGDOM_QUESTION));

  const asked = buildAskPrompt(`Should I buy Gold?${"x".repeat(MAX_QUESTION_CHARS)}`, { token });
  assert.match(asked, /Should I buy Gold\?/);
  assert.doesNotMatch(asked, /Evaluate this kingdom/);
  assert.ok(asked.length < MAX_QUESTION_CHARS + 1000);
});

test("a take-over tells the agent to join with the token and to stop when the game is taken back", () => {
  const prompt = buildPlayPrompt({ token, player: "colonelpanic8" });
  assert.match(prompt, /for the player colonelpanic8/);
  assert.ok(prompt.includes('call `join` with {"token":"dn-00ff"}'));
  assert.match(prompt, /evaluate the kingdom from where this game stands/);
  assert.match(prompt, /took the game back, stop/);
});

test("an agent token is good for the tab that issued it and the game it first joined", () => {
  assert.equal(newAgentToken(new Uint8Array([0, 255, 16])), "dn-00ff10");
  assert.equal(parseAgentTokenRecord(null), undefined);
  assert.equal(parseAgentTokenRecord('{"token":""}'), undefined);
  const issued = parseAgentTokenRecord('{"token":"dn-00ff"}');
  assert.deepEqual(issued, { token });

  assert.equal(claimAgentToken(undefined, token, "42").ok, false);
  assert.equal(claimAgentToken(issued, "dn-other", "42").ok, false);
  const joined = claimAgentToken(issued, token, "42");
  assert.deepEqual(joined, { ok: true, record: { token, gameNumber: "42" } });
  assert.equal(joined.ok && claimAgentToken(joined.record, token, "42").ok, true);
  const nextGame = joined.ok && claimAgentToken(joined.record, token, "43");
  assert.deepEqual(nextGame, { ok: false, error: "This agent token was for game #42, which is over." });
});
