import { canonicalLineupReplay, periodDurations, periodOffsets, eventGlobalMinute } from "./matchMomentum";
import { MatchEvent, MatchSession } from "../types";
import { DashboardPeriod } from "./dashboardAnalytics";
import { compareEventPosition, deriveGlobalMinute, goalkeeperAtPosition, isActiveMatchEvent, replayMatch } from "./matchEngine";

export type CompetitiveContext = "ALL" | "KEY" | "GOLD";
export type PlayingStateContext = "ALL" | "PJ_CDA" | "PJ_RIVAL";
export type ScoreStateContext = "ALL" | "LEADING" | "DRAWING" | "TRAILING";

export interface PlayingStateInterval {
  period: number;
  startMinute: number;
  endMinute: number;
  startOrder: number;
  endOrder: number | null;
  startEventId: string;
  endEventId: string | null;
  startGlobalMinute: number;
  endGlobalMinute: number;
}

export interface ScoreStateInterval {
  state: Exclude<ScoreStateContext, "ALL">;
  startGlobalMinute: number;
  endGlobalMinute: number;
}

export interface CompetitiveMinutes {
  observed: number;
  byPlayer: Record<string, number>;
  byGoalkeeper: Record<string, number>;
}

export interface CompetitiveProjection extends CompetitiveMinutes {
  eventIds: Set<string>;
  intervals: Array<{ start: number; end: number; period: number; lineupPlayerIds: string[]; eventId: string }>;
}

export const GOLD_WINDOW_START_GLOBAL_MINUTE = deriveGlobalMinute(2, 15);

function matchEnd(session: MatchSession): number { return periodDurations(session).reduce((a, b) => a + b, 0); }
function globalMinute(session: MatchSession, period: number, minute: number): number { return eventGlobalMinute({ period, minute }, periodOffsets(periodDurations(session))); }
function periodBounds(session: MatchSession, period: DashboardPeriod, end: number): [number, number] {
  if (period === "ALL") return [0, end];
  const durations = periodDurations(session), start = periodOffsets(durations)[period - 1] ?? 0;
  return [start, start + (durations[period - 1] ?? 0)];
}
function periodEnd(session: MatchSession, period: number): number { return periodDurations(session)[period - 1] ?? 0; }
function isPlayingStateEvent(event: MatchEvent, context: Exclude<PlayingStateContext, "ALL">): boolean {
  return event.type === "game_state_changed"
    && event.state === "FLYING_GOALKEEPER"
    && (context === "PJ_RIVAL" ? event.side === "AGAINST" : event.side !== "AGAINST");
}

/**
 * Los estados P-J son sostenidos y deportivos: se abren/cierran por eventos ON/OFF
 * y nunca por timestamps de captura. Cada periodo es independiente; un ON sin OFF
 * se cierra en el límite deportivo conocido (fin de periodo/partido) o, si sigue
 * en curso, en el minuto actual, sin proyectar tiempo futuro.
 */
export function derivePlayingStateIntervals(
  session: MatchSession,
  period: DashboardPeriod,
  context: Exclude<PlayingStateContext, "ALL">,
): PlayingStateInterval[] {
  const periods = period === "ALL" ? [1, 2] : [period];
  const intervals: PlayingStateInterval[] = [];
  for (const currentPeriod of periods) {
    const endMinute = periodEnd(session, currentPeriod);
    const changes = session.events
      .filter((event) => isActiveMatchEvent(event) && event.period === currentPeriod && isPlayingStateEvent(event, context))
      .sort(compareEventPosition);
    let start: MatchEvent | null = null;
    for (const change of changes) {
      if (change.type !== "game_state_changed") continue;
      if (change.active && !start) start = change;
      if (!change.active && start) {
        if (change.minute > start.minute) {
          intervals.push({
            period: currentPeriod,
            startMinute: start.minute,
            endMinute: change.minute,
            startOrder: start.order,
            endOrder: change.order,
            startEventId: start.id,
            endEventId: change.id,
            startGlobalMinute: globalMinute(session, currentPeriod, start.minute),
            endGlobalMinute: globalMinute(session, currentPeriod, change.minute),
          });
        }
        start = null;
      }
    }
    if (start && endMinute > start.minute) {
      intervals.push({
        period: currentPeriod,
        startMinute: start.minute,
        endMinute,
        startOrder: start.order,
        endOrder: null,
        startEventId: start.id,
        endEventId: null,
        startGlobalMinute: globalMinute(session, currentPeriod, start.minute),
        endGlobalMinute: globalMinute(session, currentPeriod, endMinute),
      });
    }
  }
  return intervals;
}

