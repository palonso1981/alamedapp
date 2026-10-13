import { MatchEvent, ThreatPhase, ThreatRecordedEvent } from "../types";
import { DashboardMatchRecord } from "./dashboardAnalytics";
import { describeDistribution, DistributionStats, MIN_MATCHES_FOR_HABITUAL_RANGE } from "./distributionStatistics";
import { buildSetPieceFunnel, normalizeDashboardCount, SetPieceFunnelKind, SetPieceFunnelSide, DashboardValueMode } from "./dashboardV2";
import { effectiveThreatPhase, isActiveMatchEvent } from "./matchEngine";

export type DashboardPhaseKey = "POSITIONAL" | "TRANSITION" | "SET_PIECE" | "FLYING_GOALKEEPER" | "PENALTY" | "DOUBLE_PENALTY";
export type DashboardDataSide = "FOR" | "AGAINST";

export const DASHBOARD_DATA_PHASES: ReadonlyArray<{ key: DashboardPhaseKey; label: string; phases: ThreatPhase[] }> = [
  { key: "POSITIONAL", label: "POSICIONAL", phases: ["POSITIONAL"] },
  { key: "TRANSITION", label: "TRANSICIÓN", phases: ["TRANSITION"] },
  { key: "SET_PIECE", label: "ABP", phases: ["SET_PIECE_CORNER", "SET_PIECE_FREE_KICK", "SET_PIECE_KICK_IN"] },
  { key: "FLYING_GOALKEEPER", label: "PORTERO-JUGADOR", phases: ["FLYING_GOALKEEPER"] },
  { key: "PENALTY", label: "PENALTI", phases: ["PENALTY"] },
  { key: "DOUBLE_PENALTY", label: "DOBLE PENALTI", phases: ["DOUBLE_PENALTY"] },
];

export interface HabitualMetric {
  stats: DistributionStats;
  range: [number, number] | null;
}

export interface DashboardPhaseDataRow {
  key: DashboardPhaseKey | "TOTAL";
  label: string;
  count: number | null;
  rawCount: number;
  countPerMatch: number | null;
  countHabitual: HabitualMetric;
  volumePercentage: number | null;
  volumeHabitual: HabitualMetric;
  volumeEquivalent: [number, number] | null;
  goals: number | null;
  rawGoals: number;
  goalPercentage: number | null;
  goalHabitual: HabitualMetric;
  goalEquivalent: [number, number] | null;
  impact: number | null;
  impactHabitual: HabitualMetric;
}

interface PhaseRaw { count: number; goals: number; total: number; totalGoals: number; volume: number | null; goalShare: number | null; impact: number | null; }

function isThreatEvent(event: MatchEvent): event is ThreatRecordedEvent {
  return event.type === "threat_recorded";
}

function phaseRaw(records: readonly DashboardMatchRecord[], definition: typeof DASHBOARD_DATA_PHASES[number], side: DashboardDataSide): PhaseRaw {
  const threats = records.flatMap((record) => {
    const events = [...record.session.events];
    return events.filter((event): event is ThreatRecordedEvent => isThreatEvent(event) && isActiveMatchEvent(event) && event.side === side)
      .map((event) => ({ event, phase: effectiveThreatPhase(events, event) }));
  });
  const classified = threats.filter(({ phase }) => DASHBOARD_DATA_PHASES.some((row) => row.phases.includes(phase)));
  const selected = classified.filter(({ phase }) => definition.phases.includes(phase));
  const goals = selected.filter(({ event }) => event.outcome === "GOL").length;
  const totalGoals = classified.filter(({ event }) => event.outcome === "GOL").length;
  const volume = classified.length ? selected.length / classified.length * 100 : null;
  const goalShare = totalGoals ? goals / totalGoals * 100 : null;
  return { count: selected.length, goals, total: classified.length, totalGoals, volume, goalShare, impact: volume === null || goalShare === null ? null : goalShare - volume };
}

function habitual(values: readonly (number | null)[]): HabitualMetric {
  const stats = describeDistribution(values);
  return { stats, range: stats.n >= MIN_MATCHES_FOR_HABITUAL_RANGE && stats.p25 !== null && stats.p75 !== null ? [stats.p25, stats.p75] : null };
}

