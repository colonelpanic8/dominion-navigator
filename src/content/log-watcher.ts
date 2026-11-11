import { DeckKnowledgeTracker } from "../knowledge";
import { parseReactionLog, parseRevealedHandLog, parseTopdeckLog } from "../log-parser";
import { NavigatorSnapshot, PlayerSummary } from "../messages";
import { AnonymousTopdeckQueue } from "../topdeck-tracking";

const LOG_LINE_SELECTOR = ".log-line";
/** How long to keep retrying a knowledge log line the tracker can't apply yet. */
const LOG_LINE_RETRY_MS = 5000;
const LOG_SCAN_INTERVAL_MS = 1000;

export type LogKnowledgeWatcherDeps = {
  tracker: DeckKnowledgeTracker;
  topdecks: AnonymousTopdeckQueue;
  latestSnapshot: () => NavigatorSnapshot | undefined;
  onKnowledgeChanged: () => void;
};

function isPotentialKnowledgeLogLine(text: string): boolean {
  return /(?:\btopdecks\b|\breveals their hand:|\breacts with\b)/.test(text);
}

function containingLogLine(node: Node): Element | undefined {
  if (node instanceof Element) {
    if (node.classList.contains("log-line")) return node;
    return node.closest(LOG_LINE_SELECTOR) ?? undefined;
  }
  return node.parentNode instanceof Element ? node.parentNode.closest(LOG_LINE_SELECTOR) ?? undefined : undefined;
}

function currentLogLines(): Element[] {
  return Array.from(document.querySelectorAll(LOG_LINE_SELECTOR));
}

/**
 * Applies game-log lines that reveal hidden cards (topdecks, revealed hands,
 * reactions) to the tracker. Lines present before the first snapshot are history
 * and are skipped.
 */
export class LogKnowledgeWatcher {
  private readonly seen = new WeakSet<Element>();
  private pendingFirstSeen = new WeakMap<Element, number>();
  private ready = false;

  constructor(private readonly deps: LogKnowledgeWatcherDeps) {}

  install(): void {
    for (const element of currentLogLines()) this.seen.add(element);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          const logLine = containingLogLine(mutation.target);
          if (logLine) this.processLogLine(logLine);
        }

        for (const node of Array.from(mutation.addedNodes)) {
          const logLine = containingLogLine(node);
          if (logLine) this.processLogLine(logLine);
          if (node instanceof Element) {
            for (const child of Array.from(node.querySelectorAll(LOG_LINE_SELECTOR))) this.processLogLine(child);
          }
        }
      }
    });
    observer.observe(document.body, { characterData: true, childList: true, subtree: true });
    window.setInterval(() => {
      for (const element of currentLogLines()) this.processLogLine(element);
    }, LOG_SCAN_INTERVAL_MS);
  }

  /** Marks the current log as history and starts applying new lines. Idempotent. */
  startAfterCurrentHistory(): void {
    if (this.ready) return;
    for (const element of currentLogLines()) this.seen.add(element);
    this.pendingFirstSeen = new WeakMap<Element, number>();
    this.ready = true;
  }

  private processLogLine(element: Element): void {
    if (this.seen.has(element)) return;
    if (!this.ready) {
      this.seen.add(element);
      return;
    }

    const text = element.textContent?.replace(/\s+/g, " ").trim();
    if (!text) return;
    const isKnowledgeLog = Boolean(parseTopdeckLog(text) || parseRevealedHandLog(text) || parseReactionLog(text));
    if (!isKnowledgeLog) {
      if (isPotentialKnowledgeLogLine(text)) this.deferUnresolved(element);
      else this.seen.add(element);
      return;
    }

    if (!this.applyTopdeck(text) && !this.applyRevealedHand(text) && !this.applyReaction(text)) {
      this.deferUnresolved(element);
      return;
    }

    this.pendingFirstSeen.delete(element);
    this.seen.add(element);
    this.deps.onKnowledgeChanged();
  }

  private deferUnresolved(element: Element): void {
    const firstSeen = this.pendingFirstSeen.get(element) ?? Date.now();
    this.pendingFirstSeen.set(element, firstSeen);
    if (Date.now() - firstSeen > LOG_LINE_RETRY_MS) {
      this.pendingFirstSeen.delete(element);
      this.seen.add(element);
    }
  }

  /** Log lines may abbreviate player names, so accept a unique prefix match. */
  private playerForLogToken(token: string): PlayerSummary | undefined {
    const players = this.deps.latestSnapshot()?.players ?? [];
    const exactMatches = players.filter((player) => player.name === token);
    if (exactMatches.length === 1) return exactMatches[0];

    const prefixMatches = players.filter((player) => player.name?.startsWith(token));
    return prefixMatches.length === 1 ? prefixMatches[0] : undefined;
  }

  private knownCardNames(): string[] {
    const snapshot = this.deps.latestSnapshot();
    const names = new Set<string>([...(snapshot?.setupCards ?? []), ...(snapshot?.startingDeck ?? [])]);
    for (const player of this.deps.tracker.summary().players) {
      for (const cardName of Object.keys(player.totalKnownOwned)) names.add(cardName);
      for (const zone of player.zones) {
        for (const cardName of Object.keys(zone.knownCards)) names.add(cardName);
      }
    }
    return [...names];
  }

  private applyTopdeck(text: string): boolean {
    const topdeck = parseTopdeckLog(text, this.knownCardNames());
    if (!topdeck) return false;
    const player = this.playerForLogToken(topdeck.playerToken);
    if (!player) return false;
    const cardNames = topdeck.cards;
    if (cardNames.length === 0) return false;
    if (!this.deps.topdecks.consume(player, cardNames.length)) return false;
    return this.deps.tracker.markKnownCardsInZone(player, "DrawZone", cardNames, { idempotent: false });
  }

  private applyRevealedHand(text: string): boolean {
    const revealedHand = parseRevealedHandLog(text, this.knownCardNames());
    if (!revealedHand) return false;
    const player = this.playerForLogToken(revealedHand.playerToken);
    if (!player) return false;
    return this.deps.tracker.markExactKnownCardsInZone(player, "HandZone", revealedHand.cards);
  }

  private applyReaction(text: string): boolean {
    const reaction = parseReactionLog(text, this.knownCardNames());
    if (!reaction) return false;
    const player = this.playerForLogToken(reaction.playerToken);
    if (!player) return false;
    return this.deps.tracker.markKnownCardsInZone(player, "HandZone", [reaction.card]);
  }
}
