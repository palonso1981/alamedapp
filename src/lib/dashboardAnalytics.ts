import {
  DisciplineSummary,
  GoalTargetCoordinates,
  KeeperBodyPart,
  MatchEvent,
  MatchSession,
  Player,
  SaveOutcome,
  ThreatOutcome,
  ThreatPhase,
  ThreatRecordedEvent,
  ThreatSide,
} from "../types";
import {
  deriveGlobalMinute,
  effectiveThreatPhase,
  goalkeeperAtPosition,
  REGULATION_MATCH_CLOCK,
  replayMatch,
} from "./matchEngine";
import {
  matchCatalogClubId,
  MatchCatalogEntry,
} from "./matchCatalog";

export type DashboardPeriod = "ALL" | 1 | 2;

export interface DashboardMatchRecord {
  catalog: MatchCatalogEntry;
  session: MatchSession;
}

export interface DashboardScope {
  clubId: string;
  teamId: string;
  seasonId: string;
  matchId?: string;
  period?: DashboardPeriod;
  includeArchived?: boolean;
}

export interface ThreatOutcomeStats {
  total: number;
  GOL: number;
  PARADA: number;
  FUERA: number;
  BLOQUEADO: number;
}

export interface DashboardPlayerStats {
  playerId: string;
  name: string;
  number: number;
  matches: number;
  minutes: number;
  goals: number;
  assists: number;
  threats: number;
  targetMinutes?: number;
}

export interface DashboardGoalkeeperStats {
  playerId: string;
  name: string;
  number: number;
  photoUrl?: string;
  minutes: number;
  threatsAgainst: number;
  goalsAgainst: number;
  saves: number;
  outside: number;
  savePercentage: number | null;
  bodyParts: Record<KeeperBodyPart, number>;
  saveOutcomes: Record<SaveOutcome, number>;
}

export interface DashboardThreatPoint {
  eventId: string;
  matchId: string;
  side: ThreatSide;
  outcome: ThreatOutcome;
  x: number;
  y: number;
}

export interface DashboardGoalPoint {
  eventId: string;
  matchId: string;
  outcome: ThreatOutcome;
  target: GoalTargetCoordinates;
}

export interface DashboardMatchQuality {
  matchId: string;
  opponent: string;
  status: MatchCatalogEntry["status"];
  reviewStatus: MatchSession["reviewStatus"];
  pendingReview: number;
  manualReviewEvents: number;
  hasCompleteEvents: boolean;
}

export interface DashboardAnalytics {
  matches: number;
  finishedMatches: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  threats: Record<ThreatSide, ThreatOutcomeStats>;
  secondPlay: {
    threats: number;
    goals: number;
    reboundsWithThreat: number;
    reboundsWithoutThreat: number;
  };
  phases: Record<ThreatPhase, Record<ThreatSide, number>>;
  players: DashboardPlayerStats[];
  goalkeepers: DashboardGoalkeeperStats[];
  discipline: DisciplineSummary;
  pitchPoints: DashboardThreatPoint[];
  goalPoints: DashboardGoalPoint[];
  quality: DashboardMatchQuality[];
  missing: {
    phase: number;
    goalTarget: number;
    goalkeeper: number;
    bodyPart: number;
  };
}

/** Paradas válidas que solo necesitan enriquecimiento corporal posterior. */
export function selectSavesWithoutBodyPart(events: readonly MatchEvent[]): ThreatRecordedEvent[] {
  return events.filter((event): event is ThreatRecordedEvent =>
    event.type === "threat_recorded" &&
    event.deletedAt === null &&
    event.side === "AGAINST" &&
    event.outcome === "PARADA" &&
    event.defensive?.version === 2 &&
    !event.defensive.keeperBodyPart,
  );
}

const PHASES: ThreatPhase[] = [
  "POSITIONAL",
  "TRANSITION",
  "SET_PIECE_CORNER",
  "SET_PIECE_FREE_KICK",
  "SET_PIECE_KICK_IN",
  "FLYING_GOALKEEPER",
  "PENALTY",
  "DOUBLE_PENALTY",
  "UNSPECIFIED",
];

const BODY_PARTS: KeeperBodyPart[] = [
  "HEAD",
  "TORSO",
  "LEFT_ARM_HAND",
  "RIGHT_ARM_HAND",
  "LEFT_LEG_FOOT",
  "RIGHT_LEG_FOOT",
];

