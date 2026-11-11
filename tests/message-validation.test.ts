import assert from "node:assert/strict";
import test from "node:test";
import { parseNavigatorMessage } from "../src/message-validation";
import { MESSAGE_SOURCE } from "../src/messages";

test("messages from other sources, unknown types, or with malformed payloads are rejected", () => {
  assert.equal(parseNavigatorMessage({ source: "someone-else", type: "request-snapshot" }), undefined);
  assert.equal(parseNavigatorMessage({ source: MESSAGE_SOURCE, type: "answer-everything" }), undefined);
  assert.equal(parseNavigatorMessage("dominion-navigator"), undefined);
  assert.equal(
    parseNavigatorMessage({ source: MESSAGE_SOURCE, type: "card-move", payload: { kind: "card-move", phase: "after", cardIds: ["1"], cards: [] } }),
    undefined
  );
  assert.equal(
    parseNavigatorMessage({
      source: MESSAGE_SOURCE,
      type: "show-draw-knowledge-window",
      payload: { sourceZoneIndex: 1, playerName: "Hero", cards: [{ name: "Copper", count: "lots" }], unknownCount: 0 }
    }),
    undefined
  );
  assert.ok(parseNavigatorMessage({ source: MESSAGE_SOURCE, type: "request-snapshot" }));
});
