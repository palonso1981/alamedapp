import { MatchEvent, MatchSession, ThreatOutcome, ThreatPhase, ThreatRecordedEvent } from "../types";
import { DashboardMatchRecord } from "./dashboardAnalytics";
import { deriveThreatOriginZone } from "./dashboardAnalysis";
import { effectiveThreatPhase, isActiveMatchEvent, REGULATION_MATCH_CLOCK, replayMatch, sortEvents } from "./matchEngine";

export type MomentumDanger = "NORMAL" | "NEAR" | "HIGH" | "GOAL";
export type MomentumDangerFilter = "ALL" | "NEAR" | "HIGH" | "GOAL";
export type MomentumPeriodFilter = "ALL" | 1 | 2;
export type MomentumViewMode = "MATCH" | "PERIOD_COMPARE" | "COMPARISON";

export interface MomentumFilters {
  period: MomentumPeriodFilter;
  phases: ThreatPhase[];
  danger: MomentumDangerFilter;
  playerIds: string[];
}

export interface MomentumAction {
  eventId: string;
  period: number;
  minute: number;
  globalMinute: number;
  side: "FOR" | "AGAINST";
  danger: MomentumDanger;
  outcome: ThreatOutcome;
  phase: ThreatPhase;
  playerId?: string;
  lineupPlayerIds: string[];
  highlighted: boolean;
}

export interface MomentumBin {
  key: string;
  period: number;
  minute: number;
  globalMinute: number;
  FOR: Record<MomentumDanger, number>;
  AGAINST: Record<MomentumDanger, number>;
  eventIds: string[];
  phases: ThreatPhase[];
  highlighted: boolean;
  actions: MomentumAction[];
}

export interface MomentumInterval {
  start: number;
  end: number;
}

export interface MatchMomentum {
  matchId: string;
  opponent: string;
  date: string;
  score: { for: number; against: number };
  duration: number;
  displayStart: number;
  displayDuration: number;
  scaleMax: number;
  periodEnds: number[];
  actions: MomentumAction[];
  bins: MomentumBin[];
  sharedIntervals: MomentumInterval[];
  sharedMinutes: number;
  selectedPlayerNames: string[];
}

export interface MomentumTrendPoint {
  minute: number;
  FOR: number;
  AGAINST: number;
}

export interface MomentumTrendSeries {
  points: MomentumTrendPoint[];
  window: 3;
  smoothing: "CENTERED" | "TRAILING";
}

export const EMPTY_MOMENTUM_FILTERS: MomentumFilters = {
  period: "ALL",
  phases: [],
  danger: "ALL",
  playerIds: [],
};

const DANGERS: MomentumDanger[] = ["NORMAL", "NEAR", "HIGH", "GOAL"];

export const MOMENTUM_OUTCOME_COLORS: Record<ThreatOutcome, string> = {
  FUERA: "#f59e0b",
  PARADA: "#22c55e",
  GOL: "#ef4444",
  BLOQUEADO: "#94a3b8",
};

export const MOMENTUM_COLOR_INTENSITY: Record<MomentumDanger, number> = {
  NORMAL: 1,
  NEAR: 2,
  HIGH: 3,
  GOAL: 4,
};

function emptyDangerCounts(): Record<MomentumDanger, number> {
  return { NORMAL: 0, NEAR: 0, HIGH: 0, GOAL: 0 };
}

function validOrigin(event: ThreatRecordedEvent): boolean {
  return Number.isFinite(event.origin.x)
    && Number.isFinite(event.origin.y)
    && event.origin.x >= 0
    && event.origin.x <= 1
    && event.origin.y >= 0
    && event.origin.y <= 1;
}

/**
 * Clasificación exclusiva y derivada. El gol tiene prioridad; después,
 * cercana + a portería; después cercana; el resto permanece NORMAL.
 */
