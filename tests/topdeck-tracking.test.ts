import assert from "node:assert/strict";
import test from "node:test";
import { AnonymousTopdeckQueue, shouldResolveTopdeckFromLog } from "../src/topdeck-tracking";
import { CardMoveSummary, ZoneSummary } from "../src/messages";

const player = { index: 0, name: "Player", isHero: true };

function summaryZone(index: number, zoneName: string, topCards: string[] = [], owner: ZoneSummary["owner"] = player): ZoneSummary {
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

test("topdeck queue consumes only the matching player's recent anonymous topdecks", () => {
  const opponent = { index: 1, name: "Opponent", isHero: false };
  const anonymous = (count: number, owner = player) =>
    topdeckMove(summaryZone(1, "HandZone", ["Back"], owner), Array(count).fill("Anonymous"), Array(count).fill("Anonymous"));
  const queue = new AnonymousTopdeckQueue();
  queue.record(anonymous(1), 1000);
  queue.record(anonymous(2, opponent), 1100);
  queue.record(anonymous(1), 1200);

  assert.equal(queue.consume(player, 3, 1300), false, "never partially consumes");
  assert.equal(queue.consume(player, 2, 1300), true);
  assert.equal(queue.consume(player, 1, 1300), false);
  assert.equal(queue.consume(opponent, 2, 7000), false, "expires after the log window");
});