function playingStateContainsEvent(
  event: MatchEvent,
  intervals: readonly PlayingStateInterval[],
): boolean {
  return intervals.some((interval) => {
    if (event.period !== interval.period || event.minute < interval.startMinute || event.minute > interval.endMinute) return false;
    const afterStart = event.minute > interval.startMinute || event.order >= interval.startOrder;
    const beforeEnd = interval.endEventId === null
      ? event.minute <= interval.endMinute
      : event.minute < interval.endMinute || (event.minute === interval.endMinute && event.order < (interval.endOrder ?? 0));
    return afterStart && beforeEnd;
  });
}

function scoreState(scoreFor: number, scoreAgainst: number): Exclude<ScoreStateContext, "ALL"> {
  return scoreFor > scoreAgainst ? "LEADING" : scoreFor < scoreAgainst ? "TRAILING" : "DRAWING";
}

const scoreStateIntervalCache = new WeakMap<MatchSession, Map<DashboardPeriod, ScoreStateInterval[]>>();

/** Intervalos deportivos derivados solo de los goles y el orden del event log. */
export function deriveScoreStateIntervals(
  session: MatchSession,
  period: DashboardPeriod = "ALL",
): ScoreStateInterval[] {
  const cached = scoreStateIntervalCache.get(session)?.get(period);
  if (cached) return cached;
  const end = matchEnd(session);
  const [scopeStart, scopeEnd] = periodBounds(session, period, end);
  if (scopeEnd <= scopeStart) return [];
  const goals = replayMatch(session.players, session.events).timeline
    .map((entry) => entry.event)
    .filter((event): event is Extract<MatchEvent, { type: "threat_recorded" }> => event.type === "threat_recorded" && event.outcome === "GOL");
  let scoreFor = 0;
  let scoreAgainst = 0;
  let start = scopeStart;
  const intervals: ScoreStateInterval[] = [];
  for (const goal of goals) {
    const at = globalMinute(session, goal.period, goal.minute);
    if (at < scopeStart) {
      if (goal.side === "FOR") scoreFor += 1; else scoreAgainst += 1;
      continue;
    }
    if (at > scopeEnd) break;
    if (at > start) intervals.push({ state: scoreState(scoreFor, scoreAgainst), startGlobalMinute: start, endGlobalMinute: at });
    if (goal.side === "FOR") scoreFor += 1; else scoreAgainst += 1;
    start = at;
  }
  if (scopeEnd > start) intervals.push({ state: scoreState(scoreFor, scoreAgainst), startGlobalMinute: start, endGlobalMinute: scopeEnd });
  const byPeriod = scoreStateIntervalCache.get(session) ?? new Map<DashboardPeriod, ScoreStateInterval[]>();
  byPeriod.set(period, intervals);
  scoreStateIntervalCache.set(session, byPeriod);
  return intervals;
}

function scoreStateMatches(context: ScoreStateContext, scoreFor: number, scoreAgainst: number): boolean {
  return context === "ALL" || scoreState(scoreFor, scoreAgainst) === context;
}

function scoreStateDuration(from: number, to: number, intervals: readonly ScoreStateInterval[], context: ScoreStateContext): number {
  if (context === "ALL") return to - from;
  return intervals.reduce((sum, interval) => interval.state === context
    ? sum + Math.max(0, Math.min(to, interval.endGlobalMinute) - Math.max(from, interval.startGlobalMinute))
    : sum, 0);
}

export function isCompetitiveMoment(context: CompetitiveContext, period: number, minute: number, scoreFor: number, scoreAgainst: number): boolean {
  if (context === "ALL") return true;
  if (Math.abs(scoreFor - scoreAgainst) > 1) return false;
  return context === "KEY" || deriveGlobalMinute(period, minute) >= GOLD_WINDOW_START_GLOBAL_MINUTE;
}

/**
 * Convención de borde: un evento pertenece al marcador inmediatamente anterior
 * a él; si es gol, el marcador nuevo rige desde ese mismo minuto hasta el
 * siguiente evento. Sin segundos deportivos, no se inventa una fracción menor.
 */
