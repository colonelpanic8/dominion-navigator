import assert from "node:assert/strict";
import test from "node:test";
import { DeckKnowledgeTracker } from "../src/knowledge";
import { CardMoveSummary, NavigatorSnapshot, ZoneDetail, ZoneSummary } from "../src/messages";

const player = { index: 0, name: "Player", isHero: true };
const opponent = { index: 1, name: "Opponent", isHero: false };
const thirdPlayer = { index: 2, name: "Third", isHero: false };

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

function neutralSummaryZone(index: number, zoneName: string, topCards: string[] = []): ZoneSummary {
  return {
    index,
    zoneName,
    runtimeType: "Zone",
    owner: { index: -1, isHero: false },
    cardCount: 0,
    stackCount: 0,
    topCards
  };
}

function snapshot(playerZones: ZoneDetail[], gameInstanceId = "game-1", startingDeck?: string[]): NavigatorSnapshot {
  return {
    kind: "snapshot",
    gameInstanceId,
    gameRunning: true,
    capturedAt: new Date(0).toISOString(),
    ...(startingDeck ? { startingDeck } : {}),
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

test("drawing named cards from an anonymous draw zone removes those anonymous cards", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot(
      [
        zone(0, "HandZone", ["Copper", "Copper", "Copper", "Estate", "Estate"]),
        zone(1, "DrawZone", [], 5)
      ],
      "game-1",
      ["Copper", "Copper", "Copper", "Copper", "Copper", "Copper", "Copper", "Estate", "Estate", "Estate"]
    )
  );

  tracker.applyMove(
    moveWithNames(summaryZone(1, "DrawZone", ["Back"]), summaryZone(0, "HandZone", ["Copper", "Estate"]), [
      "Copper",
      "Estate"
    ])
  );

  const [knowledge] = tracker.summary().players;
  const hand = knowledge?.zones.find((item) => item.zoneName === "HandZone");
  const draw = knowledge?.zones.find((item) => item.zoneName === "DrawZone");

  assert.deepEqual(hand?.knownCards, { Copper: 4, Estate: 3 });
  assert.deepEqual(draw?.knownCards, { Copper: 3 });
  assert.equal(draw?.unknownCount, 0);
  assert.equal(draw?.totalCount, 3);
});

test("initial standard starting deck seeds a fully known owned ledger", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot(
      [
        zone(0, "HandZone", ["Copper", "Copper", "Copper", "Estate", "Estate"]),
        zone(1, "DrawZone", [], 5),
        zone(10, "HandZone", [], 5, opponent),
        zone(11, "DrawZone", [], 5, opponent)
      ],
      "game-1",
      ["Copper", "Copper", "Copper", "Copper", "Copper", "Copper", "Copper", "Estate", "Estate", "Estate"]
    )
  );

  const summary = tracker.summary();
  const heroKnowledge = summary.players.find((item) => item.player.index === player.index);
  const opponentKnowledge = summary.players.find((item) => item.player.index === opponent.index);
  const heroDraw = heroKnowledge?.zones.find((item) => item.zoneName === "DrawZone");
  const opponentHand = opponentKnowledge?.zones.find((item) => item.zoneName === "HandZone");
  const opponentDraw = opponentKnowledge?.zones.find((item) => item.zoneName === "DrawZone");

  assert.deepEqual(heroKnowledge?.totalKnownOwned, { Copper: 7, Estate: 3 });
  assert.equal(heroKnowledge?.totalUnknownOwned, 0);
  assert.deepEqual(heroDraw?.knownCards, { Copper: 4, Estate: 1 });
  assert.equal(heroDraw?.unknownCount, 0);
  assert.deepEqual(opponentKnowledge?.totalKnownOwned, { Copper: 7, Estate: 3 });
  assert.equal(opponentKnowledge?.totalUnknownOwned, 0);
  assert.equal(opponentHand?.unknownCount, 0);
  assert.equal(opponentHand?.ambiguousCount, 5);
  assert.equal(opponentDraw?.unknownCount, 0);
  assert.equal(opponentDraw?.ambiguousCount, 5);
  assert.equal(opponentKnowledge?.unknownLocatedCount, 0);
  assert.deepEqual(opponentKnowledge?.unlocatedKnownCards, {});
  assert.deepEqual(opponentKnowledge?.ambiguousLocationGroups, [
    {
      zoneKeys: ["10:HandZone", "11:DrawZone"],
      zoneNames: ["HandZone", "DrawZone"],
      knownCards: { Copper: 7, Estate: 3 },
      totalCount: 10
    }
  ]);
});

