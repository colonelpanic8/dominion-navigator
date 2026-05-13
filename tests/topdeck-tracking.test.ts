import assert from "node:assert/strict";
import test from "node:test";
import { shouldResolveTopdeckFromLog } from "../src/topdeck-tracking";
import { CardMoveSummary, ZoneSummary } from "../src/messages";

const player = { index: 0, name: "Player", isHero: true };

function summaryZone(index: number, zoneName: string, topCards: string[] = [], owner = player): ZoneSummary {
  return {
    index,
    zoneName,
    runtimeType: "Zone",
    owner,
    cardCount: 0,
    stackCount: 0,
    topCards
  };
}

function topdeckMove(from: ZoneSummary, cards: string[], cardsAfterMoving: string[]): CardMoveSummary {
  return {
    kind: "card-move",
    capturedAt: new Date(1).toISOString(),
    phase: "after",
    from,
    to: summaryZone(2, "DrawZone", ["Back"], from.owner),
    cardIds: cards.map((card, index) => (card === "Anonymous" ? -1 : index)),
    cards,
    cardIdsAfterMoving: cardsAfterMoving.map((card, index) => (card === "Anonymous" ? -1 : index)),
    cardsAfterMoving
  };
}

test("Courtyard-style known hand topdecks are not repaired again from log text", () => {
  const move = topdeckMove(summaryZone(1, "HandZone", ["Estate"]), ["Estate"], ["Anonymous"]);

  assert.equal(shouldResolveTopdeckFromLog(move), false);
});

test("fully anonymous player topdecks can be repaired from log text", () => {
  const move = topdeckMove(summaryZone(1, "HandZone", ["Back"]), ["Anonymous"], ["Anonymous"]);

  assert.equal(shouldResolveTopdeckFromLog(move), true);
});

test("known gained cards topdecked anonymously do not need log repair", () => {
  const move = topdeckMove(summaryZone(100, "SetAsideZone", ["Silver"], { index: -1, isHero: false }), ["Silver"], ["Anonymous"]);

  assert.equal(shouldResolveTopdeckFromLog(move), false);
});
