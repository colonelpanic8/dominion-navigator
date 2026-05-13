export type RevealedHandLog = {
  playerToken: string;
  cards: string[];
};

export type ReactionLog = {
  playerToken: string;
  card: string;
};

export type TopdeckLog = {
  playerToken: string;
  cards: string[];
};

const REVEALED_HAND_LOG_PATTERN = /^(.+?) reveals their hand: (.+)\.$/;
const REACTION_LOG_PATTERN = /^(.+?) reacts with (.+?)\.$/;
const TOPDECK_LOG_PATTERN = /^(.+?) topdecks (.+?)\.$/;
const CANONICAL_S_ENDING_CARD_NAMES = new Map(
  [
    "Apparatus",
    "Band Of Misfits",
    "Campus",
    "Castles",
    "Catacombs",
    "Crossroads",
    "Distant Lands",
    "Doubloons",
    "Duchess",
    "Enchantress",
    "Fairgrounds",
    "Farmhands",
    "Followers",
    "Fortress",
    "Gardens",
    "Goons",
    "Hanging Gardens",
    "Haunted Woods",
    "Horse Traders",
    "Hunting Grounds",
    "Ill Gotten Gains",
    "Ironworks",
    "Jack Of All Trades",
    "Jewels",
    "Knights",
    "Lab Rats",
    "Lackeys",
    "Marquis",
    "Necropolis",
    "Nobles",
    "Nomads",
    "Oasis",
    "Princess",
    "Rats",
    "Rocks",
    "Settlers",
    "Smugglers",
    "Sorceress",
    "Spices",
    "Spoils",
    "Stables",
    "Supplies",
    "Survivors",
    "Swamp Shacks",
    "Tide Pools",
    "Tools",
    "Trinkets"
  ].map((name) => [name.toLocaleLowerCase(), name])
);

export function parseRevealedHandLog(text: string, knownCardNames: Iterable<string> = []): RevealedHandLog | undefined {
  const match = text.match(REVEALED_HAND_LOG_PATTERN);
  if (!match) return undefined;
  const [, playerToken, cardText] = match;
  if (!playerToken || !cardText) return undefined;
  return {
    playerToken,
    cards: parseLogCardList(cardText, knownCardNames)
  };
}

export function parseReactionLog(text: string, knownCardNames: Iterable<string> = []): ReactionLog | undefined {
  const match = text.match(REACTION_LOG_PATTERN);
  if (!match) return undefined;
  const [, playerToken, cardText] = match;
  if (!playerToken || !cardText) return undefined;
  const [card] = parseLogCardList(cardText, knownCardNames);
  if (!card) return undefined;
  return { playerToken, card };
}

export function parseTopdeckLog(text: string, knownCardNames: Iterable<string> = []): TopdeckLog | undefined {
  const match = text.match(TOPDECK_LOG_PATTERN);
  if (!match) return undefined;
  const [, playerToken, cardText] = match;
  if (!playerToken || !cardText) return undefined;
  return {
    playerToken,
    cards: parseLogCardList(stripTopdeckSource(cardText), knownCardNames)
  };
}

export function parseLogCardList(text: string, knownCardNames: Iterable<string> = []): string[] {
  const knownCards = knownCardNameMap(knownCardNames);
  if (isEmptyCardListText(text)) return [];

  const parts = text
    .replace(/,?\s+and\s+/g, ", ")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const cards: string[] = [];
  for (const part of parts) {
    const countMatch = part.match(/^(\d+)\s+(.+)$/);
    const count = countMatch ? Number(countMatch[1]) : 1;
    const rawName = (countMatch ? countMatch[2] : part)?.replace(/^(?:a|an|the)\s+/i, "").trim();
    if (!rawName || !Number.isFinite(count) || count <= 0) continue;
    const name = normalizeLogCardName(rawName, knownCards, Boolean(countMatch));
    for (let index = 0; index < count; index += 1) cards.push(name);
  }

  return cards;
}

function stripTopdeckSource(text: string): string {
  return text.replace(/\s+with\s+.+$/i, "").trim();
}

function isEmptyCardListText(text: string): boolean {
  return /^(?:nothing|no cards?|none)$/i.test(text.trim().replace(/[.!]$/, ""));
}

function knownCardNameMap(knownCardNames: Iterable<string>): Map<string, string> {
  const cards = new Map<string, string>();
  for (const name of knownCardNames) cards.set(name.toLocaleLowerCase(), name);
  return cards;
}

function normalizeLogCardName(rawName: string, knownCardNames: Map<string, string>, allowSingularFallback: boolean): string {
  const candidates = [rawName, ...singularCandidates(rawName)];
  for (const candidate of candidates) {
    const knownName = knownCardNames.get(candidate.toLocaleLowerCase());
    if (knownName) return knownName;
  }

  const canonicalName = CANONICAL_S_ENDING_CARD_NAMES.get(rawName.toLocaleLowerCase());
  if (canonicalName) return canonicalName;

  if (!allowSingularFallback) return rawName;
  return candidates[candidates.length - 1] ?? rawName;
}

function singularCandidates(name: string): string[] {
  const candidates: string[] = [];
  if (name.endsWith("ies")) candidates.push(`${name.slice(0, -3)}y`);
  if (name.endsWith("men")) candidates.push(`${name.slice(0, -3)}man`);
  if (name.endsWith("es")) {
    const withoutEs = name.slice(0, -2);
    const withoutS = name.slice(0, -1);
    if (/(?:ches|shes|xes|sses)$/i.test(name)) candidates.push(withoutS, withoutEs);
    else candidates.push(withoutEs, withoutS);
  } else if (name.endsWith("s")) {
    candidates.push(name.slice(0, -1));
  }
  return [...new Set(candidates)];
}
