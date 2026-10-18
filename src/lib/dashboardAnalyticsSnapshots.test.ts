import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildDashboardFixture } from "./dashboardFixture";
import {
  buildDashboardV2,
  buildDashboardV2FromSnapshots,
  buildDashboardV2Uncached,
  dashboardAnalyticsSourceFingerprint,
  emptyDashboardScope,
  resetDashboardAnalysisCache,
} from "./dashboardV2";
import {
  AnalyticsSnapshotStorage,
  buildDashboardAnalyticsSnapshot,
  DASHBOARD_ANALYTICS_SCHEMA_VERSION,
  hydrateDashboardAnalyticsSnapshots,
  inspectDashboardAnalyticsSnapshots,
  readDashboardAnalyticsSnapshots,
  updateDashboardAnalyticsSnapshots,
} from "./dashboardAnalyticsSnapshots";
import { MatchEvent } from "../types";

class MemoryStorage implements AnalyticsSnapshotStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function scopeForFixture(matchId?: string) {
  const record = buildDashboardFixture()[0];
  return {
    ...emptyDashboardScope(record.catalog.clubId, record.catalog.teamId, record.catalog.seasonId),
    matchIds: matchId ? [matchId] : [],
    includeArchived: true,
  };
}

function withoutRecords(value: ReturnType<typeof buildDashboardV2Uncached>) {
  const { records, ...rest } = value;
  void records;
  return rest;
}

function persistedShape<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withChangedThreat(record: ReturnType<typeof buildDashboardFixture>[number]) {
  let changed = false;
  const events = record.session.events.map((event): MatchEvent => {
    if (!changed && event.type === "threat_recorded") {
      changed = true;
      return { ...event, outcome: event.outcome === "GOL" ? "FUERA" : "GOL", updatedAt: event.updatedAt + 1 };
    }
    return event;
  });
  assert.equal(changed, true);
  return { ...record, session: { ...record.session, events } };
}

test("snapshot por partido coincide exactamente con analytics canónico", () => {
  const record = buildDashboardFixture()[0];
  const snapshot = buildDashboardAnalyticsSnapshot(record, 1000);
  for (const period of ["ALL", 1, 2] as const) {
    const expected = buildDashboardV2Uncached([record], { ...scopeForFixture(record.catalog.matchId), period });
    assert.deepEqual(snapshot.analyses[String(period) as "ALL" | "1" | "2"], withoutRecords(expected));
  }
  assert.equal(snapshot.schemaVersion, DASHBOARD_ANALYTICS_SCHEMA_VERSION);
});

test("agregación ligera de snapshots coincide con temporada canónica", async () => {
  const records = buildDashboardFixture().slice(0, 6);
  const storage = new MemoryStorage();
  await updateDashboardAnalyticsSnapshots(records, { storage, yieldBetweenMatches: false });
  for (const period of ["ALL", 1, 2] as const) {
    const scope = { ...scopeForFixture(), period };
    const expected = buildDashboardV2Uncached(records, scope);
    resetDashboardAnalysisCache();
    hydrateDashboardAnalyticsSnapshots(records, storage);
    const actual = buildDashboardV2FromSnapshots(records, scope);
    assert.deepEqual(persistedShape(actual), persistedShape(expected));
  }
});

test("regeneración es determinista y no altera la fuente canónica", () => {
  const record = buildDashboardFixture()[0];
  const sourceBefore = JSON.stringify(record);
  const left = buildDashboardAnalyticsSnapshot(record, 1000);
  const right = buildDashboardAnalyticsSnapshot(record, 1000);
  assert.deepEqual(left, right);
  assert.equal(JSON.stringify(record), sourceBefore);
});

test("solo el partido deportivo modificado queda DIRTY", () => {
  const [first, second] = buildDashboardFixture();
  const snapshots = [buildDashboardAnalyticsSnapshot(first), buildDashboardAnalyticsSnapshot(second)];
  const inspections = inspectDashboardAnalyticsSnapshots([withChangedThreat(first), second], snapshots);
  assert.deepEqual(inspections.map((item) => item.state), ["DIRTY", "CURRENT"]);
});

