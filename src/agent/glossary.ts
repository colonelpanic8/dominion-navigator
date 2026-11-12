import { splitPiles } from "./split-piles";
import { AgentView, CardGlossary, Cost } from "./types";

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
  const text = (name: string): string => normalizeCardText(byName.get(name.toLowerCase())?.text ?? null);
  const piles = splitPiles(cardData);
  const glossary: CardGlossary = {};
  const wanted = new Set(names);
  for (const name of [...wanted].sort((a, b) => a.localeCompare(b))) {
    const entry = byName.get(name.toLowerCase());
    const cost = costs[name];
    const members = entry?.types.includes("Randomizer") ? piles.get(entry.name) : undefined;
    // A randomizer with no text of its own, such as the Ruin Pile, is described by the cards it holds.
    const listed = members?.every((member) => wanted.has(member));
    const pileText = members?.length ? `A pile of these cards: ${members.map((member) => (listed ? member : `${member}: ${text(member)}`)).join(listed ? ", " : "; ")}` : "";
    glossary[name] = {
      name,
      types: entry?.types ?? [],
      ...(entry?.expansion ? { expansion: entry.expansion } : {}),
      ...(cost ? { cost } : {}),
      text: text(name) || pileText
    };
  }
  return glossary;
}

/** Every card a view names: piles and the other cards of split piles, landscapes, known owned cards and decision options. */
export function viewCardNames(view: AgentView): Set<string> {
  const names = new Set<string>();
  for (const pile of [...view.supply, ...view.nonSupply, ...view.landscapes]) for (const card of [pile.card, ...(pile.others ?? [])]) names.add(card);
  for (const player of [view.you, ...view.opponents]) {
    if (!player) continue;
    for (const card of Object.keys(player.owned.known)) names.add(card);
  }
  for (const option of view.decision?.options ?? []) if (option.card) names.add(option.card);
  return names;
}

/** Live costs of the supply piles, for `buildCardGlossary`. */
export function supplyCosts(view: AgentView): Record<string, Cost> {
  return Object.fromEntries(view.supply.filter((pile) => pile.cost).map((pile) => [pile.card, pile.cost!]));
}

/** One line per card: name, cost and types, then the text with line breaks flattened. */
export function renderGlossary(glossary: CardGlossary): string[] {
  return Object.values(glossary).map((entry) => {
    const cost = entry.cost
      ? [`$${entry.cost.coins}`, entry.cost.potions ? `${entry.cost.potions}P` : "", entry.cost.debt ? `${entry.cost.debt}D` : ""].filter(Boolean).join("+")
      : "";
    const facts = [cost, entry.types.join("-")].filter(Boolean).join(", ");
    return `${entry.name}${facts ? ` (${facts})` : ""}: ${entry.text.replace(/\n+/g, " / ") || "no card text on record"}`;
  });
}
