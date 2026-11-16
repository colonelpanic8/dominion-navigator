import assert from "node:assert/strict";
import test from "node:test";

const services: Record<string, unknown> = {};
const twoPlayers = { name: "two" };
const ratedGame = { name: "rated" };
const requirePreference = { name: "require" };
const rejectPreference = { name: "reject" };
const eitherPreference = { name: "either" };
Object.assign(globalThis, {
  window: {
    setTimeout,
    angular: { element: () => ({ injector: () => ({ get: (name: string) => services[name] }) }) },
    AUTOMATCH_QUESTION: { NUMBER_OF_PLAYERS: twoPlayers, RATED_GAME: ratedGame },
    MATCHING_PREFERENCE: { REQUIRE: requirePreference, REJECT: rejectPreference, EITHER: eitherPreference }
  },
  document: { body: {}, querySelector: () => null }
});
const { findMatch, readSession } = await import("../src/probe/session");

function lobby() {
  for (const key of Object.keys(services)) delete services[key];
  services.meta = { model: { me: { name: "colonelpanic8" } } };
  let running = false;
  let table = false;
  let searching = false;
  let searches = 0;
  let readies = 0;
  let cancels = 0;
  const criteria = { searchesBot: 1, searchesHuman: false, automatchPreferences: new Map(), minRatingDifference: -10, maxRatingDifference: 10 };
  services.game = { isRunning: () => running, state: { players: [{ isMe: true, playerId: 1 }, { isMe: false, playerId: 2 }] } };
  services.tableService = {
    hasTable: () => table,
    getTable: () => ({ bots: [] }),
    getPlayers: () => [{ name: "colonelpanic8" }, { name: "opponent" }],
    openSeatCount: () => 0,
    ready: () => { readies += 1; running = true; searching = false; }
  };
  services.automatch = {
    matchingCriteria: criteria,
    iAmSearching: () => searching,
    searchNow: () => { searches += 1; searching = true; table = true; },
    cancel: () => { cancels += 1; searching = false; }
  };
  return { criteria, counts: () => ({ searches, readies, cancels }) };
}

test("human matchmaking configures the queue, readies the match, and resumes without searching again", async () => {
  const { criteria, counts } = lobby();
  const result = await findMatch({ players: 3, rated: false, maxRatingDifference: 20, timeoutMs: 1000 });
  assert.equal(result.ok, true);
  assert.equal(readSession().game?.opponentsAreBots, false);
  assert.equal(criteria.searchesBot, 0);
  assert.equal(criteria.searchesHuman, true);
  assert.equal(criteria.automatchPreferences.get(twoPlayers), rejectPreference);
  assert.equal(criteria.automatchPreferences.get(ratedGame), rejectPreference);
  assert.equal(criteria.minRatingDifference, -20);
  assert.equal(criteria.maxRatingDifference, 20);
  assert.deepEqual(counts(), { searches: 1, readies: 1, cancels: 0 });
  assert.equal((await findMatch()).ok, true);
  assert.equal(counts().searches, 1);
});

test("matchmaking defaults to two human players and either rating mode, retaining the rating range", async () => {
  const { criteria } = lobby();
  assert.equal((await findMatch()).ok, true);
  assert.equal(criteria.automatchPreferences.get(twoPlayers), requirePreference);
  assert.equal(criteria.automatchPreferences.get(ratedGame), eitherPreference);
  assert.equal(criteria.maxRatingDifference, 10);
});

test("an unmatched search cancels when its deadline expires", async () => {
  const { counts } = lobby();
  services.tableService = { hasTable: () => false };
  const result = await findMatch({ timeoutMs: 1 });
  assert.deepEqual(result, { ok: false, error: "timed out waiting for a human opponent in automatch" });
  assert.equal(counts().cancels, 1);
  assert.equal(readSession().searching, undefined);
});

test("matchmaking refuses login and bot games without starting a search", async () => {
  const { counts } = lobby();
  services.meta = {};
  assert.deepEqual(await findMatch(), { ok: false, error: "not logged in to dominion.games" });
  services.game = { isRunning: () => true, state: { players: [{ isMe: true }, { playerId: 2 ** 30 }] } };
  assert.deepEqual(await findMatch(), { ok: false, error: "a bot game is in progress; resign it first" });
  assert.equal(counts().searches, 0);
});
