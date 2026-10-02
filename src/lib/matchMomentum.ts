import { MatchEvent, MatchSession, ThreatPhase, ThreatRecordedEvent } from "../types";
import { DashboardMatchRecord } from "./dashboardAnalytics";
import { deriveThreatOriginZone } from "./dashboardAnalysis";
import { effectiveThreatPhase, REGULATION_MATCH_CLOCK, replayMatch } from "./matchEngine";

export type MomentumDanger = "NORMAL" | "NEAR" | "HIGH" | "GOAL";
export type MomentumDangerFilter = "ALL" | "NEAR" | "HIGH" | "GOAL";
export type MomentumPeriodFilter = "ALL" | 1 | 2;

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
  phase: ThreatPhase;
  playerId?: string;
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
  periodEnds: number[];
  actions: MomentumAction[];
  bins: MomentumBin[];
  sharedIntervals: MomentumInterval[];
  sharedMinutes: number;
  selectedPlayerNames: string[];
}

export const EMPTY_MOMENTUM_FILTERS: MomentumFilters = {
  period: "ALL",
  phases: [],
  danger: "ALL",
  playerIds: [],
};

const DANGERS: MomentumDanger[] = ["NORMAL", "NEAR", "HIGH", "GOAL"];

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

function periodDurations(session: MatchSession): number[] {
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

function periodOffsets(durations: readonly number[]): number[] {
  let cursor = 0;
  return durations.map((duration) => {
    const offset = cursor;
    cursor += duration;
    return offset;
  });
}

function eventGlobalMinute(event: Pick<MatchEvent, "period" | "minute">, offsets: readonly number[]): number {
  return (offsets[event.period - 1] ?? 0) + event.minute;
}

function dangerMatches(danger: MomentumDanger, filter: MomentumDangerFilter): boolean {
  return filter === "ALL" || danger === filter;
}

export function deriveSharedPlayerIntervals(
  session: MatchSession,
  playerIds: readonly string[],
): MomentumInterval[] {
  if (playerIds.length === 0) return [];
  const durations = periodDurations(session);
  const offsets = periodOffsets(durations);
  const end = durations.reduce((sum, value) => sum + value, 0);
  const replay = replayMatch(session.players, session.events, {
    currentClock: { period: session.period, minute: session.minute },
  });
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

function overlapsMinute(intervals: readonly MomentumInterval[], minute: number): boolean {
  return intervals.some((interval) => interval.start < minute + 1 && interval.end > minute);
}

export function buildMatchMomentum(
  record: DashboardMatchRecord,
  filters: MomentumFilters = EMPTY_MOMENTUM_FILTERS,
): MatchMomentum {
  const { session } = record;
  const durations = periodDurations(session);
  const offsets = periodOffsets(durations);
  const sharedIntervals = deriveSharedPlayerIntervals(session, filters.playerIds);
  const actions = session.events.flatMap((event): MomentumAction[] => {
    if (event.deletedAt !== null || event.type !== "threat_recorded") return [];
    if (filters.period !== "ALL" && event.period !== filters.period) return [];
    const phase = effectiveThreatPhase(session.events, event);
    if (filters.phases.length > 0 && !filters.phases.includes(phase)) return [];
    const danger = classifyMomentumDanger(event);
    if (!dangerMatches(danger, filters.danger)) return [];
    return [{
      eventId: event.id,
      period: event.period,
      minute: event.minute,
      globalMinute: eventGlobalMinute(event, offsets),
      side: event.side,
      danger,
      phase,
      playerId: event.playerId,
    }];
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
      highlighted: filters.playerIds.length === 0 || overlapsMinute(sharedIntervals, action.globalMinute),
    };
    bin[action.side][action.danger] += 1;
    bin.eventIds.push(action.eventId);
    if (!bin.phases.includes(action.phase)) bin.phases.push(action.phase);
    binsByKey.set(key, bin);
  }
  const replay = replayMatch(session.players, session.events);
  return {
    matchId: session.matchId,
    opponent: record.catalog.opponent,
    date: record.catalog.date,
    score: replay.score,
    duration: durations.reduce((sum, value) => sum + value, 0),
    periodEnds: durations.reduce<number[]>((result, duration) => [...result, (result.at(-1) ?? 0) + duration], []),
    actions,
    bins: Array.from(binsByKey.values()).sort((a, b) => a.globalMinute - b.globalMinute || a.key.localeCompare(b.key)),
    sharedIntervals,
    sharedMinutes: sharedIntervals.reduce((sum, interval) => sum + interval.end - interval.start, 0),
    selectedPlayerNames: filters.playerIds.map((id) => session.players.find((player) => player.id === id)?.name ?? id),
  };
}

export function momentumBinTotal(bin: MomentumBin, side: "FOR" | "AGAINST"): number {
  return DANGERS.reduce((sum, danger) => sum + bin[side][danger], 0);
}

export function momentumExportHeading(momentum: MatchMomentum, filters: MomentumFilters): string {
  const period = filters.period === "ALL" ? "TODO" : `P${filters.period}`;
  const phase = filters.phases.length === 1 ? filters.phases[0] : filters.phases.length > 1 ? `${filters.phases.length} fases` : "Todas las fases";
  const danger = filters.danger === "ALL" ? "Todas las peligrosidades" : filters.danger === "NEAR" ? "Cercanas" : filters.danger === "HIGH" ? "Alto peligro" : "Goles";
  const players = momentum.selectedPlayerNames.length ? ` · ${momentum.selectedPlayerNames.join(" + ")}` : "";
  return `${momentum.opponent} · ${period} · ${phase} · ${danger}${players}`;
}