function equivalent(total: number, metric: HabitualMetric): [number, number] | null {
  return metric.range ? [total * metric.range[0] / 100, total * metric.range[1] / 100] : null;
}

export function buildDashboardPhaseDataRows(current: readonly DashboardMatchRecord[], referenceByMatch: readonly (readonly DashboardMatchRecord[])[], side: DashboardDataSide, mode: DashboardValueMode, observedMinutes: number): DashboardPhaseDataRow[] {
  const samples = current.length;
  const rows = DASHBOARD_DATA_PHASES.map((definition) => {
    const value = phaseRaw(current, definition, side);
    const reference = referenceByMatch.map((records) => phaseRaw(records, definition, side));
    const countHabitual = habitual(reference.map((item) => item.count));
    const volumeHabitual = habitual(reference.map((item) => item.volume));
    const goalHabitual = habitual(reference.map((item) => item.goalShare));
    const impactHabitual = habitual(reference.map((item) => item.impact));
    return {
      key: definition.key, label: definition.label,
      count: normalizeDashboardCount(value.count, mode, samples, observedMinutes), rawCount: value.count, countPerMatch: samples ? value.count / samples : null, countHabitual,
      volumePercentage: value.volume, volumeHabitual, volumeEquivalent: equivalent(value.total, volumeHabitual),
      goals: normalizeDashboardCount(value.goals, mode, samples, observedMinutes), rawGoals: value.goals,
      goalPercentage: value.goalShare, goalHabitual, goalEquivalent: equivalent(value.totalGoals, goalHabitual),
      impact: value.impact, impactHabitual,
    } satisfies DashboardPhaseDataRow;
  });
  const totals = rows.reduce((value, row) => ({ count: value.count + row.rawCount, goals: value.goals + row.rawGoals }), { count: 0, goals: 0 });
  const totalCountHabitual = habitual(referenceByMatch.map((records) => DASHBOARD_DATA_PHASES.reduce((sum, definition) => sum + phaseRaw(records, definition, side).count, 0)));
  return [...rows, {
    key: "TOTAL", label: "TOTAL", count: normalizeDashboardCount(totals.count, mode, samples, observedMinutes), rawCount: totals.count, countPerMatch: samples ? totals.count / samples : null, countHabitual: totalCountHabitual,
    volumePercentage: totals.count ? 100 : null, volumeHabitual: habitual([]), volumeEquivalent: null,
    goals: normalizeDashboardCount(totals.goals, mode, samples, observedMinutes), rawGoals: totals.goals,
    goalPercentage: totals.goals ? 100 : null, goalHabitual: habitual([]), goalEquivalent: null, impact: null, impactHabitual: habitual([]),
  }];
}

export interface DashboardSetPieceDataRow {
  key: SetPieceFunnelKind;
  label: string;
  current: SetPieceFunnelSide;
  opportunityHabitual: HabitualMetric;
  shotPct: number | null; shotHabitual: HabitualMetric; shotEquivalent: [number, number] | null;
  targetPct: number | null; targetHabitual: HabitualMetric; targetEquivalent: [number, number] | null;
  goalPct: number | null; goalHabitual: HabitualMetric; goalEquivalent: [number, number] | null;
}

export type DashboardSetPieceSortKey = "label" | "opportunities" | "habitual" | "withShot" | "shotPct" | "shotHabitual" | "shotEquivalent" | "withOnTarget" | "targetPct" | "targetHabitual" | "targetEquivalent" | "withGoal" | "goalPct" | "goalHabitual" | "goalEquivalent";
export type DashboardTableSortDirection = "ASC" | "DESC";