export function deriveCompetitiveProjection(session: MatchSession, period: DashboardPeriod, context: CompetitiveContext, goalkeeperIds: readonly string[] = [], playingState: PlayingStateContext = "ALL", scoreContext: ScoreStateContext = "ALL"): CompetitiveProjection {
  const end = matchEnd(session);
  const [scopeStart, scopeEnd] = periodBounds(session, period, end);
  const projection: CompetitiveProjection = { observed: 0, byPlayer: {}, byGoalkeeper: {}, eventIds: new Set<string>(), intervals: [] };
  if (scopeEnd <= scopeStart) return projection;
  const replay = canonicalLineupReplay(session);
  const playingIntervals = playingState === "ALL" ? [] : derivePlayingStateIntervals(session, period, playingState);
  const scoreIntervals = scoreContext === "ALL" ? [] : deriveScoreStateIntervals(session, period);
  let scoreFor = 0;
  let scoreAgainst = 0;
  replay.timeline.forEach((entry, index) => {
    const event = entry.event;
    const goalkeeper = entry.gameContexts.includes("FLYING_GOALKEEPER")
      ? null
      : goalkeeperAtPosition(session.players, session.events, event);
    const goalkeeperMatches = goalkeeperIds.length === 0
      || (goalkeeper?.status === "PLAYER" && goalkeeperIds.includes(goalkeeper.playerId));
    const start = globalMinute(session, event.period, event.minute);
    const playingStateMatches = playingState === "ALL" || playingStateContainsEvent(event, playingIntervals);
    if ((period === "ALL" || event.period === period) && event.minute <= periodEnd(session, event.period) && goalkeeperMatches && playingStateMatches && start >= scopeStart && start <= scopeEnd && isCompetitiveMoment(context, event.period, event.minute, scoreFor, scoreAgainst) && scoreStateMatches(scoreContext, scoreFor, scoreAgainst)) {
      projection.eventIds.add(event.id);
    }
    if (entry.event.type === "threat_recorded" && entry.event.outcome === "GOL") {
      if (entry.event.side === "FOR") scoreFor += 1;
      else scoreAgainst += 1;
    }
    const next = replay.timeline[index + 1];
    const finish = Math.min(end, globalMinute(session, event.period, periodEnd(session, event.period)), next ? globalMinute(session, next.event.period, next.event.minute) : end);
    let from = Math.max(scopeStart, start);
    const to = Math.min(scopeEnd, finish);
    if (context === "GOLD") from = Math.max(from, globalMinute(session, 2, 15));
    if (!goalkeeperMatches || to <= from || (context !== "ALL" && Math.abs(scoreFor - scoreAgainst) > 1) || !scoreStateMatches(scoreContext, scoreFor, scoreAgainst)) return;
    const scoreDuration = scoreStateDuration(from, to, scoreIntervals, scoreContext);
    const pieces = playingState === "ALL" ? [{ start: from, end: to }] : playingIntervals.map(i => ({ start: Math.max(from, i.startGlobalMinute), end: Math.min(to, i.endGlobalMinute) })).filter(i => i.end > i.start);
    const duration = scoreDuration <= 0 ? 0 : pieces.reduce((sum, i) => sum + i.end - i.start, 0);
    if (duration <= 0) return;
    projection.observed += duration;
    for (const piece of pieces) projection.intervals.push({ ...piece, period: event.period, lineupPlayerIds: entry.lineupPlayerIds, eventId: event.id });
    entry.lineupPlayerIds.forEach((id) => { projection.byPlayer[id] = (projection.byPlayer[id] ?? 0) + duration; });
    if (goalkeeper?.status === "PLAYER") projection.byGoalkeeper[goalkeeper.playerId] = (projection.byGoalkeeper[goalkeeper.playerId] ?? 0) + duration;
  });
  return projection;
}

export function deriveCompetitiveMinutes(session: MatchSession, period: DashboardPeriod, context: CompetitiveContext, goalkeeperIds: readonly string[] = [], playingState: PlayingStateContext = "ALL", scoreContext: ScoreStateContext = "ALL"): CompetitiveMinutes {
  const { observed, byPlayer, byGoalkeeper } = deriveCompetitiveProjection(session, period, context, goalkeeperIds, playingState, scoreContext);
  return { observed, byPlayer, byGoalkeeper };
}

export function competitiveEventIds(session: MatchSession, period: DashboardPeriod, context: CompetitiveContext, goalkeeperIds: readonly string[] = [], playingState: PlayingStateContext = "ALL", scoreContext: ScoreStateContext = "ALL"): Set<string> {
  return deriveCompetitiveProjection(session, period, context, goalkeeperIds, playingState, scoreContext).eventIds;
}
