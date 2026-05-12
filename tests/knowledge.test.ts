import assert from "node:assert/strict";
import test from "node:test";
import { DeckKnowledgeTracker } from "../src/knowledge";
import { CardMoveSummary, NavigatorSnapshot, ZoneDetail, ZoneSummary } from "../src/messages";

const player = { index: 0, name: "Player", isHero: true };
const opponent = { index: 1, name: "Opponent", isHero: false };
const thirdPlayer = { index: 2, name: "Third", isHero: false };

function startingDeck(setupCards?: string[]): string[] {
  const deck = Array.from({ length: 7 }, () => "Copper");
  if (setupCards?.some((card) => card !== "Copper" && card !== "Estate")) {
    deck.push(...setupCards.filter((card) => card !== "Copper"));
  } else {
    deck.push("Estate", "Estate", "Estate");
  }
  return deck;
}

function zone(index: number, zoneName: string, cardNames: string[], unknownCount = 0, owner = player): ZoneDetail {
  return {
    index,
    zoneName,
    runtimeType: "Zone",
    owner,
    cardCount: cardNames.length + unknownCount,
    stackCount: cardNames.length + (unknownCount > 0 ? 1 : 0),
    topCards: cardNames.length > 0 ? [cardNames[cardNames.length - 1]!] : unknownCount > 0 ? ["Back"] : [],
    stacks: [
      ...cardNames.map((name, id) => ({
        cardCount: 1,
        anonymousCards: 0,
        topCard: name,
        cards: [{ id, name }]
      })),
      ...(unknownCount > 0
        ? [
            {
              cardCount: unknownCount,
              anonymousCards: unknownCount,
              topCard: "Back",
              cards: []
            }
          ]
        : [])
    ]
  };
}

function summaryZone(index: number, zoneName: string, topCards: string[] = []): ZoneSummary {
  return {
    index,
    zoneName,
    runtimeType: "Zone",
    owner: player,
    cardCount: 0,
    stackCount: 0,
    topCards
  };
}

function opponentSummaryZone(index: number, zoneName: string, topCards: string[] = []): ZoneSummary {
  return {
    index,
    zoneName,
    runtimeType: "Zone",
    owner: opponent,
    cardCount: 0,
    stackCount: 0,
    topCards
  };
}

function thirdPlayerSummaryZone(index: number, zoneName: string, topCards: string[] = []): ZoneSummary {
  return {
    index,
    zoneName,
    runtimeType: "Zone",
    owner: thirdPlayer,
    cardCount: 0,
    stackCount: 0,
    topCards
  };
}

function snapshot(playerZones: ZoneDetail[], gameInstanceId = "game-1", setupCards?: string[]): NavigatorSnapshot {
  return {
    kind: "snapshot",
    gameInstanceId,
    gameRunning: true,
    capturedAt: new Date(0).toISOString(),
    ...(setupCards ? { setupCards } : {}),
    startingDeck: startingDeck(setupCards),
    players: [player, opponent, thirdPlayer],
    hero: player,
    heroZones: playerZones,
    playerZones
  };
}

function move(from: ZoneSummary, to: ZoneSummary, count: number): CardMoveSummary {
  return moveWithNames(from, to, Array.from({ length: count }, () => "Anonymous"));
}

function moveWithNames(from: ZoneSummary, to: ZoneSummary, names: string[]): CardMoveSummary {
  return {
    kind: "card-move",
    capturedAt: new Date(1).toISOString(),
    phase: "after",
    from,
    to,
    cardIds: names.map((name, index) => (name === "Anonymous" ? -1 : index)),
    cards: names,
    cardIdsAfterMoving: names.map((name, index) => (name === "Anonymous" ? -1 : index)),
    cardsAfterMoving: names
  };
}