test("metadata de vídeo no invalida analytics", () => {
  const record = buildDashboardFixture()[0];
  const snapshot = buildDashboardAnalyticsSnapshot(record);
  const withVideoOnly = { ...record, session: { ...record.session, videoSegments: [] } };
  assert.equal(dashboardAnalyticsSourceFingerprint(withVideoOnly), snapshot.sourceFingerprint);
  assert.equal(inspectDashboardAnalyticsSnapshots([withVideoOnly], [snapshot])[0].state, "CURRENT");
});

test("snapshot ausente y versión antigua quedan stale sin usarse", () => {
  const [first, second] = buildDashboardFixture();
  const outdated = { ...buildDashboardAnalyticsSnapshot(first), schemaVersion: 0 };
  const inspections = inspectDashboardAnalyticsSnapshots([first, second], [outdated]);
  assert.deepEqual(inspections.map((item) => item.state), ["OUTDATED", "MISSING"]);
});

test("actualización incremental procesa únicamente dirty y full rebuild procesa todos", async () => {
  const storage = new MemoryStorage();
  const [first, second] = buildDashboardFixture();
  await updateDashboardAnalyticsSnapshots([first, second], { storage, now: () => 1000, yieldBetweenMatches: false });
  const dirtyFirst = withChangedThreat(first);
  const incremental: number[] = [];
  await updateDashboardAnalyticsSnapshots([dirtyFirst, second], { storage, now: () => 2000, yieldBetweenMatches: false, onProgress: ({ total }) => incremental.push(total) });
  assert.deepEqual(incremental, [1]);
  const saved = readDashboardAnalyticsSnapshots(storage);
  assert.equal(saved.find((item) => item.matchId === dirtyFirst.catalog.matchId)?.calculatedAt, 2000);
  assert.equal(saved.find((item) => item.matchId === second.catalog.matchId)?.calculatedAt, 1000);
  const rebuilt: number[] = [];
  await updateDashboardAnalyticsSnapshots([dirtyFirst, second], { storage, rebuildAll: true, now: () => 3000, yieldBetweenMatches: false, onProgress: ({ total }) => rebuilt.push(total) });
  assert.deepEqual(rebuilt, [2, 2]);
});

test("stale-while-revalidate conserva snapshot previo y después adopta el nuevo", async () => {
  const storage = new MemoryStorage();
  const original = buildDashboardFixture()[0];
  await updateDashboardAnalyticsSnapshots([original], { storage, now: () => 1000, yieldBetweenMatches: false });
  const changed = withChangedThreat(original);
  resetDashboardAnalysisCache();
  const inspections = hydrateDashboardAnalyticsSnapshots([changed], storage);
  assert.equal(inspections[0].state, "DIRTY");
  const scope = scopeForFixture(changed.catalog.matchId);
  const stale = buildDashboardV2([changed], scope);
  const expectedOld = buildDashboardV2Uncached([original], scope);
  assert.deepEqual(persistedShape(withoutRecords(stale)), persistedShape(withoutRecords(expectedOld)));
  await updateDashboardAnalyticsSnapshots([changed], { storage, now: () => 2000, yieldBetweenMatches: false });
  const refreshed = buildDashboardV2([changed], scope);
  const expectedNew = buildDashboardV2Uncached([changed], scope);
  assert.deepEqual(persistedShape(withoutRecords(refreshed)), persistedShape(withoutRecords(expectedNew)));
});

test("filtros avanzados conservan cálculo canónico y no usan snapshot incompatible", () => {
  const record = buildDashboardFixture()[0];
  resetDashboardAnalysisCache();
  hydrateDashboardAnalyticsSnapshots([record], (() => {
    const storage = new MemoryStorage();
    void storage;
    return storage;
  })());
  const scope = { ...scopeForFixture(record.catalog.matchId), phases: ["TRANSITION" as const], period: 2 as const };
  assert.deepEqual(buildDashboardV2([record], scope), buildDashboardV2Uncached([record], scope));
});

test("snapshots mantienen denominadores finitos y nunca contienen NaN/Infinity", () => {
  const snapshot = buildDashboardAnalyticsSnapshot(buildDashboardFixture()[0]);
  const visit = (value: unknown): void => {
    if (typeof value === "number") assert.equal(Number.isFinite(value), true);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(snapshot);
});

test("DATOS con menos de cuatro referencias no dibuja paréntesis vacíos", () => {
  const source = readFileSync("src/components/dashboard/DashboardDataTables.tsx", "utf8");
  assert.ok(source.includes("if (!rounded) return null"));
  assert.ok(!source.includes(">(—)</span>"));
});
