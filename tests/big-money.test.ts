import assert from "node:assert/strict";
import test from "node:test";
import { BigMoneyPolicy } from "../src/agent/policies/big-money";
import { DecidableView } from "../src/agent/policy";
import { fixture, fixtures, view } from "./live-fixtures";

test("Big Money plays treasures, then buys by coin thresholds", () => {
  const policy = new BigMoneyPolicy();
  const glossary = {};
  const withTreasures = view(fixture("GAME_BUY_PHASE", ["buy", "play", "button"])) as DecidableView;
  assert.equal(withTreasures.decision.options[policy.decide(withTreasures, { glossary }).indices[0]!]!.label, "Autoplay Treasures");

  const buy = view(fixture("GAME_BUY_PHASE", ["buy"])) as DecidableView;
  const allCards = ["Province", "Gold", "Silver", "Estate"].map((card, index) => ({ index, group: 0, kind: "card" as const, label: card, card }));
  const decision = { ...buy.decision, options: [...allCards, { index: 4, group: 0, kind: "decline" as const, label: "End Buys" }] };
  const choose = (coins: number): string => {
    const choice = policy.decide({ ...buy, decision, turn: { ...buy.turn, coins } }, { glossary });
    return decision.options[choice.indices[0]!]!.label;
  };
  assert.deepEqual([8, 7, 6, 5, 3, 2].map(choose), ["Province", "Gold", "Gold", "Silver", "Silver", "End Buys"]);
});

test("Big Money's defaults trash junk and gain the most valuable card", () => {
  const policy = new BigMoneyPolicy();
  const trash = view(fixture("REMODEL_TRASH")) as DecidableView;
  const trashFrom = (cards: string[]): string => {
    const options = cards.map((card, index) => ({ index, group: 0, kind: "card" as const, label: card, card }));
    const choice = policy.decide({ ...trash, decision: { ...trash.decision, options } }, { glossary: {} });
    return options[choice.indices[0]!]!.card;
  };
  assert.equal(trashFrom(["Province", "Copper", "Silver"]), "Copper");
  assert.equal(trashFrom(["Gold", "Estate", "Curse"]), "Curse");
  assert.equal(trashFrom(["Province", "Gold"]), "Gold");

  const gainedFrom = (source: string): string => {
    const gain = view(fixtures.find((item) => item.source.endsWith(source))!) as DecidableView;
    assert.equal(gain.decision.kind, "gain");
    return gain.decision.options[policy.decide(gain, { glossary: {} }).indices[0]!]!.card!;
  };
  assert.equal(gainedFrom("185808138#10"), "Silver", "treasure over an equally priced Action");
  assert.equal(gainedFrom("185808326#40"), "Province");
});