test("anonymous discard to draw move preserves ownership but degrades location identity", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot([
      zone(0, "HandZone", ["Copper", "Estate"]),
      zone(1, "DiscardZone", []),
      zone(2, "DrawZone", [], 0)
    ])
  );

  tracker.applyMove(
    moveWithNames(summaryZone(0, "HandZone", ["Estate"]), summaryZone(1, "DiscardZone", ["Estate"]), ["Copper", "Estate"])
  );
  tracker.applyMove(move(summaryZone(1, "DiscardZone", ["Estate"]), summaryZone(2, "DrawZone", ["Back"]), 2));

  const [knowledge] = tracker.summary().players;
  assert.equal(knowledge?.totalKnownOwned.Copper, 1);
  assert.equal(knowledge?.totalKnownOwned.Estate, 1);
  assert.equal(knowledge?.totalUnknownOwned, 0);
  assert.deepEqual(knowledge?.unlocatedKnownCards, {});

  const discard = knowledge?.zones.find((item) => item.zoneName === "DiscardZone");
  const draw = knowledge?.zones.find((item) => item.zoneName === "DrawZone");
  assert.equal(discard, undefined);
  assert.deepEqual(draw?.knownCards, { Copper: 1, Estate: 1 });
  assert.equal(draw?.unknownCount, 0);
});

test("draw zone identities are derived from a complete owned ledger remainder", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot([
      zone(0, "HandZone", ["Copper", "Copper", "Copper", "Estate", "Estate"]),
      zone(1, "DrawZone", ["Copper", "Copper", "Copper", "Copper", "Estate"]),
      zone(2, "DiscardZone", [], 0)
    ])
  );
  tracker.applySnapshot(
    snapshot([
      zone(0, "HandZone", ["Copper", "Copper", "Copper", "Estate", "Estate"]),
      zone(1, "DrawZone", [], 5),
      zone(2, "DiscardZone", [], 0)
    ])
  );

  const [knowledge] = tracker.summary().players;
  const draw = knowledge?.zones.find((item) => item.zoneName === "DrawZone");

  assert.deepEqual(knowledge?.totalKnownOwned, { Copper: 7, Estate: 3 });
  assert.equal(knowledge?.totalUnknownOwned, 0);
  assert.deepEqual(draw?.knownCards, { Copper: 4, Estate: 1 });
  assert.equal(draw?.unknownCount, 0);
  assert.deepEqual(knowledge?.unlocatedKnownCards, {});
});

test("initial standard starting deck seeds a fully known owned ledger", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot([
      zone(0, "HandZone", ["Copper", "Copper", "Copper", "Estate", "Estate"]),
      zone(1, "DrawZone", [], 5),
      zone(10, "HandZone", [], 5, opponent),
      zone(11, "DrawZone", [], 5, opponent)
    ])
  );

  const summary = tracker.summary();
  const heroKnowledge = summary.players.find((item) => item.player.index === player.index);
  const opponentKnowledge = summary.players.find((item) => item.player.index === opponent.index);
  const heroDraw = heroKnowledge?.zones.find((item) => item.zoneName === "DrawZone");

  assert.deepEqual(heroKnowledge?.totalKnownOwned, { Copper: 7, Estate: 3 });
  assert.equal(heroKnowledge?.totalUnknownOwned, 0);
  assert.deepEqual(heroDraw?.knownCards, { Copper: 4, Estate: 1 });
  assert.equal(heroDraw?.unknownCount, 0);
  assert.deepEqual(opponentKnowledge?.totalKnownOwned, { Copper: 7, Estate: 3 });
  assert.equal(opponentKnowledge?.totalUnknownOwned, 0);
  assert.equal(opponentKnowledge?.unknownLocatedCount, 10);
});

test("initial shelter starting deck seeds shelters instead of Estates", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot(
      [
        zone(0, "HandZone", ["Copper", "Copper", "Hovel", "Necropolis", "Overgrown Estate"]),
        zone(1, "DrawZone", [], 5)
      ],
      "game-1",
      ["Copper", "Hovel", "Necropolis", "Overgrown Estate"]
    )
  );

  const [knowledge] = tracker.summary().players;
  const draw = knowledge?.zones.find((item) => item.zoneName === "DrawZone");

  assert.deepEqual(knowledge?.totalKnownOwned, { Copper: 7, Hovel: 1, Necropolis: 1, "Overgrown Estate": 1 });
  assert.equal(knowledge?.totalUnknownOwned, 0);
  assert.deepEqual(draw?.knownCards, { Copper: 5 });
});

