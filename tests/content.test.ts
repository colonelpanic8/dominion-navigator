import assert from "node:assert/strict";
import test from "node:test";
import { countInvariantViolations } from "../src/content/invariants";
import { buildDrawKnowledgeWindowPayload } from "../src/content/knowledge-window";
import { DeckKnowledgeTracker, KnowledgeSummary } from "../src/knowledge";
import { NavigatorSnapshot, ZoneDetail } from "../src/messages";

const hero = { index: 0, name: "Hero", isHero: true };
const opponent = { index: 1, name: "Opponent", isHero: false };

function zone(index: number, zoneName: string, cardNames: string[], unknownCount = 0, owner = hero): ZoneDetail {
  return {
    index,
    zoneName,
    runtimeType: "Zone",
    owner,
    cardCount: cardNames.length + unknownCount,
    stackCount: 1,
    topCards: [],
    stacks: [
      {
        cardCount: cardNames.length + unknownCount,
        anonymousCards: unknownCount,
        cards: cardNames.map((name, id) => ({ id, name }))
      }
    ]
  };
}

function snapshot(playerZones: ZoneDetail[]): NavigatorSnapshot {
  return {
    kind: "snapshot",
    gameInstanceId: "game-1",
    gameRunning: true,
    capturedAt: new Date(0).toISOString(),
    players: [hero, opponent],
    hero,
    heroZones: playerZones.filter((item) => item.owner?.isHero),
    playerZones
  };
}

function trackedSummary(snap: NavigatorSnapshot): KnowledgeSummary {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(snap);
  return tracker.summary();
}

test("count invariants flag per-zone drift and draw + hand total drift separately", () => {
  const summary = trackedSummary(snapshot([zone(1, "HandZone", [], 5), zone(2, "DrawZone", [], 5)]));

  const misplaced = countInvariantViolations(summary, [zone(1, "HandZone", [], 6), zone(2, "DrawZone", [], 4)]);
  assert.deepEqual(
    misplaced.map((violation) => violation.kind),
    ["zone-count", "zone-count"]
  );

  const lost = countInvariantViolations(summary, [zone(1, "HandZone", [], 5), zone(2, "DrawZone", [], 3)]);
  assert.deepEqual(
    lost.map((violation) => [violation.kind, violation.trackedCount, violation.observedCount]),
    [
      ["zone-count", 5, 3],
      ["zone-group-count", 10, 8]
    ]
  );
});

test("draw knowledge window reports the clicked owner's draw, discard, and other piles", () => {
  const snap = snapshot([
    zone(1, "HandZone", [], 5),
    zone(2, "DrawZone", [], 5),
    zone(10, "HandZone", ["Silver"], 0, opponent),
    zone(11, "DrawZone", [], 3, opponent),
    zone(12, "DiscardZone", ["Copper", "Copper", "Estate"], 0, opponent)
  ]);
  const opponentDiscard = snap.playerZones.find((item) => item.index === 12)!;

  const payload = buildDrawKnowledgeWindowPayload(opponentDiscard, trackedSummary(snap), snap);

  assert.equal(payload.sourceZoneIndex, 12);
  assert.equal(payload.playerName, "Opponent");
  assert.deepEqual({ cards: payload.cards, unknownCount: payload.unknownCount }, { cards: [], unknownCount: 3 });
  assert.deepEqual(payload.discardPile, {
    cards: [
      { name: "Copper", count: 2 },
      { name: "Estate", count: 1 }
    ],
    unknownCount: 0
  });
  assert.deepEqual(payload.excludedFromActiveDeck, { cards: [{ name: "Silver", count: 1 }], unknownCount: 0 });
  assert.deepEqual(payload.entireDeck, {
    cards: [
      { name: "Copper", count: 2 },
      { name: "Estate", count: 1 },
      { name: "Silver", count: 1 }
    ],
    unknownCount: 3
  });
});
