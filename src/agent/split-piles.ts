/** Piles of two different cards, which share no type to group them by. */
const PAIRED_PILES = [
  ["Encampment", "Plunder"],
  ["Patrician", "Emporium"],
  ["Settlers", "Bustling Village"],
  ["Catapult", "Rocks"],
  ["Gladiator", "Fortune"],
  ["Sauna", "Avanto"]
];

const GENERIC_TYPES = new Set(["Action", "Attack", "Victory", "Treasure", "Reaction", "Duration", "Randomizer"]);

/**
 * Every card of each split or mixed pile, keyed by each of those cards. Such a
 * pile has a randomizer card whose own type (Fort, Knight, Castle, ...) all
 * its cards share.
 */
export function splitPiles(cards: Array<{ name: string; types: string[] }>): Map<string, string[]> {
  const piles = new Map<string, string[]>();
  for (const randomizer of cards.filter((card) => card.types.includes("Randomizer"))) {
    const pileType = randomizer.types.find((type) => !GENERIC_TYPES.has(type));
    if (!pileType) continue;
    const members = cards
      .filter((card) => card.types.includes(pileType) && !card.types.includes("Randomizer"))
      .map((card) => card.name)
      .sort((a, b) => a.localeCompare(b));
    for (const member of members) piles.set(member, members);
  }
  for (const pair of PAIRED_PILES) for (const member of pair) piles.set(member, pair);
  return piles;
}
