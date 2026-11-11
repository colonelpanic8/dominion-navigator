/** Piles of two different cards, which share no type to group them by. The first is the one a kingdom names. */
const PAIRED_PILES = [
  ["Encampment", "Plunder"],
  ["Patrician", "Emporium"],
  ["Settlers", "Bustling Village"],
  ["Catapult", "Rocks"],
  ["Gladiator", "Fortune"],
  ["Sauna", "Avanto"]
];

const GENERIC_TYPES = new Set(["Action", "Attack", "Victory", "Treasure", "Reaction", "Duration", "Randomizer"]);

type CardTypes = { name: string; types: string[] };

/**
 * Each split pile: the randomizer card a kingdom names it by, the type (Fort,
 * Knight, Castle, ...) all its cards share, and those cards.
 */
function randomizerPiles(cards: CardTypes[]): Array<{ randomizer: string; pileType: string; members: string[] }> {
  return cards
    .filter((card) => card.types.includes("Randomizer"))
    .flatMap((randomizer) => {
      const pileType = randomizer.types.find((type) => !GENERIC_TYPES.has(type));
      if (!pileType) return [];
      const members = cards
        .filter((card) => card.types.includes(pileType) && !card.types.includes("Randomizer"))
        .map((card) => card.name)
        .sort((a, b) => a.localeCompare(b));
      return [{ randomizer: randomizer.name, pileType, members }];
    });
}

/** Every card of each split or mixed pile, keyed by each of those cards and by the pile's randomizer. */
export function splitPiles(cards: CardTypes[]): Map<string, string[]> {
  const piles = new Map<string, string[]>();
  for (const { randomizer, members } of randomizerPiles(cards)) for (const card of [randomizer, ...members]) piles.set(card, members);
  for (const pair of PAIRED_PILES) for (const member of pair) piles.set(member, pair);
  return piles;
}

function plural(word: string): string {
  if (/(s|folk)$/.test(word)) return word;
  if (/(sh|ch|x)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/**
 * The card names a table's kingdom must require for `names`, matched without
 * case. A split or paired pile can only be required as a whole, by its
 * randomizer (Fort Pile) or first card (Encampment), so a member of the pile
 * (Tent) or its plural (Forts) resolves to that.
 */
export function resolveKingdomNames(names: string[], cards: CardTypes[]): { cards: string[]; unknown: string[] } {
  const byName = new Map(cards.map((card) => [card.name.toLowerCase(), card.name]));
  for (const { randomizer, pileType, members } of randomizerPiles(cards)) {
    for (const alias of [pileType, plural(pileType)]) if (!byName.has(alias.toLowerCase())) byName.set(alias.toLowerCase(), randomizer);
    for (const member of members) byName.set(member.toLowerCase(), randomizer);
  }
  for (const [first, ...rest] of PAIRED_PILES) for (const member of rest) byName.set(member.toLowerCase(), first!);

  const resolved = names.map((name) => byName.get(name.trim().toLowerCase()));
  return {
    cards: [...new Set(resolved.filter((name): name is string => Boolean(name)))],
    unknown: names.filter((_, index) => !resolved[index])
  };
}