test("initial custom starting deck is seeded from the page-provided deck list", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot(
      [
        zone(0, "HandZone", ["Copper", "Copper", "Hovel", "Necropolis", "Overgrown Estate"]),
        zone(1, "DrawZone", [], 5)
      ],
      "game-1",
      ["Copper", "Copper", "Copper", "Copper", "Copper", "Copper", "Copper", "Hovel", "Necropolis", "Overgrown Estate"]
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

test("returning cards to the supply removes ownership before another player gains a copy", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot([
      zone(1, "HandZone", ["Copper", "Copper", "Copper", "Copper"]),
      zone(2, "InPlayZone", ["Ambassador"]),
      zone(11, "DiscardZone", [], 0, opponent)
    ])
  );

  tracker.applyMove(
    moveWithNames(summaryZone(1, "HandZone", ["Copper"]), neutralSummaryZone(100, "SetAsideZone", ["Copper"]), [
      "Copper",
      "Copper"
    ])
  );
  tracker.applyMove(moveWithNames(neutralSummaryZone(100, "SetAsideZone", ["Copper"]), opponentSummaryZone(11, "DiscardZone", ["Copper"]), ["Copper"]));

  const heroKnowledge = tracker.summary().players.find((item) => item.player.index === player.index);
  const opponentKnowledge = tracker.summary().players.find((item) => item.player.index === opponent.index);
  const heroHand = heroKnowledge?.zones.find((item) => item.zoneName === "HandZone");
  const opponentDiscard = opponentKnowledge?.zones.find((item) => item.zoneName === "DiscardZone");

  assert.equal(heroKnowledge?.totalKnownOwned.Copper, 2);
  assert.equal(heroHand?.knownCards.Copper, 2);
  assert.equal(opponentKnowledge?.totalKnownOwned.Copper, 1);
  assert.equal(opponentDiscard?.knownCards.Copper, 1);
});

test("playing an unowned card from the trash does not add it to owned deck knowledge", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot(
      [
        zone(1, "InPlayZone", ["Necromancer"]),
        zone(2, "HandZone", []),
        zone(3, "DrawZone", [], 1),
        zone(4, "DiscardZone", [], 0)
      ],
      "game-1",
      ["Estate", "Necromancer"]
    )
  );

  tracker.applyMove(
    moveWithNames(neutralSummaryZone(100, "TrashZone", ["Zombie Apprentice"]), summaryZone(1, "InPlayZone", ["Necromancer", "Zombie Apprentice"]), [
      "Zombie Apprentice"
    ])
  );

  const [knowledge] = tracker.summary().players;
  const inPlay = knowledge?.zones.find((item) => item.zoneName === "InPlayZone");
  const draw = knowledge?.zones.find((item) => item.zoneName === "DrawZone");

  assert.deepEqual(knowledge?.totalKnownOwned, { Estate: 1, Necromancer: 1 });
  assert.deepEqual(inPlay?.knownCards, { Necromancer: 1, "Zombie Apprentice": 1 });
  assert.deepEqual(draw?.knownCards, { Estate: 1 });
  assert.equal(draw?.unknownCount, 0);
  assert.deepEqual(knowledge?.unlocatedKnownCards, {});
});

test("gain then play from a player zone keeps the gained card owned", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(snapshot([zone(1, "SetAsideZone", []), zone(2, "InPlayZone", [])]));

  tracker.applyMove(moveWithNames(neutralSummaryZone(100, "SetAsideZone", ["Smithy"]), summaryZone(1, "SetAsideZone", ["Smithy"]), ["Smithy"]));
  tracker.applyMove(moveWithNames(summaryZone(1, "SetAsideZone", ["Smithy"]), summaryZone(2, "InPlayZone", ["Smithy"]), ["Smithy"]));

  const [knowledge] = tracker.summary().players;
  const inPlay = knowledge?.zones.find((item) => item.zoneName === "InPlayZone");

  assert.deepEqual(knowledge?.totalKnownOwned, { Smithy: 1 });
  assert.deepEqual(inPlay?.knownCards, { Smithy: 1 });
});

