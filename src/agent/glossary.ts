import { CardGlossary, Cost } from "./types";

/** The shape of `cardShapedObjects` entries in data/dominion-card-shaped-objects.json. */
export type CardDataEntry = {
  name: string;
  text: string | null;
  types: string[];
  expansion: string | null;
};

/** Converts the client's card-text markup to plain text. */
export function normalizeCardText(text: string | null): string {
  if (!text) return "";
  return text
    .replace(/\/\/\/\//g, "\n")
    .replace(/\/\//g, " ")
    .replace(/\|/g, "")
    .replace(/%+/g, "")
    .replace(/\[!?(\d*)D\]/g, (_, amount: string) => `${amount}${amount ? " " : ""}Debt`)
    .replace(/\[P\]/g, "Potion")
    .replace(/\[!?(\d*)\]/g, (_, amount: string) => `$${amount}`)
    .replace(/\{!?(-?\d*)\}/g, (_, amount: string) => `${amount}${amount ? " " : ""}VP`)
    .replace(/<sun>/g, "Sun")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

/** Glossary entries for the named cards, with costs from the live supply where known. */
export function buildCardGlossary(cardData: CardDataEntry[], names: Iterable<string>, costs: Record<string, Cost> = {}): CardGlossary {
  const byName = new Map(cardData.map((entry) => [entry.name.toLowerCase(), entry]));
  const glossary: CardGlossary = {};
  for (const name of [...new Set(names)].sort((a, b) => a.localeCompare(b))) {
    const entry = byName.get(name.toLowerCase());
    const cost = costs[name];
    glossary[name] = {
      name,
      types: entry?.types ?? [],
      ...(entry?.expansion ? { expansion: entry.expansion } : {}),
      ...(cost ? { cost } : {}),
      text: normalizeCardText(entry?.text ?? null)
    };
  }
  return glossary;
}