const SAVE_OUTCOMES: SaveOutcome[] = ["CATCH", "REBOUND", "CLEARANCE"];

function emptyThreats(): ThreatOutcomeStats {
  return { total: 0, GOL: 0, PARADA: 0, FUERA: 0, BLOQUEADO: 0 };
}

function emptyDiscipline(): DisciplineSummary {
  return {
    for: { fouls: 0, yellowCards: 0, redCards: 0 },
    against: { fouls: 0, yellowCards: 0, redCards: 0 },
  };
}

function emptyBodyParts(): Record<KeeperBodyPart, number> {
  return Object.fromEntries(BODY_PARTS.map((part) => [part, 0])) as Record<
    KeeperBodyPart,
    number
  >;
}

function emptySaveOutcomes(): Record<SaveOutcome, number> {
  return Object.fromEntries(SAVE_OUTCOMES.map((outcome) => [outcome, 0])) as Record<
    SaveOutcome,
    number
  >;
}

function activeEvents(session: MatchSession, period: DashboardPeriod): MatchEvent[] {
  return session.events.filter(
    (event) => event.deletedAt === null && (period === "ALL" || event.period === period),
  );
}

function matchEndClock(session: MatchSession, period: DashboardPeriod) {
  if (period !== "ALL") {
    const completed =
      session.matchFinished ||
      session.period > period ||
      Boolean(session.closedPeriods?.includes(period));
    return {
      period,
      minute: completed
        ? REGULATION_MATCH_CLOCK.periodDurationMinutes
        : session.period === period
          ? session.minute
          : 0,
    };
  }
  return session.matchFinished
    ? {
        period: REGULATION_MATCH_CLOCK.regulationPeriods,
        minute: REGULATION_MATCH_CLOCK.periodDurationMinutes,
      }
    : { period: session.period, minute: session.minute };
}

function eventGlobalMinute(event: Pick<MatchEvent, "period" | "minute">): number {
  return deriveGlobalMinute(event.period, event.minute);
}

function addDiscipline(target: DisciplineSummary, source: DisciplineSummary): void {
  for (const side of ["for", "against"] as const) {
    target[side].fouls += source[side].fouls;
    target[side].yellowCards += source[side].yellowCards;
    target[side].redCards += source[side].redCards;
  }
}

function playerIdentity(players: Player[], playerId: string) {
  const player = players.find((candidate) => candidate.id === playerId);
  return {
    name: player?.name ?? "Jugador no disponible",
    number: player?.number ?? 0,
    photoUrl: player?.photoUrl,
  };
}

function goalkeeperMinutes(
  session: MatchSession,
  events: MatchEvent[],
  endClock: { period: number; minute: number },
): Map<string, number> {
  const result = new Map<string, number>();
  const replay = replayMatch(session.players, events, { currentClock: endClock });
  const sorted = replay.timeline;
  const end = deriveGlobalMinute(endClock.period, endClock.minute);
  sorted.forEach((entry, index) => {
    const event = entry.event;
    const start = eventGlobalMinute(event);
    const next = sorted[index + 1];
    const finish = Math.min(end, next ? eventGlobalMinute(next.event) : end);
    if (finish <= start) return;
    if (entry.gameContexts.includes("FLYING_GOALKEEPER")) return;
    const goalkeeper = goalkeeperAtPosition(session.players, events, event);
    if (goalkeeper.status === "PLAYER") {
      result.set(
        goalkeeper.playerId,
        (result.get(goalkeeper.playerId) ?? 0) + finish - start,
      );
    }
  });
  return result;
}

export function normalGoalkeeperForThreat(
  session: MatchSession,
  event: ThreatRecordedEvent,
): string | null {
  const entry = replayMatch(session.players, session.events).timeline.find(
    (candidate) => candidate.event.id === event.id,
  );
  if (entry?.gameContexts.includes("FLYING_GOALKEEPER")) return null;
  const goalkeeper = goalkeeperAtPosition(session.players, session.events, event);
  return goalkeeper.status === "PLAYER" ? goalkeeper.playerId : null;
}

export function filterDashboardMatches(
  records: readonly DashboardMatchRecord[],
  scope: DashboardScope,
): DashboardMatchRecord[] {
  return records.filter(({ catalog, session }) => {
    const preparation = session.preparation;
    if (catalog.deletedAt || preparation?.deletedAt) return false;
    if (!scope.includeArchived && (catalog.archivedAt || preparation?.archivedAt)) return false;
    if (matchCatalogClubId(catalog) !== scope.clubId) return false;
    if ((preparation?.clubId ?? matchCatalogClubId(catalog)) !== scope.clubId) return false;
    if ((catalog.teamId ?? preparation?.teamId) !== scope.teamId) return false;
    if ((catalog.seasonId ?? preparation?.seasonId) !== scope.seasonId) return false;
    return !scope.matchId || catalog.matchId === scope.matchId;
  });
}

