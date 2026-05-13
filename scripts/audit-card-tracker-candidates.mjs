import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const INPUT_PATH = resolve(process.env.DOMINION_CARD_TEXT_INPUT ?? "data/dominion-card-shaped-objects.json");
const JSON_OUTPUT_PATH = resolve(process.env.DOMINION_AUDIT_JSON_OUTPUT ?? INPUT_PATH);

const SCHEMA_VERSION = 2;

const CATEGORY_DEFINITIONS = [
  {
    id: "gain",
    description: "Card text mentions gaining or taking cards.",
    weight: 4,
    patterns: ["\\bgain(?:s|ed|ing)?\\b", "\\btake\\b"]
  },
  {
    id: "gain-to-hand",
    description: "Gain destination may be hand.",
    weight: 3,
    patterns: ["\\bto your hand\\b", "\\binto your hand\\b", "\\bgain .* to your hand\\b"]
  },
  {
    id: "gain-to-deck",
    description: "Gain destination may be deck or top of deck.",
    weight: 3,
    patterns: ["\\bonto your deck\\b", "\\btop of your deck\\b", "\\bon your deck\\b"]
  },
  {
    id: "gain-to-discard",
    description: "Card text mentions the discard pile, often as a gain destination or source.",
    weight: 3,
    patterns: ["\\bdiscard pile\\b"]
  },
  {
    id: "trash",
    description: "Card text can move cards to trash.",
    weight: 4,
    patterns: ["\\btrash(?:es|ed|ing)?\\b"]
  },
  {
    id: "return-to-supply-or-pile",
    description: "Card text can return owned cards to a supply or non-owned pile.",
    weight: 4,
    patterns: ["\\breturn\\b.*\\b(?:supply|pile)\\b", "\\bput (?:it|this|them) back\\b"]
  },
  {
    id: "exile",
    description: "Card text can move cards to or from exile.",
    weight: 3,
    patterns: ["\\bexile(?:s|d)?\\b", "\\bexile mat\\b"]
  },
  {
    id: "tavern-reserve",
    description: "Reserve card or tavern mat behavior can keep cards across turns outside normal play/discard zones.",
    weight: 3,
    patterns: ["\\btavern mat\\b", "\\bcall\\b", "\\breserve\\b"]
  },
  {
    id: "duration-or-next-turn",
    description: "Duration or next-turn behavior can keep cards in play across cleanup.",
    weight: 1,
    patterns: ["\\bduration\\b", "\\bnext turn\\b", "\\bat the start of your next turn\\b"]
  },
  {
    id: "set-aside",
    description: "Card text can set cards aside into temporary hidden or visible zones.",
    weight: 1,
    patterns: ["\\bset aside\\b", "\\bset-aside\\b"]
  },
  {
    id: "exchange",
    description: "Card text exchanges one card-shaped object for another.",
    weight: 4,
    patterns: ["\\bexchange\\b"]
  },
  {
    id: "discard",
    description: "Card text can discard cards.",
    weight: 1,
    patterns: ["\\bdiscard(?:s|ed|ing)?\\b"]
  },
  {
    id: "reveal",
    description: "Card text can reveal or inspect cards, improving location knowledge.",
    weight: 1,
    patterns: ["\\breveal(?:s|ed|ing)?\\b", "\\blook at\\b"]
  },
  {
    id: "shuffle-deck",
    description: "Card text mentions deck or shuffle behavior that can affect hidden ordering knowledge.",
    weight: 1,
    patterns: ["\\bshuffle\\b", "\\bdeck\\b"]
  },
  {
    id: "named-zone",
    description: "Card text mentions a named Dominion zone that may matter for location tracking.",
    weight: 1,
    patterns: ["\\bhand\\b", "\\bdeck\\b", "\\bdiscard pile\\b", "\\bin play\\b", "\\bsupply\\b", "\\btrash\\b", "\\bexile\\b", "\\btavern mat\\b"]
  }
];

