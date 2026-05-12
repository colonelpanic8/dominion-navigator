export type RevealedHandLog = {
  playerToken: string;
  cards: string[];
};

export type ReactionLog = {
  playerToken: string;
  card: string;
};

const REVEALED_HAND_LOG_PATTERN = /^(.+?) reveals their hand: (.+)\.$/;
const REACTION_LOG_PATTERN = /^(.+?) reacts with (.+?)\.$/;

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

export function parseLogCardList(text: string, knownCardNames: Iterable<string> = []): string[] {
  const knownCards = knownCardNameMap(knownCardNames);
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
    const name = normalizeLogCardName(rawName, knownCards);
    for (let index = 0; index < count; index += 1) cards.push(name);
  }

  return cards;
}

function knownCardNameMap(knownCardNames: Iterable<string>): Map<string, string> {
  const cards = new Map<string, string>();
  for (const name of knownCardNames) cards.set(name.toLocaleLowerCase(), name);
  return cards;
}

function normalizeLogCardName(rawName: string, knownCardNames: Map<string, string>): string {
  const candidates = [rawName, ...singularCandidates(rawName)];
  for (const candidate of candidates) {
    const knownName = knownCardNames.get(candidate.toLocaleLowerCase());
    if (knownName) return knownName;
  }
  return candidates[candidates.length - 1] ?? rawName;
}

function singularCandidates(name: string): string[] {
  const candidates: string[] = [];
  if (name.endsWith("ies")) candidates.push(`${name.slice(0, -3)}y`);
  if (name.endsWith("s")) candidates.push(name.slice(0, -1));
  return candidates;
}
