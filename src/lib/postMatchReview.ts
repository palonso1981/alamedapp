import { replayMatch, REGULATION_MATCH_CLOCK } from "./matchEngine";
import { MatchEvent, MatchReviewStatus, MatchSession } from "../types";

export interface ReviewEventCounts {
  threats: number;
  goalsFor: number;
  goalsAgainst: number;
  fouls: number;
  cards: number;
  pending: number;
  manualReview: number;
}

export interface TargetMinutesComparison {
  playerId: string;
  target: number;
  actual: number;
  difference: number;
}

export function effectiveReviewStatus(session: MatchSession): MatchReviewStatus {
  return session.reviewStatus ?? "NOT_REVIEWED";
}

export function activeReviewEvents(events: readonly MatchEvent[]): MatchEvent[] {
  return events.filter(
    (event) => event.deletedAt === null && event.type !== "lineup_initialized",
  );
}

export function reviewEventCounts(events: readonly MatchEvent[]): ReviewEventCounts {
  const active = activeReviewEvents(events);
  return {
    threats: active.filter((event) => event.type === "threat_recorded").length,
    goalsFor: active.filter(
      (event) => event.type === "threat_recorded" && event.side === "FOR" && event.outcome === "GOL",
    ).length,
    goalsAgainst: active.filter(
      (event) => event.type === "threat_recorded" && event.side === "AGAINST" && event.outcome === "GOL",
    ).length,
    fouls: active.filter((event) => event.type === "foul_recorded").length,
    cards: active.filter((event) => event.type === "card_recorded").length,
    pending: active.filter((event) => event.pendingReview).length,
    manualReview: active.filter((event) => event.provenance === "MANUAL_REVIEW").length,
  };
}

export function targetMinutesComparisons(
  session: MatchSession,
): TargetMinutesComparison[] {
  const targets = session.preparation?.targetMinutes ?? {};
  if (Object.keys(targets).length === 0) return [];
  const replay = replayMatch(session.players, session.events, {
    currentClock: {
      period: REGULATION_MATCH_CLOCK.regulationPeriods,
      minute: REGULATION_MATCH_CLOCK.periodDurationMinutes,
    },
  });
  return Object.entries(targets).map(([playerId, target]) => {
    const actual = replay.playerMinutes[playerId]?.totalMinutes ?? 0;
    return { playerId, target, actual, difference: actual - target };
  });
}

export function periodScore(
  session: MatchSession,
  period: number,
): { for: number; against: number } {
  const through = replayMatch(session.players, session.events, {
    throughClock: {
      period,
      minute: REGULATION_MATCH_CLOCK.periodDurationMinutes,
    },
  }).score;
  if (period === 1) return through;
  const prior = replayMatch(session.players, session.events, {
    throughClock: {
      period: period - 1,
      minute: REGULATION_MATCH_CLOCK.periodDurationMinutes,
    },
  }).score;
  return { for: through.for - prior.for, against: through.against - prior.against };
}