test("log-revealed topdeck converts one anonymous draw card into a known card", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot(
      [
        zone(10, "HandZone", [], 5, opponent),
        zone(11, "DrawZone", [], 5, opponent)
      ],
      "game-1",
      ["Copper", "Copper", "Copper", "Copper", "Copper", "Copper", "Copper", "Estate", "Estate", "Estate"]
    )
  );

  tracker.applyMove(move(opponentSummaryZone(10, "HandZone", ["Back"]), opponentSummaryZone(11, "DrawZone", ["Back"]), 1));
  assert.equal(tracker.markKnownCardInZone(opponent, "DrawZone", "Estate"), true);

  const opponentKnowledge = tracker.summary().players.find((item) => item.player.index === opponent.index);
  const draw = opponentKnowledge?.zones.find((item) => item.zoneName === "DrawZone");
  const hand = opponentKnowledge?.zones.find((item) => item.zoneName === "HandZone");

  assert.deepEqual(draw?.knownCards, { Estate: 1 });
  assert.equal(draw?.ambiguousCount, 5);
  assert.equal(hand?.ambiguousCount, 4);
  assert.deepEqual(opponentKnowledge?.unlocatedKnownCards, {});
  assert.deepEqual(opponentKnowledge?.ambiguousLocationGroups, [
    {
      zoneKeys: ["10:HandZone", "11:DrawZone"],
      zoneNames: ["HandZone", "DrawZone"],
      knownCards: { Copper: 7, Estate: 2 },
      totalCount: 9
    }
  ]);
});

test("gaining a known card onto deck keeps before-move identity when Dominion anonymizes it", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot([
      zone(0, "HandZone", ["Bureaucrat"]),
      zone(1, "DrawZone", [], 0),
      zone(2, "DiscardZone", [], 0)
    ])
  );

  tracker.applyMove({
    kind: "card-move",
    capturedAt: new Date(1).toISOString(),
    phase: "after",
    from: neutralSummaryZone(100, "SetAsideZone", ["Silver"]),
    to: summaryZone(1, "DrawZone", ["Back"]),
    cardIds: [20],
    cards: ["Silver"],
    cardIdsAfterMoving: [-1],
    cardsAfterMoving: ["Anonymous"]
  });

  const [knowledge] = tracker.summary().players;
  const draw = knowledge?.zones.find((item) => item.zoneName === "DrawZone");

  assert.equal(knowledge?.totalKnownOwned.Silver, 1);
  assert.equal(draw?.knownCards.Silver, 1);
  assert.equal(draw?.unknownCount, 0);
  assert.equal(draw?.totalCount, 1);
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

test("trashing cards to a neutral trash zone does not create a fake player", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot([
      zone(1, "HandZone", ["Chapel", "Copper", "Copper", "Estate"]),
      zone(2, "DiscardZone", [])
    ])
  );

  tracker.applyMove(moveWithNames(summaryZone(1, "HandZone", ["Copper"]), neutralSummaryZone(100, "TrashZone", ["Copper"]), ["Copper", "Copper"]));

  const summary = tracker.summary();
  const heroKnowledge = summary.players.find((item) => item.player.index === player.index);

  assert.equal(summary.players.some((item) => item.player.index === -1), false);
  assert.deepEqual(heroKnowledge?.totalKnownOwned, { Chapel: 1, Estate: 1 });
  assert.equal(heroKnowledge?.zones.find((item) => item.zoneName === "TrashZone"), undefined);
});

test("removing a revealed card from an unknown owned ledger consumes unknown ownership", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(snapshot([zone(1, "HandZone", [], 1)]));

  tracker.applyMove(moveWithNames(summaryZone(1, "HandZone", ["Back"]), neutralSummaryZone(100, "TrashZone", ["Estate"]), ["Estate"]));

  const [knowledge] = tracker.summary().players;

  assert.deepEqual(knowledge?.totalKnownOwned, {});
  assert.equal(knowledge?.totalUnknownOwned, 0);
  assert.equal(knowledge?.zones.find((item) => item.zoneName === "HandZone"), undefined);
  assert.equal(knowledge?.zones.find((item) => item.zoneName === "TrashZone"), undefined);
});