test("draw zone identities are not derived when the owned ledger is incomplete", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot([
      zone(0, "HandZone", ["Copper", "Copper"]),
      zone(1, "DrawZone", [], 3)
    ])
  );

  const [knowledge] = tracker.summary().players;
  const draw = knowledge?.zones.find((item) => item.zoneName === "DrawZone");

  assert.equal(knowledge?.totalUnknownOwned, 3);
  assert.deepEqual(draw?.knownCards, {});
  assert.equal(draw?.unknownCount, 3);
});

test("opponent gains to discard do not enter hero discard", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot([
      zone(1, "HandZone", ["Copper"]),
      zone(2, "DiscardZone", []),
      zone(11, "HandZone", [], 5, opponent),
      zone(12, "DiscardZone", [], 0, opponent)
    ])
  );

  tracker.applyMove(
    moveWithNames(
      {
        index: 100,
        zoneName: "SetAsideZone",
        runtimeType: "Zone",
        owner: { index: -1, isHero: false },
        cardCount: 0,
        stackCount: 0,
        topCards: ["Silver"]
      },
      opponentSummaryZone(12, "DiscardZone", ["Silver"]),
      ["Silver"]
    )
  );

  const heroKnowledge = tracker.summary().players.find((item) => item.player.index === player.index);
  const opponentKnowledge = tracker.summary().players.find((item) => item.player.index === opponent.index);
  const heroDiscard = heroKnowledge?.zones.find((item) => item.zoneName === "DiscardZone");
  const opponentDiscard = opponentKnowledge?.zones.find((item) => item.zoneName === "DiscardZone");

  assert.equal(heroDiscard, undefined);
  assert.equal(opponentDiscard?.knownCards.Silver, 1);
  assert.equal(opponentDiscard?.totalCount, 1);
});

test("three player gains remain separated by player index", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot([
      zone(1, "DiscardZone", []),
      zone(11, "DiscardZone", [], 0, opponent),
      zone(21, "DiscardZone", [], 0, thirdPlayer)
    ])
  );

  tracker.applyMove(
    moveWithNames(
      {
        index: 100,
        zoneName: "SetAsideZone",
        runtimeType: "Zone",
        owner: { index: -1, isHero: false },
        cardCount: 0,
        stackCount: 0,
        topCards: ["Silver"]
      },
      opponentSummaryZone(11, "DiscardZone", ["Silver"]),
      ["Silver"]
    )
  );
  tracker.applyMove(
    moveWithNames(
      {
        index: 101,
        zoneName: "SetAsideZone",
        runtimeType: "Zone",
        owner: { index: -1, isHero: false },
        cardCount: 0,
        stackCount: 0,
        topCards: ["Gold"]
      },
      thirdPlayerSummaryZone(21, "DiscardZone", ["Gold"]),
      ["Gold"]
    )
  );

  const summary = tracker.summary();
  assert.equal(summary.players.find((item) => item.player.index === player.index)?.zones.find((item) => item.zoneName === "DiscardZone"), undefined);
  assert.equal(summary.players.find((item) => item.player.index === opponent.index)?.zones.find((item) => item.zoneName === "DiscardZone")?.knownCards.Silver, 1);
  assert.equal(summary.players.find((item) => item.player.index === thirdPlayer.index)?.zones.find((item) => item.zoneName === "DiscardZone")?.knownCards.Gold, 1);
});

test("new game instance resets ownership and zone knowledge even with the same player", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(snapshot([zone(1, "InPlayZone", ["Gold"]), zone(2, "HandZone", ["Copper"])], "game-1"));

  let [knowledge] = tracker.summary().players;
  assert.equal(knowledge?.totalKnownOwned.Gold, 1);
  assert.equal(knowledge?.totalKnownOwned.Copper, 1);

  tracker.applySnapshot(snapshot([zone(10, "HandZone", ["Estate"])], "game-2"));

  [knowledge] = tracker.summary().players;
  assert.deepEqual(knowledge?.totalKnownOwned, { Estate: 1 });
  assert.equal(knowledge?.zones.some((item) => item.zoneKey === "1:DiscardZone"), false);
});

