import assert from "node:assert/strict";
import test from "node:test";
import { parseLogCardList, parseRevealedHandLog } from "../src/log-parser";

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
