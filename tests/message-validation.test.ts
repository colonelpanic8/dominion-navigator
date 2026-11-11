import assert from "node:assert/strict";
import test from "node:test";
import { DeckKnowledgeTracker } from "../src/knowledge";
import { parseNavigatorMessage } from "../src/message-validation";
import { MESSAGE_SOURCE } from "../src/messages";

const hero = { index: 0, name: "Hero", isHero: true };

function knowledgeSummary() {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot({
    kind: "snapshot",
    gameInstanceId: "game-1",
    gameRunning: true,
    capturedAt: new Date(0).toISOString(),
    players: [hero],
    hero,
    heroZones: [],
    playerZones: [
      {
        index: 1,
        zoneName: "HandZone",
        runtimeType: "Zone",
        owner: hero,
        cardCount: 2,
        stackCount: 1,
        topCards: ["Copper"],
        stacks: [{ cardCount: 2, anonymousCards: 0, cards: [{ id: 1, name: "Copper" }, { id: 2, name: "Estate" }] }]
      }
    ]
  });
  return tracker.summary();
}

test("knowledge updates are accepted only with a well-formed summary", () => {
  const valid = { source: MESSAGE_SOURCE, type: "knowledge-update", payload: { seq: 3, summary: knowledgeSummary() } };
  assert.equal(parseNavigatorMessage(valid), valid);

  const forged = structuredClone(valid);
  forged.payload.summary.players[0]!.totalKnownOwned = { Province: -4 };
  assert.equal(parseNavigatorMessage(forged), undefined);

  assert.equal(parseNavigatorMessage({ ...valid, payload: { seq: -1, summary: valid.payload.summary } }), undefined);
  assert.equal(parseNavigatorMessage({ ...valid, payload: { seq: 1, summary: { players: "all of them" } } }), undefined);
});

test("messages from other sources, unknown types, or without sequence numbers are rejected", () => {
  assert.equal(parseNavigatorMessage({ source: "someone-else", type: "request-snapshot" }), undefined);
  assert.equal(parseNavigatorMessage({ source: MESSAGE_SOURCE, type: "answer-everything" }), undefined);
  assert.equal(parseNavigatorMessage("dominion-navigator"), undefined);
  assert.equal(
    parseNavigatorMessage({
      source: MESSAGE_SOURCE,
      type: "card-move",
      payload: { kind: "card-move", phase: "after", cardIds: [], cards: [], cardIdsAfterMoving: [], cardsAfterMoving: [] }
    }),
    undefined
  );
  assert.ok(parseNavigatorMessage({ source: MESSAGE_SOURCE, type: "request-snapshot" }));
});
