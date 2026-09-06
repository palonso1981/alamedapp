import { MatchEvent, MatchSession } from "../types";
import { DashboardPeriod } from "./dashboardAnalytics";
import { deriveGlobalMinute, REGULATION_MATCH_CLOCK, replayMatch, sortEvents } from "./matchEngine";

export type CompetitiveContext = "ALL" | "KEY" | "GOLD";

export interface CompetitiveMinutes {
  observed: number;
  byPlayer: Record<string, number>;
}

function matchEnd(session: MatchSession): number {
  return session.matchFinished
    ? REGULATION_MATCH_CLOCK.regulationPeriods * REGULATION_MATCH_CLOCK.periodDurationMinutes
    : deriveGlobalMinute(session.period, session.minute);
}

function periodBounds(period: DashboardPeriod, end: number): [number, number] {
  if (period === 1) return [0, Math.min(20, end)];
  if (period === 2) return [20, Math.min(40, end)];
  return [0, end];
}

export function isCompetitiveMoment(context: CompetitiveContext, period: number, minute: number, scoreFor: number, scoreAgainst: number): boolean {
  if (context === "ALL") return true;
  if (Math.abs(scoreFor - scoreAgainst) > 1) return false;
  return context === "KEY" || (period === 2 && minute >= 15);
}

/**
 * Integra intervalos del replay; no persiste minutos. La resolución disponible es
 * el minuto reglamentario del evento, porque V1 no registra segundos de reloj.
 */
export function deriveCompetitiveMinutes(session: MatchSession, period: DashboardPeriod, context: CompetitiveContext): CompetitiveMinutes {
  const end = matchEnd(session);
  const [scopeStart, scopeEnd] = periodBounds(period, end);
  if (scopeEnd <= scopeStart) return { observed: 0, byPlayer: {} };
  if (context === "ALL") {
    const replay = replayMatch(session.players, session.events, { currentClock: { period: session.matchFinished ? 2 : session.period, minute: session.matchFinished ? 20 : session.minute } });
    const byPlayer = Object.fromEntries(Object.entries(replay.playerMinutes).map(([id, value]) => [id, value.totalMinutes]));
    return { observed: scopeEnd - scopeStart, byPlayer };
  }
  const replay = replayMatch(session.players, session.events, { currentClock: { period: session.matchFinished ? 2 : session.period, minute: session.matchFinished ? 20 : session.minute } });
  const byPlayer: Record<string, number> = {};
  let observed = 0;
  let scoreFor = 0;
  let scoreAgainst = 0;
  replay.timeline.forEach((entry, index) => {
    if (entry.event.type === "threat_recorded" && entry.event.outcome === "GOL") {
      if (entry.event.side === "FOR") scoreFor += 1;
      else scoreAgainst += 1;
    }
    const start = deriveGlobalMinute(entry.event.period, entry.event.minute);
    const next = replay.timeline[index + 1];
    const finish = Math.min(end, next ? deriveGlobalMinute(next.event.period, next.event.minute) : end);
    const from = Math.max(scopeStart, start);
    const to = Math.min(scopeEnd, finish);
    if (to <= from || !isCompetitiveMoment(context, entry.event.period, entry.event.minute, scoreFor, scoreAgainst)) return;
    const duration = to - from;
    observed += duration;
    entry.lineupPlayerIds.forEach((id) => { byPlayer[id] = (byPlayer[id] ?? 0) + duration; });
  });
  return { observed, byPlayer };
}

export function competitiveEventIds(session: MatchSession, period: DashboardPeriod, context: CompetitiveContext): Set<string> {
  if (context === "ALL") return new Set(session.events.map((event) => event.id));
  let scoreFor = 0;
  let scoreAgainst = 0;
  const included = new Set<string>();
  for (const event of sortEvents(session.events).filter((item) => item.deletedAt === null)) {
    const inPeriod = period === "ALL" || event.period === period;
    if (inPeriod && isCompetitiveMoment(context, event.period, event.minute, scoreFor, scoreAgainst)) included.add(event.id);
    if (event.type === "threat_recorded" && event.outcome === "GOL") {
      if (event.side === "FOR") scoreFor += 1;
      else scoreAgainst += 1;
    }
  }
  return included;
}

export function filterEventsForCompetitiveContext(session: MatchSession, period: DashboardPeriod, context: CompetitiveContext): MatchEvent[] {
  const ids = competitiveEventIds(session, period, context);
  return session.events.filter((event) => event.type === "lineup_initialized" || event.type === "substitution" || event.type === "game_state_changed" || ids.has(event.id));
}