export function classifyMomentumDanger(event: ThreatRecordedEvent): MomentumDanger {
  if (event.outcome === "GOL") return "GOAL";
  if (!validOrigin(event)) return "NORMAL";
  const near = ["Z1", "Z2", "Z3"].includes(deriveThreatOriginZone(event.origin, event.side));
  if (near && event.outcome === "PARADA") return "HIGH";
  return near ? "NEAR" : "NORMAL";
}

export function periodDurations(session: MatchSession): number[] {
  const configured = REGULATION_MATCH_CLOCK.periodDurationMinutes;
  return Array.from({ length: REGULATION_MATCH_CLOCK.regulationPeriods }, (_, index) => {
    const period = index + 1;
    const recorded = session.periodMinutes?.[period];
    const closed = session.matchFinished || session.closedPeriods?.includes(period) || session.period > period;
    if (closed) return Math.max(0, recorded ?? configured);
    if (session.period === period) return Math.max(0, recorded ?? session.minute);
    return Math.max(0, recorded ?? 0);
  });
}

export function periodOffsets(durations: readonly number[]): number[] {
  let cursor = 0;
  return durations.map((duration) => {
    const offset = cursor;
    cursor += duration;
    return offset;
  });
}

export function eventGlobalMinute(event: Pick<MatchEvent, "period" | "minute">, offsets: readonly number[]): number {
  return (offsets[event.period - 1] ?? 0) + event.minute;
}

export function momentumDangerMatches(danger: MomentumDanger, filter: MomentumDangerFilter): boolean {
  if (filter === "ALL") return true;
  return MOMENTUM_COLOR_INTENSITY[danger] >= MOMENTUM_COLOR_INTENSITY[filter];
}

/** Single canonical replay used by Momentum and derived lineup analytics. */
export function canonicalLineupReplay(session: MatchSession) {
  return replayMatch(session.players, session.events, { currentClock: { period: session.period, minute: session.minute } });
}

export function deriveSharedPlayerIntervals(
  session: MatchSession,
  playerIds: readonly string[],
): MomentumInterval[] {
  if (playerIds.length === 0) return [];
  const durations = periodDurations(session);
  const offsets = periodOffsets(durations);
  const end = durations.reduce((sum, value) => sum + value, 0);
  const replay = canonicalLineupReplay(session);
  const states = new Map<number, string[]>();
  for (const entry of replay.timeline) {
    states.set(eventGlobalMinute(entry.event, offsets), entry.lineupPlayerIds);
  }
  const boundaries = Array.from(states.entries()).sort((a, b) => a[0] - b[0]);
  const result: MomentumInterval[] = [];
  for (let index = 0; index < boundaries.length; index += 1) {
    const [start, lineup] = boundaries[index];
    const finish = Math.min(end, boundaries[index + 1]?.[0] ?? end);
    if (finish <= start || !playerIds.every((id) => lineup.includes(id))) continue;
    const previous = result[result.length - 1];
    if (previous?.end === start) previous.end = finish;
    else result.push({ start, end: finish });
  }
  return result;
}

function eventFitsRecordedPeriod(
  event: Pick<MatchEvent, "period" | "minute">,
  durations: readonly number[],
): boolean {
  const duration = durations[event.period - 1];
  return duration !== undefined && event.minute >= 0 && event.minute <= duration;
}

