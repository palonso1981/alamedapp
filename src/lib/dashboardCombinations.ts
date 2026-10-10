import { MatchEvent, Player } from "../types";
import { DashboardMatchRecord } from "./dashboardAnalytics";
import { DashboardScopeV2, filterDashboardMatchSelection, threatMatches } from "./dashboardV2";
import { deriveCompetitiveProjection } from "./dashboardCompetitiveContext";
import { canonicalLineupReplay, periodDurations } from "./matchMomentum";

export type CombinationSize = 2 | 3 | 4 | 5;
export const COMBINATION_SAMPLE = { fraction: .05, minimumMinutes: 8, maximumMinutes: 20, minimumMatches: 2 } as const;
export interface CombinationCounts { gf: number; gc: number; shots: number; threats: number }
export interface CombinationRates { gf: number | null; gc: number | null; shots: number | null; threats: number | null; goals: number | null; danger: number | null }
export interface CombinationMatch { matchId: string; opponent: string; date: string; minutes: number; contextMinutes: number; counts: CombinationCounts; score: CombinationCounts }
export interface CombinationRow {
  key: string; ids: string[]; minutes: number; matches: number; percent: number | null; minutesPerMatch: number | null;
  lowSample: boolean; rates: CombinationRates; rest: CombinationRates; differential: { goals: number | null; danger: number | null };
  byMatch: CombinationMatch[]; quintets: Array<{ ids: string[]; minutes: number; percent: number }>;
  points: { total: number; possible: number; perMatch: number | null; positive: number; draws: number; negative: number };
}
interface ContextMatch { record: DashboardMatchRecord; minutes: number; intervals: Array<{ minutes: number; ids: string[] }>; events: Array<{ event: MatchEvent; ids: string[]; selected: boolean }>; totals: CombinationCounts }
export interface CombinationsContext { matches: ContextMatch[]; players: Player[]; minutes: number; excludedMinutes: number; minimumMinutes: number; counts: CombinationCounts }
const zero = (): CombinationCounts => ({ gf: 0, gc: 0, shots: 0, threats: 0 });
const add = (to: CombinationCounts, from: CombinationCounts) => { for (const key of Object.keys(to) as Array<keyof CombinationCounts>) to[key] += from[key]; };
const count = (event: MatchEvent): CombinationCounts => event.type !== "threat_recorded" ? zero() : { gf: Number(event.side === "FOR" && event.outcome === "GOL"), gc: Number(event.side === "AGAINST" && event.outcome === "GOL"), shots: Number(event.side === "FOR"), threats: Number(event.side === "AGAINST") };
const contains = (lineup: readonly string[], ids: readonly string[]) => ids.every(id => lineup.includes(id)) && (ids.length !== 5 || lineup.length === 5);
export function combinationKey(ids: readonly string[]): string { return JSON.stringify([...ids].sort()); }
export function validateCombination(ids: readonly string[], players: readonly Player[], size?: CombinationSize): string[] {
  if (ids.length < 2 || ids.length > 5 || (size && ids.length !== size) || new Set(ids).size !== ids.length || ids.some(id => !players.some(p => p.id === id))) throw new Error("Selecciona jugadores distintos y válidos del mismo tamaño de combinación.");
  return [...ids].sort();
}
export function combinationMinimumMinutes(minutes: number): number { return Math.min(COMBINATION_SAMPLE.maximumMinutes, Math.max(COMBINATION_SAMPLE.minimumMinutes, minutes * COMBINATION_SAMPLE.fraction)); }
function rates(c: CombinationCounts, minutes: number): CombinationRates {
  const r = (n: number) => minutes > 0 ? n * 40 / minutes : null;
  return { gf: r(c.gf), gc: r(c.gc), shots: r(c.shots), threats: r(c.threats), goals: r(c.gf - c.gc), danger: r(c.shots - c.threats) };
}
/** Filters select the records; exposure and event attribution always replay the unfiltered log. */
export function buildCombinationsContext(records: readonly DashboardMatchRecord[], scope: DashboardScopeV2): CombinationsContext {
  const selected = filterDashboardMatchSelection(records, scope);
  const players = Array.from(new Map(selected.flatMap(r => r.session.players).map(p => [p.id, p])).values());
  let excludedMinutes = 0;
  const matches: ContextMatch[] = selected.map(record => {
    const { session } = record;
    const projection = deriveCompetitiveProjection(session, scope.period, scope.competitiveContext, scope.goalkeeperIds, scope.playingState, scope.scoreState);
    const replay = canonicalLineupReplay(session);
    const known = new Set(session.players.map(p => p.id));
    const valid = new Map<string, string[]>();
    let reliable = false;
    const structuralErrors = new Set(replay.issues.filter(i => ["MISSING_LINEUP", "UNKNOWN_PLAYER", "TOO_MANY_ON_COURT", "DUPLICATE_PLAYER", "PLAYER_NOT_ON_COURT", "PLAYER_NOT_ON_BENCH", "INVALID_POSITION", "DUPLICATE_ORDER", "MATCH_ID_MISMATCH"].includes(i.code)).map(i => i.eventId));
    for (const entry of replay.timeline) {
      if (entry.event.type === "lineup_initialized") reliable = !structuralErrors.has(entry.event.id);
      if ((entry.event.type === "substitution" || entry.event.type === "lineup_initialized") && structuralErrors.has(entry.event.id)) reliable = false;
      const ids = entry.lineupPlayerIds;
      if (reliable && ids.length === 5 && new Set(ids).size === 5 && ids.every(id => known.has(id))) valid.set(entry.event.id, [...ids].sort());
    }
    const intervals = projection.intervals.flatMap(i => {
      const ids = valid.get(i.eventId);
      if (!ids) { excludedMinutes += i.end - i.start; return []; }
      return [{ minutes: i.end - i.start, ids }];
    });
    const durations = periodDurations(session);
    const events = replay.timeline.flatMap(entry => {
      const ids = valid.get(entry.event.id), event = entry.event;
      if (!ids || !projection.eventIds.has(event.id) || event.type !== "threat_recorded" || event.minute < 0 || event.minute > (durations[event.period - 1] ?? 0)) return [];
      return [{ event, ids, selected: threatMatches(event, record, scope) }];
    });
    const totals = zero(); events.filter(e => e.selected).forEach(e => add(totals, count(e.event)));
    return { record, intervals, events, minutes: intervals.reduce((sum, i) => sum + i.minutes, 0), totals };
  });
  const minutes = matches.reduce((sum, m) => sum + m.minutes, 0), counts = zero();
  matches.forEach(m => add(counts, m.totals));
  return { matches, players, minutes, excludedMinutes, minimumMinutes: combinationMinimumMinutes(minutes), counts };
}
export function analyzeCombination(context: CombinationsContext, selected: readonly string[]): CombinationRow {
  const ids = validateCombination(selected, context.players), counts = zero(), quintets = new Map<string, { ids: string[]; minutes: number }>();
  const byMatch: CombinationMatch[] = [];
  for (const match of context.matches) {
    const together = match.intervals.filter(i => contains(i.ids, ids)), minutes = together.reduce((sum, i) => sum + i.minutes, 0);
    if (minutes <= 0) continue;
    const own = zero(), score = zero();
    for (const { event, ids: lineup, selected: included } of match.events) if (contains(lineup, ids)) { if (included) add(own, count(event)); add(score, count(event)); }
    add(counts, own);
    for (const interval of together) { const key = combinationKey(interval.ids), current = quintets.get(key) ?? { ids: interval.ids, minutes: 0 }; current.minutes += interval.minutes; quintets.set(key, current); }
    byMatch.push({ matchId: match.record.catalog.matchId, opponent: match.record.catalog.opponent, date: match.record.catalog.date, minutes, contextMinutes: match.minutes, counts: own, score });
  }
  byMatch.sort((a, b) => a.date.localeCompare(b.date) || a.matchId.localeCompare(b.matchId));
  const minutes = byMatch.reduce((sum, m) => sum + m.minutes, 0), restCounts = zero();
  for (const key of Object.keys(restCounts) as Array<keyof CombinationCounts>) restCounts[key] = context.counts[key] - counts[key];
  const ownRates = rates(counts, minutes), rest = rates(restCounts, Math.max(0, context.minutes - minutes));
  const positive = byMatch.filter(m => m.score.gf > m.score.gc).length, negative = byMatch.filter(m => m.score.gf < m.score.gc).length, draws = byMatch.length - positive - negative, total = positive * 3 + draws;
  return { key: combinationKey(ids), ids, minutes, matches: byMatch.length, percent: context.minutes ? minutes / context.minutes * 100 : null, minutesPerMatch: byMatch.length ? minutes / byMatch.length : null,
    lowSample: minutes <= context.minimumMinutes || (context.matches.length > 1 && byMatch.length < COMBINATION_SAMPLE.minimumMatches), rates: ownRates, rest,
    differential: { goals: ownRates.goals === null || rest.goals === null ? null : ownRates.goals - rest.goals, danger: ownRates.danger === null || rest.danger === null ? null : ownRates.danger - rest.danger }, byMatch,
    quintets: ids.length === 5 ? [] : Array.from(quintets.values()).sort((a, b) => b.minutes - a.minutes).map(q => ({ ...q, percent: minutes ? q.minutes / minutes * 100 : 0 })),
    points: { total, possible: byMatch.length * 3, perMatch: byMatch.length ? total / byMatch.length : null, positive, draws, negative } };
}
function subsets(ids: readonly string[], size: number): string[][] {
  if (size === 0) return [[]];
  return ids.flatMap((id, index) => subsets(ids.slice(index + 1), size - 1).map(rest => [id, ...rest]));
}
export function rankCombinations(context: CombinationsContext, size: CombinationSize): CombinationRow[] {
  const observed = new Map<string, string[]>();
  for (const match of context.matches) for (const interval of match.intervals) for (const ids of subsets(interval.ids, size)) observed.set(combinationKey(ids), ids);
  return Array.from(observed.values()).map(ids => analyzeCombination(context, ids)).sort((a, b) => b.minutes - a.minutes || a.key.localeCompare(b.key));
}
export function compareCombinations(context: CombinationsContext, a: readonly string[], b: readonly string[]) {
  validateCombination(b, context.players, a.length as CombinationSize);
  return { a: analyzeCombination(context, a), b: analyzeCombination(context, b) };
}
