import { DeckKnowledgeTracker, findPlayerKnowledge, KnowledgeSummary, ZoneCountReconciliation, zoneKey } from "../knowledge";
import { CardMoveSummary, NavigatorSnapshot, PlayerSummary, ZoneSummary } from "../messages";
import { currentGameNumber, extensionStorage, isObject } from "./environment";

const INVARIANT_REPORTS_KEY_PREFIX = "dominion-navigator:invariant-reports:v1:";
const INVARIANT_REPORT_SINK_URL = "http://127.0.0.1:9237/invariant-report";
const MAX_INVARIANT_REPORTS = 20;
/** Zones whose observed card count is exact, so the tracker must match it. */
const EXACT_COUNT_ZONE_NAMES = new Set(["DrawZone", "HandZone"]);

export type CountInvariantViolation = {
  kind: "zone-count" | "zone-group-count";
  player: PlayerSummary | undefined;
  zoneKey?: string;
  zoneName?: string;
  zoneNames?: string[];
  trackedCount: number;
  observedCount: number;
};

type StoredInvariantReport = {
  version: 1;
  id: string;
  gameId: string;
  fingerprint: string;
  capturedAt: string;
  href: string;
  gameNumber?: string;
  reason: string;
  activeTurn?: NavigatorSnapshot["activeTurn"];
  event?: CardMoveSummary | NavigatorSnapshot;
  violations: CountInvariantViolation[];
  repairs: ZoneCountReconciliation[];
  beforeSummary: KnowledgeSummary;
  afterSummary: KnowledgeSummary;
  latestSnapshot?: NavigatorSnapshot;
  recentMoves: CardMoveSummary[];
};

export type InvariantReportContext = {
  latestSnapshot: NavigatorSnapshot | undefined;
  recentMoves: CardMoveSummary[];
};

function reportGameId(snapshot: NavigatorSnapshot | undefined): string {
  const gameNumber = currentGameNumber();
  if (gameNumber) return `dominion-game-${gameNumber}`;
  if (snapshot?.gameInstanceId) return snapshot.gameInstanceId;
  return "unknown-game";
}