test("restoring stale storage skips neutral pseudo-player entries", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.restore({
    version: 1,
    initialized: true,
    gameInstanceId: "game-1",
    players: [
      {
        key: "0",
        player,
        confidence: "observed",
        totalKnownOwned: { Copper: 1 },
        totalUnknownOwned: 0,
        zones: [{ zoneKey: "1:HandZone", zoneName: "HandZone", knownCards: { Copper: 1 }, unknownCount: 0 }]
      },
      {
        key: "-1",
        player: { index: -1, isHero: false },
        confidence: "partial",
        totalKnownOwned: { Copper: 3 },
        totalUnknownOwned: 0,
        zones: [{ zoneKey: "100:TrashZone", zoneName: "TrashZone", knownCards: { Copper: 3 }, unknownCount: 0 }]
      }
    ]
  });

  const summary = tracker.summary();

  assert.equal(summary.players.length, 1);
  assert.equal(summary.players[0]?.player.index, player.index);
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

test("initial dropped-in snapshot includes visible discard knowledge", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(snapshot([zone(1, "DiscardZone", ["Silver"], 2)], "game-1"));

  const [knowledge] = tracker.summary().players;
  const discard = knowledge?.zones.find((item) => item.zoneName === "DiscardZone");

  assert.equal(knowledge?.totalKnownOwned.Silver, 1);
  assert.equal(knowledge?.totalUnknownOwned, 2);
  assert.deepEqual(discard?.knownCards, { Silver: 1 });
  assert.equal(discard?.unknownCount, 2);
  assert.equal(discard?.totalCount, 3);
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

test("discarding revealed cards keeps before-move identities when Dominion anonymizes lower discard cards", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot([
      zone(10, "RevealZone", ["Copper", "Smithy"], 0, opponent),
      zone(11, "DiscardZone", [], 0, opponent)
    ])
  );

  tracker.applyMove({
    kind: "card-move",
    capturedAt: new Date(1).toISOString(),
    phase: "after",
    from: opponentSummaryZone(10, "RevealZone", ["Copper", "Smithy"]),
    to: opponentSummaryZone(11, "DiscardZone", ["Smithy"]),
    cardIds: [20, 21],
    cards: ["Copper", "Smithy"],
    cardIdsAfterMoving: [-1, 21],
    cardsAfterMoving: ["Anonymous", "Smithy"]
  });
  tracker.applySnapshot(
    snapshot([
      zone(10, "RevealZone", [], 0, opponent),
      zone(11, "DiscardZone", ["Smithy"], 0, opponent)
    ])
  );

  const knowledge = tracker.summary().players.find((item) => item.player.index === opponent.index);
  const discard = knowledge?.zones.find((item) => item.zoneName === "DiscardZone");

  assert.deepEqual(discard?.knownCards, { Copper: 1, Smithy: 1 });
  assert.equal(discard?.unknownCount, 0);
  assert.equal(discard?.totalCount, 2);
});

test("topdecking revealed cards keeps before-move identities when Dominion anonymizes draw cards", () => {
  const tracker = new DeckKnowledgeTracker();
  tracker.applySnapshot(
    snapshot([
      zone(1, "DrawZone", [], 6),
      zone(2, "RevealZone", ["Silver", "Copper"], 0)
    ])
  );

  tracker.applyMove({
    kind: "card-move",
    capturedAt: new Date(1).toISOString(),
    phase: "after",
    from: summaryZone(2, "RevealZone", ["Silver", "Copper"]),
    to: summaryZone(1, "DrawZone", ["Back"]),
    cardIds: [20, 21],
    cards: ["Silver", "Copper"],
    cardIdsAfterMoving: [-1, -1],
    cardsAfterMoving: ["Anonymous", "Anonymous"]
  });
  tracker.applySnapshot(
    snapshot([
      zone(1, "DrawZone", [], 8),
      zone(2, "RevealZone", [], 0)
    ])
  );

  const [knowledge] = tracker.summary().players;
  const draw = knowledge?.zones.find((item) => item.zoneName === "DrawZone");

  assert.equal(draw?.knownCards.Copper, 1);
  assert.equal(draw?.knownCards.Silver, 1);
  assert.equal(draw?.unknownCount, 6);
  assert.equal(draw?.totalCount, 8);
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
