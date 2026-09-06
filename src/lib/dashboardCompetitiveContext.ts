import { MatchSession } from "../types";
import { DashboardPeriod } from "./dashboardAnalytics";
import { deriveGlobalMinute, goalkeeperAtPosition, REGULATION_MATCH_CLOCK, replayMatch } from "./matchEngine";

export type CompetitiveContext = "ALL" | "KEY" | "GOLD";

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
export function deriveCompetitiveProjection(session: MatchSession, period: DashboardPeriod, context: CompetitiveContext): CompetitiveProjection {
  const end = matchEnd(session);
  const [scopeStart, scopeEnd] = periodBounds(period, end);
  const projection: CompetitiveProjection = { observed: 0, byPlayer: {}, byGoalkeeper: {}, eventIds: new Set<string>() };
  if (scopeEnd <= scopeStart) return projection;
  const replay = replayMatch(session.players, session.events, { currentClock: { period: session.matchFinished ? 2 : session.period, minute: session.matchFinished ? 20 : session.minute } });
  let scoreFor = 0;
  let scoreAgainst = 0;
  replay.timeline.forEach((entry, index) => {
    const event = entry.event;
    const start = deriveGlobalMinute(event.period, event.minute);
    if (start >= scopeStart && start <= scopeEnd && isCompetitiveMoment(context, event.period, event.minute, scoreFor, scoreAgainst)) {
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
    if (to <= from || (context !== "ALL" && Math.abs(scoreFor - scoreAgainst) > 1)) return;
    const duration = to - from;
    projection.observed += duration;
    entry.lineupPlayerIds.forEach((id) => { projection.byPlayer[id] = (projection.byPlayer[id] ?? 0) + duration; });
    if (!entry.gameContexts.includes("FLYING_GOALKEEPER")) {
      const goalkeeper = goalkeeperAtPosition(session.players, session.events, event);
      if (goalkeeper.status === "PLAYER") projection.byGoalkeeper[goalkeeper.playerId] = (projection.byGoalkeeper[goalkeeper.playerId] ?? 0) + duration;
    }
  });
  return projection;
}

export function deriveCompetitiveMinutes(session: MatchSession, period: DashboardPeriod, context: CompetitiveContext): CompetitiveMinutes {
  const { observed, byPlayer, byGoalkeeper } = deriveCompetitiveProjection(session, period, context);
  return { observed, byPlayer, byGoalkeeper };
}

export function competitiveEventIds(session: MatchSession, period: DashboardPeriod, context: CompetitiveContext): Set<string> {
  return deriveCompetitiveProjection(session, period, context).eventIds;
}