function reportId(capturedAt: string): string {
  const timestamp = capturedAt.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "");
  return `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function playerIdentityKey(player: PlayerSummary | undefined): string {
  if (!player) return "unknown";
  if (player.index !== undefined) return `index:${player.index}`;
  return `name:${player.name ?? "unknown"}`;
}

export function observedExactCountZonesFromSnapshot(snapshot: NavigatorSnapshot): ZoneSummary[] {
  return snapshot.playerZones.filter((zone) => EXACT_COUNT_ZONE_NAMES.has(zone.zoneName));
}

export function observedExactCountZonesFromMove(move: CardMoveSummary): ZoneSummary[] {
  if (move.phase !== "after") return [];
  const zones = [move.from, move.to].filter(
    (zone): zone is ZoneSummary => Boolean(zone?.owner && EXACT_COUNT_ZONE_NAMES.has(zone.zoneName))
  );
  const byKey = new Map<string, ZoneSummary>();
  for (const zone of zones) byKey.set(zoneKey(zone), zone);
  return [...byKey.values()];
}

/** Compares tracked zone totals with observed exact counts, per zone and summed per player across draw + hand. */
export function countInvariantViolations(summary: KnowledgeSummary, observedZones: ZoneSummary[]): CountInvariantViolation[] {
  const violations: CountInvariantViolation[] = [];
  const groups = new Map<
    string,
    {
      player: PlayerSummary | undefined;
      zoneNames: Set<string>;
      trackedCount: number;
      observedCount: number;
    }
  >();

  for (const observed of observedZones) {
    const player = findPlayerKnowledge(summary, observed.owner);
    const key = zoneKey(observed);
    const trackedCount = player?.zones.find((zone) => zone.zoneKey === key)?.totalCount ?? 0;
    if (trackedCount !== observed.cardCount) {
      violations.push({
        kind: "zone-count",
        player: observed.owner,
        zoneKey: key,
        zoneName: observed.zoneName,
        trackedCount,
        observedCount: observed.cardCount
      });
    }

    const groupKey = playerIdentityKey(observed.owner);
    const group = groups.get(groupKey) ?? {
      player: observed.owner,
      zoneNames: new Set<string>(),
      trackedCount: 0,
      observedCount: 0
    };
    group.zoneNames.add(observed.zoneName);
    group.trackedCount += trackedCount;
    group.observedCount += observed.cardCount;
    groups.set(groupKey, group);
  }

  for (const group of groups.values()) {
    if (!group.zoneNames.has("DrawZone") || !group.zoneNames.has("HandZone")) continue;
    if (group.trackedCount === group.observedCount) continue;
    violations.push({
      kind: "zone-group-count",
      player: group.player,
      zoneNames: [...group.zoneNames].sort((a, b) => a.localeCompare(b)),
      trackedCount: group.trackedCount,
      observedCount: group.observedCount
    });
  }

  return violations;
}

function invariantFingerprint(gameId: string, violations: CountInvariantViolation[]): string {
  const normalized = violations
    .map((violation) => ({
      kind: violation.kind,
      player: playerIdentityKey(violation.player),
      zoneKey: violation.zoneKey ?? "",
      zoneName: violation.zoneName ?? "",
      zoneNames: [...(violation.zoneNames ?? [])].sort((a, b) => a.localeCompare(b)),
      trackedCount: violation.trackedCount,
      observedCount: violation.observedCount
    }))
    .sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.player.localeCompare(b.player) ||
        a.zoneKey.localeCompare(b.zoneKey) ||
        a.zoneName.localeCompare(b.zoneName)
    );
  return hashString(JSON.stringify({ gameId, normalized }));
}

function isStoredInvariantReport(value: unknown): value is StoredInvariantReport {
  return (
    isObject(value) &&
    value.version === 1 &&
    typeof value.id === "string" &&
    typeof value.gameId === "string" &&
    typeof value.fingerprint === "string" &&
    Array.isArray(value.violations)
  );
}

async function mirrorInvariantReportToDevSink(report: StoredInvariantReport): Promise<void> {
  try {
    await fetch(INVARIANT_REPORT_SINK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report)
    });
  } catch {
    // The dev sink only exists while `npm run dev` is running.
  }
}

function appendInvariantReport(report: StoredInvariantReport): void {
  console.warn("Dominion Navigator invariant report", report);
  void mirrorInvariantReportToDevSink(report);

  const storage = extensionStorage();
  if (!storage?.get || !storage.set) return;
  const key = `${INVARIANT_REPORTS_KEY_PREFIX}${report.gameId}:${window.location.href}`;
  storage.get(key, (items) => {
    const stored = items[key];
    const existing = Array.isArray(stored) ? stored.filter(isStoredInvariantReport) : [];
    const next = [...existing, report].slice(-MAX_INVARIANT_REPORTS);
    storage.set?.({ [key]: next });
  });
}

/**
 * Checks observed exact zone counts against the tracker, repairs mismatches,
 * and records one report per distinct violation until the invariant holds again.
 */
export class InvariantReporter {
  private readonly activeFingerprints = new Set<string>();

  constructor(
    private readonly tracker: DeckKnowledgeTracker,
    private readonly context: () => InvariantReportContext
  ) {}

  checkSnapshot(snapshot: NavigatorSnapshot): KnowledgeSummary {
    return this.check("snapshot", observedExactCountZonesFromSnapshot(snapshot), snapshot);
  }

  checkMove(move: CardMoveSummary): KnowledgeSummary {
    return this.check("card-move", observedExactCountZonesFromMove(move), move);
  }

  private check(reason: string, observedZones: ZoneSummary[], event: CardMoveSummary | NavigatorSnapshot): KnowledgeSummary {
    const beforeSummary = this.tracker.summary();
    if (observedZones.length === 0) return beforeSummary;

    const violations = countInvariantViolations(beforeSummary, observedZones);
    if (violations.length === 0) {
      this.activeFingerprints.clear();
      return beforeSummary;
    }

    const repairs = this.tracker.reconcileObservedZoneCounts(observedZones);
    const afterSummary = this.tracker.summary();
    const { latestSnapshot, recentMoves } = this.context();
    const capturedAt = new Date().toISOString();
    const gameNumber = currentGameNumber();
    const gameId = reportGameId(latestSnapshot);
    const fingerprint = invariantFingerprint(gameId, violations);
    if (this.activeFingerprints.has(fingerprint)) return afterSummary;
    this.activeFingerprints.add(fingerprint);

    appendInvariantReport({
      version: 1,
      id: reportId(capturedAt),
      gameId,
      fingerprint,
      capturedAt,
      href: window.location.href,
      ...(gameNumber ? { gameNumber } : {}),
      reason,
      ...(latestSnapshot?.activeTurn ? { activeTurn: latestSnapshot.activeTurn } : {}),
      event,
      violations,
      repairs,
      beforeSummary,
      afterSummary,
      ...(latestSnapshot ? { latestSnapshot } : {}),
      recentMoves
    });
    return afterSummary;
  }
}
