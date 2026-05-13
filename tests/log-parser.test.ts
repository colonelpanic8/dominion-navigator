import assert from "node:assert/strict";
import test from "node:test";
import { parseLogCardList, parseReactionLog, parseRevealedHandLog, parseTopdeckLog } from "../src/log-parser";

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

test("does not singularize already-singular s-ending card names", () => {
  assert.deepEqual(parseLogCardList("a Fortress, a Duchess, and a Crossroads"), ["Fortress", "Duchess", "Crossroads"]);
});

test("keeps canonical plural-form card names", () => {
  assert.deepEqual(parseLogCardList("2 Rats, 2 Spoils, and 2 Supplies"), [
    "Rats",
    "Rats",
    "Spoils",
    "Spoils",
    "Supplies",
    "Supplies"
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

test("parses topdeck logs with source suffixes", () => {
  assert.deepEqual(parseTopdeckLog("c topdecks a Silver with Travelling Fair.", ["Silver", "Travelling Fair"]), {
    playerToken: "c",
    cards: ["Silver"]
  });
  assert.deepEqual(parseTopdeckLog("c topdecks 2 Coppers and an Estate with Travelling Fair.", ["Copper", "Estate"]), {
    playerToken: "c",
    cards: ["Copper", "Copper", "Estate"]
  });
});