const CATEGORY_PATTERN_MATCHERS = CATEGORY_DEFINITIONS.map((category) => ({
  ...category,
  regexes: category.patterns.map((pattern) => new RegExp(pattern, "i"))
}));

const BEHAVIOR_REVIEW_DEFINITIONS = [
  {
    id: "ownership-transform-or-return",
    priority: "must-check",
    description: "Can return or exchange owned cards, so ownership ledgers may need card-specific verification.",
    categoryIds: ["exchange"],
    patterns: [
      "\\breturn (?:this|it|them|up to [^.]+|an? [^.]+|one [^.]+|[A-Za-z ]+) to (?:its|their|the|this) pile\\b",
      "\\breturn (?:this|it) to the [A-Za-z ]+ pile\\b",
      "\\breturn [^.]+ to the Supply\\b",
      "\\bexchange\\b"
    ]
  },
  {
    id: "generic-trash",
    priority: "watch",
    description: "Can trash owned cards; generic movement handling should cover this, but ownership loss should be regression-tested.",
    categoryIds: ["trash"]
  },
  {
    id: "exile-zone",
    priority: "must-check",
    description: "Uses exile, which is a persistent non-deck/non-discard player zone.",
    categoryIds: ["exile"]
  },
  {
    id: "tavern-or-reserve-zone",
    priority: "must-check",
    description: "Uses the tavern mat or Reserve calling flow, which can hold cards outside normal cleanup.",
    categoryIds: ["tavern-reserve"],
    typeIds: ["Reserve"]
  },
  {
    id: "set-aside-zone",
    priority: "must-check",
    description: "Sets cards aside into a temporary or persistent nonstandard zone.",
    categoryIds: ["set-aside"],
    patterns: ["\\bset aside\\b", "\\bset (?:it|this|them|those cards|the card) aside\\b", "\\bIsland mat\\b", "\\bNative Village mat\\b"]
  },
  {
    id: "other-player-mat-zone",
    priority: "must-check",
    description: "Uses a named player mat other than the normal deck, hand, discard, play, trash, exile, or tavern zones.",
    patterns: ["\\bIsland mat\\b", "\\bNative Village mat\\b", "\\bPirate Ship mat\\b"]
  },
  {
    id: "duration-or-delayed-cleanup",
    priority: "watch",
    description: "Can keep cards in play or otherwise defer state changes across turns; likely generic, but turn-boundary behavior needs coverage.",
    categoryIds: ["duration-or-next-turn"],
    typeIds: ["Duration"]
  },
  {
    id: "non-discard-gain-destination",
    priority: "must-check",
    description: "Can gain cards somewhere other than the default discard pile.",
    categoryIds: ["gain-to-hand", "gain-to-deck"],
    patterns: [
      "\\bgain[^.]*\\b(?:to|into) your hand\\b",
      "\\bgain[^.]*\\b(?:onto|on top of|to the top of) your deck\\b",
      "\\bgain[^.]*\\bon your deck\\b"
    ]
  },
  {
    id: "topdeck-or-deck-order",
    priority: "must-check",
    description: "Can put cards onto the deck, reorder cards, or otherwise alter hidden deck order.",
    patterns: [
      "\\btop of your deck\\b",
      "\\bonto your deck\\b",
      "\\bon your deck\\b",
      "\\bput (?:it|them|those|that card|the rest|the cards)[^.]*\\bback\\b",
      "\\bin any order\\b",
      "\\breorder\\b",
      "\\bshuffle your discard pile into your deck\\b"
    ]
  },
  {
    id: "deck-search-or-inspection",
    priority: "must-check",
    description: "Looks through, searches, reveals, or inspects hidden deck cards.",
    patterns: [
      "\\blook (?:at|through)[^.]*\\bdeck\\b",
      "\\breveal[^.]*\\bdeck\\b",
      "\\bsearch[^.]*\\bdeck\\b",
      "\\bfrom your deck\\b",
      "\\bfrom their deck\\b",
      "\\bfrom the top of your deck\\b",
      "\\btop card(?:s)? of your deck\\b"
    ]
  },
  {
    id: "play-from-non-hand-or-unowned-card",
    priority: "must-check",
    description: "Can play cards from deck, discard, trash, Supply, Black Market deck, or other non-hand/unowned sources.",
    typeIds: ["Command", "Shadow"],
    patterns: [
      "\\bplay (?:a|an|any|the|that|this|it|up to|[0-9]+|\\d+)[^.]*\\bfrom (?:your deck|your discard pile|it|the trash|the Supply|them)\\b",
      "\\bfrom your deck as if in your hand\\b",
      "\\bBlack Market deck\\b",
      "\\bleaving it there\\b",
      "\\bplay it at the start of your next turn\\b",
      "\\bplay that card\\b"
    ]
  },
  {
    id: "gain-and-play",
    priority: "must-check",
    description: "Can gain a card and play it immediately or later without first going through the ordinary discard flow.",
    patterns: [
      "\\bgain[^.]*; play it\\b",
      "\\bgain[^.]*and play it\\b",
      "\\bwhen you gain[^.]*\\bplay (?:it|this)\\b",
      "\\bwhen you gain[^.]*\\byou may play (?:it|this)\\b",
      "\\bthe next time you gain[^.]*\\bplay it\\b",
      "\\bgain [^.]+\\. Return to your Action phase and play it\\b"
    ]
  },
  {
    id: "discard-pile-inspection-or-transfer",
    priority: "must-check",
    description: "Looks through or moves cards out of discard, which affects reshuffle/location knowledge.",
    patterns: [
      "\\blook through your discard pile\\b",
      "\\bfrom your discard pile\\b",
      "\\bin your discard pile\\b",
      "\\bput your discard pile\\b",
      "\\bshuffle[^.]*\\bdiscard pile\\b"
    ]
  },
  {
    id: "deck-to-discard-transfer",
    priority: "must-check",
    description: "Moves the draw pile wholesale into discard, which can be lost if later discard snapshots are only partial or top-card-only.",
    patterns: [
      "\\bput your deck into your discard pile\\b",
      "\\bput (?:your|their) deck into (?:your|their) discard pile\\b"
    ]
  },
  {
    id: "hand-discard-or-hand-transfer",
    priority: "watch",
    description: "Moves cards from hand to discard/deck/play in ways that may need knowledge-state checks.",
    patterns: [
      "\\bdiscard (?:a|an|any number of|up to|your|\\d|[0-9]+)[^.]*\\b(?:card|cards|hand)\\b",
      "\\bput (?:a|an|any number of|up to|your|\\d|[0-9]+)[^.]*\\bfrom your hand\\b",
      "\\bfrom your hand\\b"
    ]
  },
  {
    id: "reveal-or-look-knowledge",
    priority: "watch",
    description: "Reveals or looks at cards without necessarily moving them, which can improve certainty.",
    categoryIds: ["reveal"]
  },
  {
    id: "attack-affects-other-player-zones",
    priority: "watch",
    description: "Attack may move or reveal opponents' cards, so opponent knowledge handling should be checked.",
    typeIds: ["Attack"]
  },
  {
    id: "possession-control",
    priority: "must-check",
    description: "Possession-like control changes whose cards are visible, gained, trashed, or set aside.",
    patterns: ["\\bmake all decisions for them\\b", "\\bPossession\\b"]
  },
  {
    id: "player-to-player-card-transfer",
    priority: "must-check",
    description: "Can transfer an owned card directly between players.",
    patterns: ["\\bpasses one to the next\\b", "\\bpass(?:es)? [^.]* to the next\\b"]
  },
  {
    id: "missing-text",
    priority: "must-check",
    description: "The extracted client object had no card text, so this needs follow-up before it can be trusted.",
    missingText: true
  },
  {
    id: "landscape-or-global-effect",
    priority: "watch",
    description: "Card-shaped object is not itself a deck card but can modify card movement rules.",
    typeIds: ["Event", "Project", "Landmark", "Trait", "Way", "Ally", "Prophecy", "State", "Boon", "Hex"]
  }
];