export function buildDashboardAnalytics(
  records: readonly DashboardMatchRecord[],
  scope: DashboardScope,
): DashboardAnalytics {
  const selected = filterDashboardMatches(records, scope);
  const period = scope.period ?? "ALL";
  const players = new Map<string, DashboardPlayerStats>();
  const goalkeepers = new Map<string, DashboardGoalkeeperStats>();
  const phases = Object.fromEntries(
    PHASES.map((phase) => [phase, { FOR: 0, AGAINST: 0 }]),
  ) as DashboardAnalytics["phases"];
  const discipline = emptyDiscipline();
  const result: DashboardAnalytics = {
    matches: selected.length,
    finishedMatches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    threats: { FOR: emptyThreats(), AGAINST: emptyThreats() },
    secondPlay: {
      threats: 0,
      goals: 0,
      reboundsWithThreat: 0,
      reboundsWithoutThreat: 0,
    },
    phases,
    players: [],
    goalkeepers: [],
    discipline,
    pitchPoints: [],
    goalPoints: [],
    quality: [],
    missing: { phase: 0, goalTarget: 0, goalkeeper: 0, bodyPart: 0 },
  };

  for (const { catalog, session } of selected) {
    const events = activeEvents(session, period);
    const endClock = matchEndClock(session, period);
    const replay = replayMatch(session.players, events, { currentClock: endClock });
    const targetMinutes = session.preparation?.targetMinutes ?? {};
    const appeared = new Set(
      replay.timeline.flatMap((entry) => entry.lineupPlayerIds),
    );

    result.goalsFor += replay.score.for;
    result.goalsAgainst += replay.score.against;
    addDiscipline(result.discipline, replay.discipline);
    if (catalog.status === "FINISHED" || session.matchFinished) {
      result.finishedMatches += 1;
      if (replay.score.for > replay.score.against) result.wins += 1;
      else if (replay.score.for < replay.score.against) result.losses += 1;
      else result.draws += 1;
    }

    for (const player of session.players) {
      const current = players.get(player.id) ?? {
        playerId: player.id,
        name: player.name,
        number: player.number,
        matches: 0,
        minutes: 0,
        goals: 0,
        assists: 0,
        threats: 0,
        targetMinutes: 0,
      };
      current.minutes += replay.playerMinutes[player.id]?.totalMinutes ?? 0;
      if (appeared.has(player.id)) current.matches += 1;
      if (targetMinutes[player.id] !== undefined) {
        current.targetMinutes = (current.targetMinutes ?? 0) + targetMinutes[player.id];
      }
      players.set(player.id, current);
    }

    const keeperMinutes = goalkeeperMinutes(session, events, endClock);
    for (const [playerId, minutes] of Array.from(keeperMinutes.entries())) {
      const identity = playerIdentity(session.players, playerId);
      const current = goalkeepers.get(playerId) ?? {
        playerId,
        ...identity,
        minutes: 0,
        threatsAgainst: 0,
        goalsAgainst: 0,
        saves: 0,
        outside: 0,
        savePercentage: null,
        bodyParts: emptyBodyParts(),
        saveOutcomes: emptySaveOutcomes(),
      };
      current.minutes += minutes;
      goalkeepers.set(playerId, current);
    }

    const threats = events.filter(
      (event): event is ThreatRecordedEvent => event.type === "threat_recorded",
    );
    const threatIds = new Set(threats.map((event) => event.id));
    for (const event of threats) {
      const outcome = result.threats[event.side];
      outcome.total += 1;
      outcome[event.outcome] += 1;
      phases[effectiveThreatPhase(session.events, event)][event.side] += 1;
      if (event.phase === "UNSPECIFIED") result.missing.phase += 1;
      if (event.parentEventId) {
        result.secondPlay.threats += 1;
        if (event.outcome === "GOL") result.secondPlay.goals += 1;
      }
      result.pitchPoints.push({
        eventId: event.id,
        matchId: session.matchId,
        side: event.side,
        outcome: event.outcome,
        x: event.origin.x,
        y: event.origin.y,
      });
      if (event.side === "FOR" && event.playerId) {
        const scorer = players.get(event.playerId);
        if (scorer) {
          scorer.threats += 1;
          if (event.outcome === "GOL") scorer.goals += 1;
        }
      }
      if (
        event.side === "FOR" &&
        event.outcome === "GOL" &&
        event.assist?.status === "PLAYER"
      ) {
        const assistant = players.get(event.assist.playerId);
        if (assistant) assistant.assists += 1;
      }
      if (event.side === "AGAINST") {
        if (event.defensive) {
          result.goalPoints.push({
            eventId: event.id,
            matchId: session.matchId,
            outcome: event.outcome,
            target: event.defensive.goalTarget,
          });
        } else {
          result.missing.goalTarget += 1;
        }
        const goalkeeperId = normalGoalkeeperForThreat(session, event);
        if (!goalkeeperId) {
          result.missing.goalkeeper += 1;
        } else {
          const identity = playerIdentity(session.players, goalkeeperId);
          const keeper = goalkeepers.get(goalkeeperId) ?? {
            playerId: goalkeeperId,
            ...identity,
            minutes: 0,
            threatsAgainst: 0,
            goalsAgainst: 0,
            saves: 0,
            outside: 0,
            savePercentage: null,
            bodyParts: emptyBodyParts(),
            saveOutcomes: emptySaveOutcomes(),
          };
          keeper.threatsAgainst += 1;
          if (event.outcome === "GOL") keeper.goalsAgainst += 1;
          if (event.outcome === "PARADA") {
            keeper.saves += 1;
            const bodyPart =
              event.defensive?.version === 2
                ? event.defensive.keeperBodyPart
                : undefined;
            if (bodyPart) keeper.bodyParts[bodyPart] += 1;
            else result.missing.bodyPart += 1;
            if (event.defensive?.saveOutcome) {
              keeper.saveOutcomes[event.defensive.saveOutcome] += 1;
            }
          }
          if (event.outcome === "FUERA") keeper.outside += 1;
          goalkeepers.set(goalkeeperId, keeper);
        }
      }
    }

    const reboundEvents = threats.filter(
      (event) =>
        event.side === "AGAINST" &&
        event.outcome === "PARADA" &&
        event.defensive?.saveOutcome === "REBOUND",
    );
    for (const rebound of reboundEvents) {
      const continued = threats.some(
        (candidate) =>
          candidate.parentEventId === rebound.id && threatIds.has(candidate.id),
      );
      result.secondPlay[
        continued ? "reboundsWithThreat" : "reboundsWithoutThreat"
      ] += 1;
    }

    const qualityEvents = session.events.filter((event) => event.deletedAt === null);
    result.quality.push({
      matchId: session.matchId,
      opponent: catalog.opponent,
      status: session.matchFinished ? "FINISHED" : catalog.status,
      reviewStatus: session.reviewStatus,
      pendingReview: qualityEvents.filter((event) => event.pendingReview).length,
      manualReviewEvents: qualityEvents.filter(
        (event) => event.provenance === "MANUAL_REVIEW",
      ).length,
      hasCompleteEvents: qualityEvents.every(
        (event) =>
          event.type !== "threat_recorded" ||
          (event.phase !== "UNSPECIFIED" &&
            (event.side !== "AGAINST" || Boolean(event.defensive))),
      ),
    });
  }

  for (const keeper of Array.from(goalkeepers.values())) {
    const denominator = keeper.saves + keeper.goalsAgainst;
    keeper.savePercentage = denominator > 0 ? (keeper.saves / denominator) * 100 : null;
  }
  result.players = Array.from(players.values())
    .map((player) => ({
      ...player,
      ...(player.targetMinutes === 0 ? { targetMinutes: undefined } : {}),
    }))
    .filter(
      (player) =>
        player.matches > 0 ||
        player.minutes > 0 ||
        player.goals > 0 ||
        player.assists > 0 ||
        player.threats > 0,
    )
    .sort((a, b) => b.minutes - a.minutes || a.number - b.number);
  result.goalkeepers = Array.from(goalkeepers.values()).sort(
    (a, b) => b.minutes - a.minutes || a.number - b.number,
  );
  return result;
}

export const DASHBOARD_PHASES = PHASES;
export const DASHBOARD_BODY_PARTS = BODY_PARTS;
export const DASHBOARD_SAVE_OUTCOMES = SAVE_OUTCOMES;