export function buildMatchMomentum(
  record: DashboardMatchRecord,
  filters: MomentumFilters = EMPTY_MOMENTUM_FILTERS,
): MatchMomentum {
  const { session } = record;
  const durations = periodDurations(session);
  const offsets = periodOffsets(durations);
  const sharedIntervals = deriveSharedPlayerIntervals(session, filters.playerIds);
  const replay = canonicalLineupReplay(session);
  const lineupByEventId = new Map(
    replay.timeline.map((entry) => [entry.event.id, entry.lineupPlayerIds]),
  );
  const allActions = sortEvents(session.events).flatMap((event): MomentumAction[] => {
    if (!isActiveMatchEvent(event) || event.type !== "threat_recorded") return [];
    const phase = effectiveThreatPhase(session.events, event);
    const danger = classifyMomentumDanger(event);
    const lineupPlayerIds = eventFitsRecordedPeriod(event, durations)
      ? lineupByEventId.get(event.id) ?? []
      : [];
    return [{
      eventId: event.id,
      period: event.period,
      minute: event.minute,
      globalMinute: eventGlobalMinute(event, offsets),
      side: event.side,
      danger,
      outcome: event.outcome,
      phase,
      playerId: event.playerId,
      lineupPlayerIds: [...lineupPlayerIds],
      highlighted: filters.playerIds.length === 0
        || filters.playerIds.every((id) => lineupPlayerIds.includes(id)),
    }];
  });
  const scaleByMinute = new Map<string, { FOR: number; AGAINST: number }>();
  for (const action of allActions) {
    const key = `${action.period}:${action.minute}`;
    const counts = scaleByMinute.get(key) ?? { FOR: 0, AGAINST: 0 };
    counts[action.side] += 1;
    scaleByMinute.set(key, counts);
  }
  const scaleMax = Math.max(1, ...Array.from(scaleByMinute.values()).flatMap((counts) => [counts.FOR, counts.AGAINST]));
  const actions = allActions.filter((action) => {
    if (filters.period !== "ALL" && action.period !== filters.period) return false;
    if (filters.phases.length > 0 && !filters.phases.includes(action.phase)) return false;
    return momentumDangerMatches(action.danger, filters.danger);
  });
  const binsByKey = new Map<string, MomentumBin>();
  for (const action of actions) {
    const key = `${action.period}:${action.minute}`;
    const bin = binsByKey.get(key) ?? {
      key,
      period: action.period,
      minute: action.minute,
      globalMinute: action.globalMinute,
      FOR: emptyDangerCounts(),
      AGAINST: emptyDangerCounts(),
      eventIds: [],
      phases: [],
      highlighted: filters.playerIds.length === 0,
      actions: [],
    };
    bin[action.side][action.danger] += 1;
    bin.eventIds.push(action.eventId);
    bin.actions.push(action);
    if (!bin.phases.includes(action.phase)) bin.phases.push(action.phase);
    if (action.highlighted) bin.highlighted = true;
    binsByKey.set(key, bin);
  }
  const displayPeriod = filters.period === "ALL" ? null : filters.period;
  const displayStart = displayPeriod === null ? 0 : offsets[displayPeriod - 1] ?? 0;
  const displayDuration = displayPeriod === null ? durations.reduce((sum, value) => sum + value, 0) : durations[displayPeriod - 1] ?? 0;
  return {
    matchId: session.matchId,
    opponent: record.catalog.opponent,
    date: record.catalog.date,
    score: replay.score,
    duration: durations.reduce((sum, value) => sum + value, 0),
    displayStart,
    displayDuration,
    scaleMax,
    periodEnds: durations.reduce<number[]>((result, duration) => [...result, (result.at(-1) ?? 0) + duration], []),
    actions,
    bins: Array.from(binsByKey.values()).sort((a, b) => a.globalMinute - b.globalMinute || a.key.localeCompare(b.key)),
    sharedIntervals,
    sharedMinutes: sharedIntervals.reduce((sum, interval) => sum + interval.end - interval.start, 0),
    selectedPlayerNames: filters.playerIds.map((id) => session.players.find((player) => player.id === id)?.name ?? id),
  };
}

function rawMomentumSeries(
  record: DashboardMatchRecord,
  filters: MomentumFilters,
  axis: "MATCH" | 1 | 2,
): { duration: number; points: MomentumTrendPoint[] } {
  const effectiveFilters = { ...filters, period: axis === "MATCH" ? filters.period : axis };
  const momentum = buildMatchMomentum(record, effectiveFilters);
  const duration = axis === "MATCH"
    ? momentum.displayDuration
    : periodDurations(record.session)[axis - 1] ?? 0;
  const totals = new Map<number, { FOR: number; AGAINST: number }>();
  for (const bin of momentum.bins) {
    const minute = axis === "MATCH" ? bin.globalMinute - momentum.displayStart : bin.minute;
    if (minute < 0 || minute > duration) continue;
    totals.set(minute, {
      FOR: momentumBinTotal(bin, "FOR"),
      AGAINST: momentumBinTotal(bin, "AGAINST"),
    });
  }
  return {
    duration,
    points: Array.from({ length: Math.max(0, Math.floor(duration)) + 1 }, (_, minute) => ({
      minute,
      FOR: totals.get(minute)?.FOR ?? 0,
      AGAINST: totals.get(minute)?.AGAINST ?? 0,
    })),
  };
}