const BEHAVIOR_REVIEW_MATCHERS = BEHAVIOR_REVIEW_DEFINITIONS.map((definition) => ({
  ...definition,
  regexes: (definition.patterns ?? []).map((pattern) => new RegExp(pattern, "i"))
}));

const PRIORITY_RANK = {
  "normal": 0,
  "watch": 1,
  "must-check": 2
};

function normalizeText(text) {
  return text
    .replace(/\|/g, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\/+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreCategories(categoryIds) {
  const weightsById = new Map(CATEGORY_DEFINITIONS.map((category) => [category.id, category.weight]));
  return categoryIds.reduce((sum, categoryId) => sum + (weightsById.get(categoryId) ?? 0), 0);
}

function maxPriority(priorities) {
  return priorities.reduce((max, priority) => (PRIORITY_RANK[priority] > PRIORITY_RANK[max] ? priority : max), "normal");
}

function classifyBehaviorReview(entry, auditRecord) {
  if (!auditRecord?.candidate) {
    return {
      priority: "normal",
      reasonIds: [],
      needsBehaviorCheck: false
    };
  }

  const text = `${entry.name} ${entry.types.join(" ")} ${auditRecord.normalizedText}`;
  const categorySet = new Set(auditRecord.categories);
  const typeSet = new Set(entry.types);
  const reasons = BEHAVIOR_REVIEW_MATCHERS.filter((definition) => {
    const missingTextMatch = Boolean(definition.missingText && auditRecord.missingText);
    const categoryMatch = (definition.categoryIds ?? []).some((categoryId) => categorySet.has(categoryId));
    const typeMatch = (definition.typeIds ?? []).some((typeId) => typeSet.has(typeId));
    const textMatch = definition.regexes.some((regex) => regex.test(text));
    return missingTextMatch || categoryMatch || typeMatch || textMatch;
  });
  const priority = maxPriority(reasons.map((reason) => reason.priority));

  return {
    priority,
    reasonIds: reasons.map((reason) => reason.id),
    needsBehaviorCheck: priority === "must-check"
  };
}

const input = JSON.parse(await readFile(INPUT_PATH, "utf8"));
const cardsByInputKey = new Map(input.cardShapedObjects.map((card) => [card.key, card]));
const cards = input.cardShapedObjects.map((entry) => {
  const normalizedText = normalizeText(entry.text ?? "");
  const searchText = `${entry.name} ${entry.types.join(" ")} ${normalizedText}`;
  const categories = CATEGORY_PATTERN_MATCHERS.filter((category) => category.regexes.some((regex) => regex.test(searchText))).map(
    (category) => category.id
  );
  const missingText = entry.text == null;
  const score = missingText ? 2 : scoreCategories(categories);

  return {
    key: entry.key,
    normalizedText,
    missingText,
    categories,
    score,
    candidate: missingText || score > 0
  };
});

const candidates = cards
  .filter((entry) => entry.candidate)
  .sort((a, b) => {
    const cardA = cardsByInputKey.get(a.key);
    const cardB = cardsByInputKey.get(b.key);
    return b.score - a.score || (cardA?.name ?? a.key).localeCompare(cardB?.name ?? b.key);
  });

const byCategory = {};
for (const candidate of candidates) {
  const categories = candidate.categories.length ? candidate.categories : ["missing-text"];
  for (const category of categories) byCategory[category] = (byCategory[category] ?? 0) + 1;
}

const categoryIds = CATEGORY_DEFINITIONS.map((category) => category.id);
const categoriesById = Object.fromEntries(CATEGORY_DEFINITIONS.map(({ id, description, weight, patterns }) => [id, { id, description, weight, patterns }]));
const candidateKeys = candidates.map((candidate) => candidate.key);
const candidateKeysByCategory = Object.fromEntries([...categoryIds, "missing-text"].map((category) => [category, []]));
for (const candidate of candidates) {
  const categories = candidate.categories.length ? candidate.categories : ["missing-text"];
  for (const category of categories) candidateKeysByCategory[category].push(candidate.key);
}

const auditByCardKey = Object.fromEntries(cards.map((card) => [card.key, card]));
const candidateAuditByCardKey = Object.fromEntries(candidates.map((candidate) => [candidate.key, candidate]));
const behaviorReviewByCardKey = Object.fromEntries(
  input.cardShapedObjects.map((entry) => [entry.key, classifyBehaviorReview(entry, auditByCardKey[entry.key])])
);
const behaviorReviewRecords = input.cardShapedObjects
  .map((entry) => ({
    key: entry.key,
    ...behaviorReviewByCardKey[entry.key]
  }))
  .filter((entry) => entry.priority !== "normal")
  .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || (cardsByInputKey.get(a.key)?.name ?? a.key).localeCompare(cardsByInputKey.get(b.key)?.name ?? b.key));
const behaviorCheckKeys = behaviorReviewRecords.filter((entry) => entry.needsBehaviorCheck).map((entry) => entry.key);
const watchKeys = behaviorReviewRecords.filter((entry) => entry.priority === "watch").map((entry) => entry.key);
const behaviorReviewCounts = {
  "must-check": behaviorCheckKeys.length,
  "watch": watchKeys.length,
  "normal": input.cardShapedObjects.length - behaviorReviewRecords.length
};
const behaviorReviewKeysByReason = Object.fromEntries(BEHAVIOR_REVIEW_DEFINITIONS.map((definition) => [definition.id, []]));
for (const entry of behaviorReviewRecords) {
  for (const reasonId of entry.reasonIds) behaviorReviewKeysByReason[reasonId].push(entry.key);
}
const trackerAudit = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  candidateCount: candidates.length,
  contract: {
    cardKeyField: "cardShapedObjects[].key",
    auditRecordField: "trackerAudit.auditByCardKey[cardKey]",
    categoryField: "trackerAudit.auditByCardKey[cardKey].categories",
    candidateDefinition: "missingText is true or score is greater than zero"
  },
  categoryDefinitions: CATEGORY_DEFINITIONS,
  categoriesById,
  categoryCounts: byCategory,
  candidateKeys,
  candidateKeysByCategory,
  cardAuditRecords: cards,
  auditByCardKey,
  candidateAuditRecords: candidates,
  candidateAuditByCardKey,
  behaviorReview: {
    reviewVersion: 1,
    generatedAt: new Date().toISOString(),
    reviewedCandidateCount: candidates.length,
    reviewBasis:
      "Codex read the normalized text for each tracker candidate and encoded the resulting judgment as reason definitions plus per-card priority records.",
    priorityDefinitions: {
      "must-check": "Likely to require explicit in-game behavior checks for ownership, location, or knowledge tracking.",
      "watch": "Worth awareness, but probably handled by generic move/snapshot logic unless testing proves otherwise.",
      "normal": "No tracker-specific behavior found beyond ordinary draw/economy or generic movement."
    },
    reasonDefinitions: BEHAVIOR_REVIEW_DEFINITIONS,
    counts: behaviorReviewCounts,
    behaviorCheckKeys,
    watchKeys,
    behaviorReviewKeysByReason,
    reviewRecords: behaviorReviewRecords,
    reviewByCardKey: behaviorReviewByCardKey
  }
};

const output = {
  ...input,
  trackerAudit
};

await writeFile(
  JSON_OUTPUT_PATH,
  `${JSON.stringify(output, null, 2)}\n`
);

console.log(`Wrote tracker audit for ${candidates.length} candidates to ${JSON_OUTPUT_PATH}`);
