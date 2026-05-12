import assert from "node:assert/strict";
import test from "node:test";
import { parseLogCardList, parseReactionLog, parseRevealedHandLog } from "../src/log-parser";

test("parses revealed hand logs with articles, counts, and plurals", () => {
  const parsed = parseRevealedHandLog("L reveals their hand: a Smithy, a Chapel, a Silver, and 2 Golds.", [
    "Chapel",
    "Gold",
    "Silver",
    "Smithy"
  ]);

  assert.deepEqual(parsed, {
    playerToken: "L",
    cards: ["Smithy", "Chapel", "Silver", "Gold", "Gold"]
  });
});

test("parses plural card lists using known card names", () => {
  assert.deepEqual(parseLogCardList("2 Duchies and 3 Curses", ["Curse", "Duchy"]), ["Duchy", "Duchy", "Curse", "Curse", "Curse"]);
});

test("parses es and men plural card names", () => {
  assert.deepEqual(parseLogCardList("2 Fortresses, 2 Witches, and 2 Taxmen", ["Fortress", "Taxman", "Witch"]), [
    "Fortress",
    "Fortress",
    "Witch",
    "Witch",
    "Taxman",
    "Taxman"
  ]);
});

test("falls back to likely singular card names when known names are incomplete", () => {
  assert.deepEqual(parseLogCardList("2 Fortresses, 2 Witches, 2 Curses, and 2 Taxmen"), [
    "Fortress",
    "Fortress",
    "Witch",
    "Witch",
    "Curse",
    "Curse",
    "Taxman",
    "Taxman"
  ]);
});

test("parses empty card list text as no cards", () => {
  assert.deepEqual(parseLogCardList("nothing"), []);
  assert.deepEqual(parseLogCardList("nothing."), []);
  assert.deepEqual(parseLogCardList("no cards"), []);
  assert.deepEqual(parseRevealedHandLog("L reveals their hand: nothing.", ["Copper"]), {
    playerToken: "L",
    cards: []
  });
});

test("parses reaction logs", () => {
  assert.deepEqual(parseReactionLog("L reacts with a Moat.", ["Moat"]), {
    playerToken: "L",
    card: "Moat"
  });
});