export function movingAverageMomentum(
  points: readonly MomentumTrendPoint[],
  smoothing: "CENTERED" | "TRAILING",
): MomentumTrendPoint[] {
  return points.map((point, index) => {
    const from = smoothing === "TRAILING" ? Math.max(0, index - 2) : Math.max(0, index - 1);
    const to = smoothing === "TRAILING" ? index : Math.min(points.length - 1, index + 1);
    const window = points.slice(from, to + 1);
    return {
      minute: point.minute,
      FOR: window.reduce((sum, item) => sum + item.FOR, 0) / window.length,
      AGAINST: window.reduce((sum, item) => sum + item.AGAINST, 0) / window.length,
    };
  });
}

/**
 * Serie comparable por minuto relativo. Cada partido aporta primero su propia
 * serie; después se promedia por posición temporal y, por último, se aplica una
 * ventana de tres minutos. En partidos cerrados la ventana es centrada. Si hay
 * un partido en curso se usa una ventana trailing para no introducir futuro.
 */
export function buildMomentumTrendSeries(
  records: readonly DashboardMatchRecord[],
  filters: MomentumFilters,
  axis: "MATCH" | 1 | 2 = "MATCH",
): MomentumTrendSeries {
  const series = records.map((record) => rawMomentumSeries(record, filters, axis));
  const duration = Math.max(0, ...series.map((item) => item.duration));
  const averaged = Array.from({ length: Math.floor(duration) + 1 }, (_, minute): MomentumTrendPoint => {
    const available = series.filter((item) => minute <= item.duration);
    return {
      minute,
      FOR: available.length ? available.reduce((sum, item) => sum + (item.points[minute]?.FOR ?? 0), 0) / available.length : 0,
      AGAINST: available.length ? available.reduce((sum, item) => sum + (item.points[minute]?.AGAINST ?? 0), 0) / available.length : 0,
    };
  });
  const smoothing = records.some((record) => !record.session.matchFinished && record.catalog.status !== "FINISHED")
    ? "TRAILING"
    : "CENTERED";
  return { points: movingAverageMomentum(averaged, smoothing), window: 3, smoothing };
}

export function momentumBinTotal(bin: MomentumBin, side: "FOR" | "AGAINST"): number {
  return DANGERS.reduce((sum, danger) => sum + bin[side][danger], 0);
}

export function momentumActionOpacity(action: Pick<MomentumAction, "highlighted">): number {
  return action.highlighted ? 1 : .2;
}

export function momentumBinOpacity(bin: Pick<MomentumBin, "highlighted">): number {
  return bin.highlighted ? 1 : .2;
}

export function momentumExportHeading(momentum: MatchMomentum, filters: MomentumFilters): string {
  const period = filters.period === "ALL" ? "TODO" : `P${filters.period}`;
  const phase = filters.phases.length === 1 ? filters.phases[0] : filters.phases.length > 1 ? `${filters.phases.length} fases` : "Todas las fases";
  const danger = filters.danger === "ALL" ? "Todas las peligrosidades" : filters.danger === "NEAR" ? "Cercanas" : filters.danger === "HIGH" ? "Cerc a puerta" : "Gol";
  const players = momentum.selectedPlayerNames.length ? ` · ${momentum.selectedPlayerNames.join(" + ")}` : "";
  return `${momentum.opponent} · ${period} · ${phase} · ${danger}${players}`;
}
