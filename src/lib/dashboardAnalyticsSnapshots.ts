import { DashboardMatchRecord, DashboardPeriod } from "./dashboardAnalytics";
import {
  buildDashboardV2Uncached,
  DashboardScopeV2,
  dashboardAnalyticsSourceFingerprint,
  emptyDashboardScope,
  primeDashboardMatchSnapshot,
  DashboardSnapshotPlayerContext,
} from "./dashboardV2";
import { isActiveMatchEvent } from "./matchEngine";

export const DASHBOARD_ANALYTICS_SCHEMA_VERSION = 1;
export const DASHBOARD_ANALYTICS_STORAGE_KEY = "alamedapp:dashboard:analytics-snapshots:v1";

type DashboardAnalysis = ReturnType<typeof buildDashboardV2Uncached>;
type StoredDashboardAnalysis = Omit<DashboardAnalysis, "records">;
type SnapshotPeriodKey = "ALL" | "1" | "2";

export interface DashboardAnalyticsSnapshot {
  schemaVersion: number;
  matchId: string;
  clubId: string;
  teamId: string;
  seasonId: string;
  sourceFingerprint: string;
  calculatedAt: number;
  analyses: Record<SnapshotPeriodKey, StoredDashboardAnalysis>;
  playerContexts: Record<SnapshotPeriodKey, DashboardSnapshotPlayerContext[]>;
}

export interface AnalyticsSnapshotStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type DashboardSnapshotState = "CURRENT" | "DIRTY" | "MISSING" | "OUTDATED" | "CORRUPT";

export interface DashboardSnapshotInspection {
  matchId: string;
  state: DashboardSnapshotState;
  snapshot?: DashboardAnalyticsSnapshot;
}

export interface DashboardSnapshotProgress {
  completed: number;
  total: number;
  matchId: string;
}

function browserStorage(): AnalyticsSnapshotStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function isStoredAnalysis(value: unknown): value is StoredDashboardAnalysis {
  return Boolean(value && typeof value === "object" && "analytics" in value && "rates" in value && "players" in value);
}

function isSnapshot(value: unknown): value is DashboardAnalyticsSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DashboardAnalyticsSnapshot>;
  return typeof candidate.schemaVersion === "number"
    && typeof candidate.matchId === "string"
    && typeof candidate.clubId === "string"
    && typeof candidate.teamId === "string"
    && typeof candidate.seasonId === "string"
    && typeof candidate.sourceFingerprint === "string"
    && typeof candidate.calculatedAt === "number"
    && Boolean(candidate.analyses)
    && Boolean(candidate.playerContexts)
    && isStoredAnalysis(candidate.analyses?.ALL)
    && isStoredAnalysis(candidate.analyses?.["1"])
    && isStoredAnalysis(candidate.analyses?.["2"]);
}

export function readDashboardAnalyticsSnapshots(
  storage: AnalyticsSnapshotStorage | null = browserStorage(),
): DashboardAnalyticsSnapshot[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(DASHBOARD_ANALYTICS_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isSnapshot) : [];
  } catch {
    return [];
  }
}

function writeDashboardAnalyticsSnapshots(
  snapshots: readonly DashboardAnalyticsSnapshot[],
  storage: AnalyticsSnapshotStorage | null = browserStorage(),
): void {
  if (!storage) return;
  storage.setItem(DASHBOARD_ANALYTICS_STORAGE_KEY, JSON.stringify(snapshots));
}

function periodKey(period: DashboardPeriod): SnapshotPeriodKey {
  return String(period) as SnapshotPeriodKey;
}

function scopeFor(record: DashboardMatchRecord, period: DashboardPeriod): DashboardScopeV2 {
  const preparation = record.session.preparation;
  return {
    ...emptyDashboardScope(
      preparation?.clubId ?? record.catalog.clubId ?? "",
      preparation?.teamId ?? record.catalog.teamId ?? "",
      preparation?.seasonId ?? record.catalog.seasonId ?? "",
    ),
    matchIds: [record.catalog.matchId],
    period,
    includeArchived: true,
  };
}

function restoreAnalysis(
  stored: StoredDashboardAnalysis,
  record: DashboardMatchRecord,
): DashboardAnalysis {
  return { ...stored, records: [record] };
}

export function inspectDashboardAnalyticsSnapshots(
  records: readonly DashboardMatchRecord[],
  snapshots: readonly DashboardAnalyticsSnapshot[] = readDashboardAnalyticsSnapshots(),
): DashboardSnapshotInspection[] {
  const byMatch = new Map(snapshots.map((snapshot) => [snapshot.matchId, snapshot]));
  return records.map((record) => {
    const snapshot = byMatch.get(record.catalog.matchId);
    if (!snapshot) return { matchId: record.catalog.matchId, state: "MISSING" };
    if (!isSnapshot(snapshot)) return { matchId: record.catalog.matchId, state: "CORRUPT" };
    if (snapshot.schemaVersion !== DASHBOARD_ANALYTICS_SCHEMA_VERSION) {
      return { matchId: record.catalog.matchId, state: "OUTDATED", snapshot };
    }
    const currentFingerprint = dashboardAnalyticsSourceFingerprint(record);
    return {
      matchId: record.catalog.matchId,
      state: snapshot.sourceFingerprint === currentFingerprint ? "CURRENT" : "DIRTY",
      snapshot,
    };
  });
}