test("serialized knowledge can be restored across a probe game id change", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(snapshot([zone(1, "HandZone", ["Copper"]), zone(2, "DiscardZone", [])], "game-1"));
  tracker.applyMove(moveWithNames(summaryZone(1, "HandZone", ["Copper"]), summaryZone(2, "DiscardZone", ["Copper"]), ["Copper"]));

  const restored = new DeckKnowledgeTracker();
  restored.restoreForSnapshot(tracker.serialize(), snapshot([zone(1, "HandZone", []), zone(2, "DiscardZone", ["Copper"])], "game-2"));

  const [knowledge] = restored.summary().players;
  const discard = knowledge?.zones.find((item) => item.zoneName === "DiscardZone");
  const hand = knowledge?.zones.find((item) => item.zoneName === "HandZone");

  assert.deepEqual(knowledge?.totalKnownOwned, { Copper: 1 });
  assert.deepEqual(discard?.knownCards, { Copper: 1 });
  assert.equal(hand, undefined);
});

test("partial discard snapshots do not erase deck moved to discard by Messenger", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot([
      zone(1, "DrawZone", ["Estate"], 8),
      zone(2, "DiscardZone", [], 0)
    ])
  );

  tracker.applyMove(
    moveWithNames(summaryZone(1, "DrawZone", ["Back"]), summaryZone(2, "DiscardZone", []), [
      "Anonymous",
      "Anonymous",
      "Anonymous",
      "Anonymous",
      "Anonymous",
      "Anonymous",
      "Anonymous",
      "Anonymous",
      "Estate"
    ])
  );
  tracker.applySnapshot(
    snapshot([
      zone(1, "DrawZone", [], 0),
      zone(2, "DiscardZone", ["Estate"], 0)
    ])
  );

  const [knowledge] = tracker.summary().players;
  const draw = knowledge?.zones.find((item) => item.zoneName === "DrawZone");
  const discard = knowledge?.zones.find((item) => item.zoneName === "DiscardZone");

  assert.equal(draw, undefined);
  assert.equal(discard?.knownCards.Estate, 1);
  assert.equal(discard?.unknownCount, 8);
  assert.equal(discard?.totalCount, 9);
});

test("discarding visible hand cards keeps identities even when discard only reveals the top card", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot([
      zone(1, "HandZone", ["Estate", "Estate", "Estate"]),
      zone(2, "DiscardZone", [], 0)
    ])
  );

  tracker.applyMove({
    kind: "card-move",
    capturedAt: new Date(1).toISOString(),
    phase: "after",
    from: summaryZone(1, "HandZone", ["Estate"]),
    to: summaryZone(2, "DiscardZone", ["Estate"]),
    cardIds: [10, 11, 12],
    cards: ["Estate", "Estate", "Estate"],
    cardIdsAfterMoving: [-1, -1, 12],
    cardsAfterMoving: ["Anonymous", "Anonymous", "Estate"]
  });
  tracker.applySnapshot(
    snapshot([
      zone(1, "HandZone", [], 0),
      zone(2, "DiscardZone", ["Estate"], 0)
    ])
  );

  const [knowledge] = tracker.summary().players;
  const discard = knowledge?.zones.find((item) => item.zoneName === "DiscardZone");

  assert.equal(discard?.knownCards.Estate, 3);
  assert.equal(discard?.unknownCount, 0);
  assert.equal(discard?.totalCount, 3);
});

test("discard snapshots are ignored even when they are empty", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot([
      zone(1, "HandZone", ["Copper"]),
      zone(2, "DiscardZone", [], 0)
    ])
  );

  tracker.applyMove(moveWithNames(summaryZone(1, "HandZone", ["Copper"]), summaryZone(2, "DiscardZone", ["Copper"]), ["Copper"]));
  tracker.applySnapshot(
    snapshot([
      zone(1, "HandZone", [], 0),
      zone(2, "DiscardZone", [], 0)
    ])
  );

  const [knowledge] = tracker.summary().players;
  const discard = knowledge?.zones.find((item) => item.zoneName === "DiscardZone");

  assert.equal(discard?.knownCards.Copper, 1);
  assert.equal(discard?.totalCount, 1);
});
