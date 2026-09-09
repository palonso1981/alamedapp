import { MatchEvent, MatchSession } from "../types";
import { DashboardPeriod } from "./dashboardAnalytics";
import { compareEventPosition, deriveGlobalMinute, goalkeeperAtPosition, REGULATION_MATCH_CLOCK, replayMatch } from "./matchEngine";

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
}

export const GOLD_WINDOW_START_GLOBAL_MINUTE = deriveGlobalMinute(2, 15);

function matchEnd(session: MatchSession): number {
  return session.matchFinished
    ? REGULATION_MATCH_CLOCK.regulationPeriods * REGULATION_MATCH_CLOCK.periodDurationMinutes
    : deriveGlobalMinute(session.period, session.minute);
}

function periodBounds(period: DashboardPeriod, end: number): [number, number] {
  const duration = REGULATION_MATCH_CLOCK.periodDurationMinutes;
  if (period === 1) return [0, Math.min(duration, end)];
  if (period === 2) return [duration, Math.min(duration * 2, end)];
  return [0, end];
}

function periodEnd(session: MatchSession, period: number): number {
  if (session.matchFinished || session.closedPeriods?.includes(period) || session.period > period) {
    return REGULATION_MATCH_CLOCK.periodDurationMinutes;
  }
  return session.period === period ? session.minute : 0;
}

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
      .filter((event) => event.deletedAt === null && event.period === currentPeriod && isPlayingStateEvent(event, context))
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
            startGlobalMinute: deriveGlobalMinute(currentPeriod, start.minute),
            endGlobalMinute: deriveGlobalMinute(currentPeriod, change.minute),
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
        startGlobalMinute: deriveGlobalMinute(currentPeriod, start.minute),
        endGlobalMinute: deriveGlobalMinute(currentPeriod, endMinute),
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

function intervalDuration(
  from: number,
  to: number,
  intervals: readonly PlayingStateInterval[],
): number {
  return intervals.reduce((sum, interval) =>
    sum + Math.max(0, Math.min(to, interval.endGlobalMinute) - Math.max(from, interval.startGlobalMinute)), 0);
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
  const [scopeStart, scopeEnd] = periodBounds(period, end);
  if (scopeEnd <= scopeStart) return [];
  const goals = replayMatch(session.players, session.events).timeline
    .map((entry) => entry.event)
    .filter((event): event is Extract<MatchEvent, { type: "threat_recorded" }> => event.type === "threat_recorded" && event.outcome === "GOL");
  let scoreFor = 0;
  let scoreAgainst = 0;
  let start = scopeStart;
  const intervals: ScoreStateInterval[] = [];
  for (const goal of goals) {
    const at = deriveGlobalMinute(goal.period, goal.minute);
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
  const [scopeStart, scopeEnd] = periodBounds(period, end);
  const projection: CompetitiveProjection = { observed: 0, byPlayer: {}, byGoalkeeper: {}, eventIds: new Set<string>() };
  if (scopeEnd <= scopeStart) return projection;
  const replay = replayMatch(session.players, session.events, { currentClock: { period: session.matchFinished ? 2 : session.period, minute: session.matchFinished ? 20 : session.minute } });
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
    const start = deriveGlobalMinute(event.period, event.minute);
    const playingStateMatches = playingState === "ALL" || playingStateContainsEvent(event, playingIntervals);
    if (goalkeeperMatches && playingStateMatches && start >= scopeStart && start <= scopeEnd && isCompetitiveMoment(context, event.period, event.minute, scoreFor, scoreAgainst) && scoreStateMatches(scoreContext, scoreFor, scoreAgainst)) {
      projection.eventIds.add(event.id);
    }
    if (entry.event.type === "threat_recorded" && entry.event.outcome === "GOL") {
      if (entry.event.side === "FOR") scoreFor += 1;
      else scoreAgainst += 1;
    }
    const next = replay.timeline[index + 1];
    const finish = Math.min(end, next ? deriveGlobalMinute(next.event.period, next.event.minute) : end);
    let from = Math.max(scopeStart, start);
    const to = Math.min(scopeEnd, finish);
    if (context === "GOLD") from = Math.max(from, GOLD_WINDOW_START_GLOBAL_MINUTE);
    if (!goalkeeperMatches || to <= from || (context !== "ALL" && Math.abs(scoreFor - scoreAgainst) > 1) || !scoreStateMatches(scoreContext, scoreFor, scoreAgainst)) return;
    const scoreDuration = scoreStateDuration(from, to, scoreIntervals, scoreContext);
    const duration = playingState === "ALL"
      ? scoreDuration
      : scoreDuration <= 0
        ? 0
        : intervalDuration(from, to, playingIntervals);
    if (duration <= 0) return;
    projection.observed += duration;
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