/**
 * Registers persisted snapshots synchronously before the Dashboard starts its
 * derived work. DIRTY snapshots are deliberately registered too: that is the
 * stale-while-revalidate contract. OUTDATED/corrupt snapshots are never used.
 */
export function hydrateDashboardAnalyticsSnapshots(
  records: readonly DashboardMatchRecord[],
  storage: AnalyticsSnapshotStorage | null = browserStorage(),
): DashboardSnapshotInspection[] {
  const inspections = inspectDashboardAnalyticsSnapshots(records, readDashboardAnalyticsSnapshots(storage));
  const byRecord = new Map(records.map((record) => [record.catalog.matchId, record]));
  for (const inspection of inspections) {
    if (!inspection.snapshot || (inspection.state !== "CURRENT" && inspection.state !== "DIRTY")) continue;
    const record = byRecord.get(inspection.matchId);
    if (!record) continue;
    for (const period of ["ALL", 1, 2] as const) {
      primeDashboardMatchSnapshot(
        record,
        period,
        inspection.snapshot.sourceFingerprint,
        restoreAnalysis(inspection.snapshot.analyses[periodKey(period)], record),
        inspection.snapshot.playerContexts[periodKey(period)] ?? [],
      );
    }
  }
  return inspections;
}

export function buildDashboardAnalyticsSnapshot(
  record: DashboardMatchRecord,
  now = Date.now(),
): DashboardAnalyticsSnapshot {
  const analyses = Object.fromEntries((["ALL", 1, 2] as const).map((period) => {
    const analysis = buildDashboardV2Uncached([record], scopeFor(record, period));
    const { records, ...stored } = analysis;
    void records;
    return [periodKey(period), stored];
  })) as Record<SnapshotPeriodKey, StoredDashboardAnalysis>;
  const preparation = record.session.preparation;
  const playerContexts = Object.fromEntries((["ALL", 1, 2] as const).map((period) => {
    const key = periodKey(period);
    const activeEvents = record.session.events.filter((event) => isActiveMatchEvent(event) && (period === "ALL" || event.period === period));
    const squad = new Set(activeEvents.filter((event) => event.type === "lineup_initialized").flatMap((event) => event.type === "lineup_initialized" ? event.squadPlayerIds : []));
    const observedMinutes = analyses[key].rates.observedMinutes;
    return [key, record.session.players.map((player): DashboardSnapshotPlayerContext => ({
      playerId: player.id,
      availableMinutes: squad.has(player.id) ? observedMinutes : 0,
      targetMinutes: preparation?.targetMinutes[player.id],
      trend: {
        matchId: record.catalog.matchId,
        opponent: record.catalog.opponent,
        date: record.catalog.date,
        minutes: 0,
        goals: 0,
        assists: 0,
        threats: 0,
        goalsForOnCourt: 0,
        goalsAgainstOnCourt: 0,
        pointsOnCourt: 0,
        keyMinutes: 0,
        goldMinutes: 0,
      },
    }))];
  })) as Record<SnapshotPeriodKey, DashboardSnapshotPlayerContext[]>;
  return {
    schemaVersion: DASHBOARD_ANALYTICS_SCHEMA_VERSION,
    matchId: record.catalog.matchId,
    clubId: preparation?.clubId ?? record.catalog.clubId ?? "",
    teamId: preparation?.teamId ?? record.catalog.teamId ?? "",
    seasonId: preparation?.seasonId ?? record.catalog.seasonId ?? "",
    sourceFingerprint: dashboardAnalyticsSourceFingerprint(record),
    calculatedAt: now,
    analyses,
    playerContexts,
  };
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

export async function updateDashboardAnalyticsSnapshots(
  records: readonly DashboardMatchRecord[],
  options: {
    rebuildAll?: boolean;
    storage?: AnalyticsSnapshotStorage | null;
    onProgress?: (progress: DashboardSnapshotProgress) => void;
    now?: () => number;
    yieldBetweenMatches?: boolean;
  } = {},
): Promise<DashboardAnalyticsSnapshot[]> {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const existing = readDashboardAnalyticsSnapshots(storage);
  const inspections = inspectDashboardAnalyticsSnapshots(records, existing);
  const candidates = options.rebuildAll
    ? records
    : records.filter((record) => inspections.find((inspection) => inspection.matchId === record.catalog.matchId)?.state !== "CURRENT");
  const byMatch = new Map(existing.map((snapshot) => [snapshot.matchId, snapshot]));
  let completed = 0;
  for (const record of candidates) {
    const snapshot = buildDashboardAnalyticsSnapshot(record, (options.now ?? Date.now)());
    byMatch.set(record.catalog.matchId, snapshot);
    writeDashboardAnalyticsSnapshots(Array.from(byMatch.values()), storage);
    for (const period of ["ALL", 1, 2] as const) {
      primeDashboardMatchSnapshot(record, period, snapshot.sourceFingerprint, restoreAnalysis(snapshot.analyses[periodKey(period)], record), snapshot.playerContexts[periodKey(period)]);
    }
    completed += 1;
    options.onProgress?.({ completed, total: candidates.length, matchId: record.catalog.matchId });
    if (options.yieldBetweenMatches !== false && completed < candidates.length) await yieldToBrowser();
  }
  return Array.from(byMatch.values());
}