function setPieceSortValue(row: DashboardSetPieceDataRow, key: DashboardSetPieceSortKey): string | number {
  if (key === "label") return row.label;
  if (key === "opportunities") return row.current.opportunities;
  if (key === "habitual") return row.opportunityHabitual.stats.median ?? -Infinity;
  if (key === "withShot") return row.current.withShot;
  if (key === "shotPct") return row.shotPct ?? -Infinity;
  if (key === "shotHabitual") return row.shotHabitual.stats.median ?? -Infinity;
  if (key === "shotEquivalent") return row.shotEquivalent ? (row.shotEquivalent[0] + row.shotEquivalent[1]) / 2 : -Infinity;
  if (key === "withOnTarget") return row.current.withOnTarget;
  if (key === "targetPct") return row.targetPct ?? -Infinity;
  if (key === "targetHabitual") return row.targetHabitual.stats.median ?? -Infinity;
  if (key === "targetEquivalent") return row.targetEquivalent ? (row.targetEquivalent[0] + row.targetEquivalent[1]) / 2 : -Infinity;
  if (key === "withGoal") return row.current.withGoal;
  if (key === "goalPct") return row.goalPct ?? -Infinity;
  if (key === "goalHabitual") return row.goalHabitual.stats.median ?? -Infinity;
  return row.goalEquivalent ? (row.goalEquivalent[0] + row.goalEquivalent[1]) / 2 : -Infinity;
}

export function sortDashboardSetPieceRows(rows: readonly DashboardSetPieceDataRow[], key: DashboardSetPieceSortKey, direction: DashboardTableSortDirection): DashboardSetPieceDataRow[] {
  const aggregate = rows.find((row) => row.key === "ALL");
  const detail = rows.filter((row) => row.key !== "ALL");
  const sign = direction === "DESC" ? -1 : 1;
  detail.sort((left, right) => {
    const a = setPieceSortValue(left, key); const b = setPieceSortValue(right, key);
    return (typeof a === "string" ? a.localeCompare(String(b), "es") : Number(a) - Number(b)) * sign;
  });
  return aggregate ? [aggregate, ...detail] : detail;
}

export interface DashboardSituationSortableRow {
  key: string;
  label: string;
  current: number;
  perMatch: number | null;
  habitual: HabitualMetric;
  relevant: readonly unknown[];
}

export type DashboardSituationSortKey = "label" | "current" | "perMatch" | "habitual" | "matches";

export function sortDashboardSituationRows<T extends DashboardSituationSortableRow>(rows: readonly T[], key: DashboardSituationSortKey, direction: DashboardTableSortDirection): T[] {
  const sign = direction === "DESC" ? -1 : 1;
  return [...rows].sort((left, right) => {
    const read = (row: T): string | number => key === "label" ? row.label : key === "current" ? row.current : key === "perMatch" ? row.perMatch ?? -Infinity : key === "habitual" ? row.habitual.stats.median ?? -Infinity : row.relevant.length;
    const a = read(left); const b = read(right);
    return (typeof a === "string" ? a.localeCompare(String(b), "es") : Number(a) - Number(b)) * sign;
  });
}

const ratio = (value: number, total: number) => total ? value / total * 100 : null;
export function buildDashboardSetPieceDataRows(current: readonly DashboardMatchRecord[], referenceByMatch: readonly (readonly DashboardMatchRecord[])[], side: DashboardDataSide): DashboardSetPieceDataRow[] {
  return (["ALL", "CORNER", "KICK_IN"] as const).map((kind) => {
    const value = buildSetPieceFunnel(current, kind)[side];
    const refs = referenceByMatch.map((records) => buildSetPieceFunnel(records, kind)[side]);
    const shotHabitual = habitual(refs.map((item) => ratio(item.withShot, item.opportunities)));
    const targetHabitual = habitual(refs.map((item) => ratio(item.withOnTarget, item.opportunities)));
    const goalHabitual = habitual(refs.map((item) => ratio(item.withGoal, item.opportunities)));
    return {
      key: kind, label: kind === "ALL" ? "TODAS" : kind === "CORNER" ? "CÓRNER" : "BANDA CERCANA", current: value,
      opportunityHabitual: habitual(refs.map((item) => item.opportunities)),
      shotPct: ratio(value.withShot, value.opportunities), shotHabitual, shotEquivalent: equivalent(value.opportunities, shotHabitual),
      targetPct: ratio(value.withOnTarget, value.opportunities), targetHabitual, targetEquivalent: equivalent(value.opportunities, targetHabitual),
      goalPct: ratio(value.withGoal, value.opportunities), goalHabitual, goalEquivalent: equivalent(value.opportunities, goalHabitual),
    };
  });
}
