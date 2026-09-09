import {
  KeeperBodyPart,
  MatchEvent,
  MatchSession,
  Player,
  SaveOutcome,
  ThreatOutcome,
  ThreatRecordedEvent,
} from "../types";
import {
  buildDashboardAnalytics,
  DashboardGoalPoint,
  DashboardThreatPoint,
  DashboardMatchRecord,
  DashboardPeriod,
  DashboardScope,
  filterDashboardMatches,
  normalGoalkeeperForThreat,
} from "./dashboardAnalytics";
import {
  deriveGlobalMinute,
  REGULATION_MATCH_CLOCK,
  replayMatch,
} from "./matchEngine";
import { deriveGoalZoneV1, GoalZoneV1 } from "./spatialZones";
import { GOAL_FRAME } from "./goalTarget";
import { formatFutsalPosition } from "./positionFormat";

export type VenueFilter = "ALL" | "HOME" | "AWAY";
export type ResultFilter = "ALL" | "WIN" | "DRAW" | "LOSS";
export type PitchOriginZone = "Z1" | "Z2" | "Z3" | "Z4" | "Z5" | "Z6";

export interface AnalysisScope extends DashboardScope {
  venue?: VenueFilter;
  result?: ResultFilter;
}

export interface MetricComparison {
  value: number | null;
  reference: number | null;
  difference: number | null;
}

export interface TeamRates {
  observedMinutes: number;
  threatsFor40: number | null;
  threatsAgainst40: number | null;
  goalsFor40: number | null;
  goalsAgainst40: number | null;
  foulsFor40: number | null;
  foulsAgainst40: number | null;
  possessionLosses40: number | null;
}

export interface PlayerOnCourtStats {
  threatsFor: number;
  threatsAgainst: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  foulsFor: number;
  foulsAgainst: number;
  threatsFor40: number | null;
  threatsAgainst40: number | null;
  threatDifference40: number | null;
  goalsFor40: number | null;
  goalsAgainst40: number | null;
  goalDifference40: number | null;
  foulsFor40: number | null;
  foulsAgainst40: number | null;
  threatsForOnTarget: number;
  threatsAgainstOnTarget: number;
  threatsForNear: number;
  threatsAgainstNear: number;
}

export interface PlayerMatchTrend {
  matchId: string;
  opponent: string;
  date: string;
  minutes: number;
  goals: number;
  assists: number;
  threats: number;
  goalsForOnCourt: number;
  goalsAgainstOnCourt: number;
  pointsOnCourt: number;
  keyMinutes: number;
  goldMinutes: number;
}

export interface PlayerAnalysis {
  playerId: string;
  name: string;
  number: number;
  position?: string;
  photoUrl?: string;
  dominantFoot?: Player["dominantFoot"];
  matches: number;
  minutes: number;
  availableMinutes: number;
  participationPercentage: number | null;
  averageMinutes: number | null;
  keyMinutes: number;
  keyMinutesPerMatch: number | null;
  keyMinutesPercentage: number | null;
  goldMinutes: number;
  goldMinutesPerMatch: number | null;
  goldMinutesPercentage: number | null;
  targetMinutes?: number;
  goals: number;
  goalsPerMatch: number | null;
  goals40: number | null;
  assists: number;
  assistsPerMatch: number | null;
  assists40: number | null;
  ownThreats: number;
  ownThreatsPerMatch: number | null;
  ownThreats40: number | null;
  ownOnTarget: number;
  ownOnTargetPercentage: number | null;
  ownNear: number;
  ownNearPercentage: number | null;
  ownOutcomes: Record<ThreatOutcome, number>;
  ownShotPoints: Array<{ eventId: string; matchId: string; side: "FOR"; x: number; y: number; outcome: ThreatOutcome }>;
  possessionLosses: number;
  possessionLossesPerMatch: number | null;
  possessionLosses40: number | null;
  foulsCommitted: number;
  foulsReceived: number;
  criticalFoulsCommitted: number;
  criticalFoulsReceived: number;
  foulsCommittedPerMatch: number | null;
  foulsCommitted40: number | null;
  foulsReceivedPerMatch: number | null;
  foulsReceived40: number | null;
  criticalFoulsCommittedPerMatch: number | null;
  criticalFoulsCommitted40: number | null;
  criticalFoulsReceivedPerMatch: number | null;
  criticalFoulsReceived40: number | null;
  yellowCards: number;
  redCards: number;
  onCourtPoints: number;
  onCourtPointsPerMatch: number | null;
  onCourt: PlayerOnCourtStats;
  lowSample: boolean;
  trend: PlayerMatchTrend[];
}

export interface GoalkeeperAnalysis {
  playerId: string;
  name: string;
  number: number;
  photoUrl?: string;
  minutes: number;
  threatsAgainst: number;
  threatsAgainst40: number | null;
  interiorThreats: number;
  saves: number;
  goalsAgainst: number;
  goalsAgainst40: number | null;
  savePercentage: number | null;
  bodyParts: Record<KeeperBodyPart, number>;
  saveOutcomes: Record<SaveOutcome, number>;
  goalPoints: DashboardGoalPoint[];
  originPoints: DashboardThreatPoint[];
  keyMinutes: number;
  keyMinutesPercentage: number | null;
  goldMinutes: number;
  goldMinutesPercentage: number | null;
}

export interface TrendPoint {
  matchId: string;
  opponent: string;
  date: string;
  threatsFor: number;
  threatsAgainst: number;
  goalsFor: number;
  goalsAgainst: number;
  venue: "HOME" | "AWAY";
  result: "WIN" | "DRAW" | "LOSS" | null;
  shotsOnTarget: number;
  threatsOnTarget: number;
  shotsNear: number;
  threatsNear: number;
  savePercentage: number | null;
  pjForMinutes: number;
  pjAgainstMinutes: number;
}

export interface PlayingStateAnalytics {
  minutes: number;
  matchesWithState: number;
  minutesPerMatch: number | null;
  minutesPerMatchWithState: number | null;
  threatsFor: number;
  threatsAgainst: number;
  goalsFor: number;
  goalsAgainst: number;
  onTargetFor: number;
  onTargetAgainst: number;
}

export interface ZoneStats<T extends string> {
  zone: T;
  threats: number;
  goals: number;
  saves: number;
  outside: number;
  goalPercentage: number | null;
  savePercentage: number | null;
}

export interface DashboardAnalysis {
  records: DashboardMatchRecord[];
  samples: number;
  analytics: ReturnType<typeof buildDashboardAnalytics>;
  rates: TeamRates;
  players: PlayerAnalysis[];
  goalkeepers: GoalkeeperAnalysis[];
  teamKeyMinutes: number;
  teamGoldMinutes: number;
  trends: TrendPoint[];
  pitchZones: ZoneStats<PitchOriginZone>[];
  goalZones: ZoneStats<GoalZoneV1>[];
  criticalFouls: { for: number; against: number };
  possessionLosses: number;
  flyingGoalkeeper: {
    for: PlayingStateAnalytics;
    against: PlayingStateAnalytics;
  };
}

export const LOW_SAMPLE_MINUTES = 20;
export const PITCH_NEAR_SPLIT_X = 0.25;

/**
 * Zonas desde la perspectiva del portero CDA, situado a la izquierda y mirando
 * hacia la derecha. Su derecha corresponde a la parte inferior del lienzo.
 * El corte 0.25 separa el entorno de 6 m del de 10 m: penalti≈Z2, doble≈Z5.
 */
export function derivePitchOriginZone(point: { x: number; y: number }): PitchOriginZone {
  const far = point.x >= PITCH_NEAR_SPLIT_X;
  const lane = point.y >= 2 / 3 ? 1 : point.y <= 1 / 3 ? 3 : 2;
  return `Z${far ? lane + 3 : lane}` as PitchOriginZone;
}

export function per40(value: number, observedMinutes: number): number | null {
  return observedMinutes > 0 ? (value / observedMinutes) * 40 : null;
}

export function compareToAverage(
  value: number | null,
  referenceTotal: number,
  referenceSamples: number,
): MetricComparison {
  const reference = referenceSamples > 0 ? referenceTotal / referenceSamples : null;
  return {
    value,
    reference,
    difference: value === null || reference === null ? null : value - reference,
  };
}

function endClock(session: MatchSession, period: DashboardPeriod) {
  if (period !== "ALL") {
    const finished = session.matchFinished || session.period > period || Boolean(session.closedPeriods?.includes(period));
    return { period, minute: finished ? REGULATION_MATCH_CLOCK.periodDurationMinutes : session.period === period ? session.minute : 0 };
  }
  return session.matchFinished
    ? { period: REGULATION_MATCH_CLOCK.regulationPeriods, minute: REGULATION_MATCH_CLOCK.periodDurationMinutes }
    : { period: session.period, minute: session.minute };
}

function observedMinutes(session: MatchSession, period: DashboardPeriod): number {
  const clock = endClock(session, period);
  if (period !== "ALL") return clock.minute;
  return deriveGlobalMinute(clock.period, clock.minute);
}

function eventsFor(session: MatchSession, period: DashboardPeriod): MatchEvent[] {
  return session.events.filter((event) => event.deletedAt === null && (period === "ALL" || event.period === period));
}

function resultFor(record: DashboardMatchRecord): Exclude<ResultFilter, "ALL"> | null {
  if (!record.session.matchFinished && record.catalog.status !== "FINISHED") return null;
  const score = replayMatch(record.session.players, record.session.events).score;
  return score.for > score.against ? "WIN" : score.for < score.against ? "LOSS" : "DRAW";
}

export function filterAnalysisMatches(
  records: readonly DashboardMatchRecord[],
  scope: AnalysisScope,
): DashboardMatchRecord[] {
  return filterDashboardMatches(records, scope).filter((record) => {
    if (scope.venue && scope.venue !== "ALL" && record.catalog.venue !== scope.venue) return false;
    if (scope.result && scope.result !== "ALL" && resultFor(record) !== scope.result) return false;
    return true;
  });
}

function emptyOutcomes(): Record<ThreatOutcome, number> {
  return { GOL: 0, PARADA: 0, FUERA: 0, BLOQUEADO: 0 };
}

function addOnCourtEvent(player: PlayerAnalysis, event: MatchEvent): void {
  if (event.type === "threat_recorded") {
    const onTarget = event.outcome === "GOL" || event.outcome === "PARADA";
    const near = ["Z1", "Z2", "Z3"].includes(derivePitchOriginZone(event.origin));
    if (event.side === "FOR") { player.onCourt.threatsFor += 1; if (onTarget) player.onCourt.threatsForOnTarget += 1; if (near) player.onCourt.threatsForNear += 1; }
    else { player.onCourt.threatsAgainst += 1; if (onTarget) player.onCourt.threatsAgainstOnTarget += 1; if (near) player.onCourt.threatsAgainstNear += 1; }
    if (event.outcome === "GOL") {
      if (event.side === "FOR") player.onCourt.goalsFor += 1;
      else player.onCourt.goalsAgainst += 1;
    }
  } else if (event.type === "foul_recorded") {
    if (event.side === "FOR") player.onCourt.foulsFor += 1;
    else player.onCourt.foulsAgainst += 1;
  }
}

function finalizePlayer(player: PlayerAnalysis): void {
  player.participationPercentage = player.availableMinutes > 0 ? player.minutes / player.availableMinutes * 100 : null;
  player.averageMinutes = player.matches > 0 ? player.minutes / player.matches : null;
  player.keyMinutesPerMatch = player.matches > 0 ? player.keyMinutes / player.matches : null;
  player.goldMinutesPerMatch = player.matches > 0 ? player.goldMinutes / player.matches : null;
  player.goalsPerMatch = player.matches > 0 ? player.goals / player.matches : null;
  player.goals40 = per40(player.goals, player.minutes);
  player.assistsPerMatch = player.matches > 0 ? player.assists / player.matches : null;
  player.assists40 = per40(player.assists, player.minutes);
  player.ownThreatsPerMatch = player.matches > 0 ? player.ownThreats / player.matches : null;
  player.ownThreats40 = per40(player.ownThreats, player.minutes);
  player.ownOnTargetPercentage = player.ownThreats > 0 ? player.ownOnTarget / player.ownThreats * 100 : null;
  player.ownNearPercentage = player.ownThreats > 0 ? player.ownNear / player.ownThreats * 100 : null;
  player.possessionLossesPerMatch = player.matches > 0 ? player.possessionLosses / player.matches : null;
  player.possessionLosses40 = per40(player.possessionLosses, player.minutes);
  player.foulsCommittedPerMatch = player.matches > 0 ? player.foulsCommitted / player.matches : null;
  player.foulsCommitted40 = per40(player.foulsCommitted, player.minutes);
  player.foulsReceivedPerMatch = player.matches > 0 ? player.foulsReceived / player.matches : null;
  player.foulsReceived40 = per40(player.foulsReceived, player.minutes);
  player.criticalFoulsCommittedPerMatch = player.matches > 0 ? player.criticalFoulsCommitted / player.matches : null;
  player.criticalFoulsCommitted40 = per40(player.criticalFoulsCommitted, player.minutes);
  player.criticalFoulsReceivedPerMatch = player.matches > 0 ? player.criticalFoulsReceived / player.matches : null;
  player.criticalFoulsReceived40 = per40(player.criticalFoulsReceived, player.minutes);
  player.onCourtPointsPerMatch = player.matches > 0 ? player.onCourtPoints / player.matches : null;
  player.onCourt.goalDifference = player.onCourt.goalsFor - player.onCourt.goalsAgainst;
  player.onCourt.threatsFor40 = per40(player.onCourt.threatsFor, player.minutes);
  player.onCourt.threatsAgainst40 = per40(player.onCourt.threatsAgainst, player.minutes);
  player.onCourt.threatDifference40 = per40(player.onCourt.threatsFor - player.onCourt.threatsAgainst, player.minutes);
  player.onCourt.goalsFor40 = per40(player.onCourt.goalsFor, player.minutes);
  player.onCourt.goalsAgainst40 = per40(player.onCourt.goalsAgainst, player.minutes);
  player.onCourt.goalDifference40 = per40(player.onCourt.goalDifference, player.minutes);
  player.onCourt.foulsFor40 = per40(player.onCourt.foulsFor, player.minutes);
  player.onCourt.foulsAgainst40 = per40(player.onCourt.foulsAgainst, player.minutes);
  player.lowSample = player.minutes < LOW_SAMPLE_MINUTES;
}

function createPlayer(player: Player): PlayerAnalysis {
  return {
    playerId: player.id,
    name: player.name,
    number: player.number,
    position: formatFutsalPosition(player.naturalPosition ?? player.position, "N/D"),
    photoUrl: player.photoUrl,
    dominantFoot: player.dominantFoot,
    matches: 0,
    minutes: 0,
    availableMinutes: 0,
    participationPercentage: null,
    averageMinutes: null,
    keyMinutes: 0,
    keyMinutesPerMatch: null,
    keyMinutesPercentage: null,
    goldMinutes: 0,
    goldMinutesPerMatch: null,
    goldMinutesPercentage: null,
    targetMinutes: undefined,
    goals: 0,
    goalsPerMatch: null,
    goals40: null,
    assists: 0,
    assistsPerMatch: null,
    assists40: null,
    ownThreats: 0,
    ownThreatsPerMatch: null,
    ownThreats40: null,
    ownOnTarget: 0,
    ownOnTargetPercentage: null,
    ownNear: 0,
    ownNearPercentage: null,
    ownOutcomes: emptyOutcomes(),
    ownShotPoints: [],
    possessionLosses: 0,
    possessionLossesPerMatch: null,
    possessionLosses40: null,
    foulsCommitted: 0,
    foulsReceived: 0,
    criticalFoulsCommitted: 0,
    criticalFoulsReceived: 0,
    foulsCommittedPerMatch: null,
    foulsCommitted40: null,
    foulsReceivedPerMatch: null,
    foulsReceived40: null,
    criticalFoulsCommittedPerMatch: null,
    criticalFoulsCommitted40: null,
    criticalFoulsReceivedPerMatch: null,
    criticalFoulsReceived40: null,
    yellowCards: 0,
    redCards: 0,
    onCourtPoints: 0,
    onCourtPointsPerMatch: null,
    onCourt: {
      threatsFor: 0, threatsAgainst: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0,
      foulsFor: 0, foulsAgainst: 0, threatsFor40: null, threatsAgainst40: null,
      threatDifference40: null, goalsFor40: null, goalsAgainst40: null,
      goalDifference40: null, foulsFor40: null, foulsAgainst40: null,
      threatsForOnTarget: 0, threatsAgainstOnTarget: 0, threatsForNear: 0, threatsAgainstNear: 0,
    },
    lowSample: true,
    trend: [],
  };
}

function zoneCollection<T extends string>(zones: readonly T[]): ZoneStats<T>[] {
  return zones.map((zone) => ({ zone, threats: 0, goals: 0, saves: 0, outside: 0, goalPercentage: null, savePercentage: null }));
}

function finishZones<T extends string>(zones: ZoneStats<T>[]): void {
  for (const zone of zones) {
    zone.goalPercentage = zone.threats > 0 ? zone.goals / zone.threats * 100 : null;
    const inside = zone.saves + zone.goals;
    zone.savePercentage = inside > 0 ? zone.saves / inside * 100 : null;
  }
}

export function buildDashboardAnalysis(
  records: readonly DashboardMatchRecord[],
  scope: AnalysisScope,
): DashboardAnalysis {
  const selected = filterAnalysisMatches(records, scope);
  const period = scope.period ?? "ALL";
  const dashboardScope: DashboardScope = {
    clubId: scope.clubId,
    teamId: scope.teamId,
    seasonId: scope.seasonId,
    matchId: scope.matchId,
    period: scope.period,
    includeArchived: scope.includeArchived,
  };
  const analytics = buildDashboardAnalytics(selected, dashboardScope);
  const totalMinutes = selected.reduce((sum, record) => sum + observedMinutes(record.session, period), 0);
  const playerMap = new Map<string, PlayerAnalysis>();
  const criticalFouls = { for: 0, against: 0 };
  const pitchZones = zoneCollection(["Z1", "Z2", "Z3", "Z4", "Z5", "Z6"] as const);
  const goalZones = zoneCollection(["LEFT_HIGH", "CENTER_HIGH", "RIGHT_HIGH", "LEFT_LOW", "CENTER_LOW", "RIGHT_LOW"] as const);
  const emptyPlayingState = (): PlayingStateAnalytics => ({
    minutes: 0, matchesWithState: 0, minutesPerMatch: null, minutesPerMatchWithState: null,
    threatsFor: 0, threatsAgainst: 0, goalsFor: 0, goalsAgainst: 0, onTargetFor: 0, onTargetAgainst: 0,
  });
  const flyingGoalkeeper = {
    for: emptyPlayingState(),
    against: emptyPlayingState(),
  };

  const trends = selected.map((record) => {
    const one = buildDashboardAnalytics([record], { ...dashboardScope, matchId: record.catalog.matchId });
    const threats = record.session.events.filter((event): event is ThreatRecordedEvent => event.type === "threat_recorded" && event.deletedAt === null && (period === "ALL" || event.period === period));
    const shotsOnTarget = threats.filter((event) => event.side === "FOR" && (event.outcome === "GOL" || event.outcome === "PARADA")).length;
    const threatsOnTarget = threats.filter((event) => event.side === "AGAINST" && (event.outcome === "GOL" || event.outcome === "PARADA")).length;
    const shotsNear = threats.filter((event) => event.side === "FOR" && ["Z1", "Z2", "Z3"].includes(derivePitchOriginZone(event.origin))).length;
    const threatsNear = threats.filter((event) => event.side === "AGAINST" && ["Z1", "Z2", "Z3"].includes(derivePitchOriginZone(event.origin))).length;
    const saves = one.threats.AGAINST.PARADA;
    const goals = one.threats.AGAINST.GOL;
    return { matchId: record.catalog.matchId, opponent: record.catalog.opponent, date: record.catalog.date, venue: record.catalog.venue, result: resultFor(record), threatsFor: one.threats.FOR.total, threatsAgainst: one.threats.AGAINST.total, goalsFor: one.goalsFor, goalsAgainst: one.goalsAgainst, shotsOnTarget, threatsOnTarget, shotsNear, threatsNear, savePercentage: saves + goals > 0 ? saves / (saves + goals) * 100 : null, pjForMinutes: 0, pjAgainstMinutes: 0 };
  }).sort((a, b) => a.date.localeCompare(b.date));

  for (const record of selected) {
    const { session } = record;
    const events = eventsFor(session, period);
    const replay = replayMatch(session.players, events, { currentClock: endClock(session, period) });
    const matchObserved = observedMinutes(session, period);
    const squad = new Set(events.filter((event) => event.type === "lineup_initialized").flatMap((event) => event.type === "lineup_initialized" ? event.squadPlayerIds : []));
    const matchOnCourtScore = new Map<string, { goalsFor: number; goalsAgainst: number }>();
    const matchEnd = deriveGlobalMinute(endClock(session, period).period, endClock(session, period).minute);
    replay.timeline.forEach((entry, index) => {
      const start = deriveGlobalMinute(entry.event.period, entry.event.minute);
      const next = replay.timeline[index + 1];
      const finish = Math.min(matchEnd, next ? deriveGlobalMinute(next.event.period, next.event.minute) : matchEnd);
      const targets = [
        ...(entry.gameContexts.includes("FLYING_GOALKEEPER") ? [flyingGoalkeeper.for] : []),
        ...(entry.gameContexts.includes("FLYING_GOALKEEPER_AGAINST") ? [flyingGoalkeeper.against] : []),
      ];
      for (const target of targets) {
        if (finish > start) target.minutes += finish - start;
        if (entry.event.type === "threat_recorded") {
          if (entry.event.side === "FOR") target.threatsFor += 1;
          else target.threatsAgainst += 1;
          if (entry.event.outcome === "GOL") {
            if (entry.event.side === "FOR") target.goalsFor += 1;
            else target.goalsAgainst += 1;
          }
        }
      }
    });
    for (const snapshot of session.players) {
      const player = playerMap.get(snapshot.id) ?? createPlayer(snapshot);
      const minutes = replay.playerMinutes[snapshot.id]?.totalMinutes ?? 0;
      player.minutes += minutes;
      if (minutes > 0 || replay.timeline.some((entry) => entry.lineupPlayerIds.includes(snapshot.id))) player.matches += 1;
      if (squad.has(snapshot.id)) player.availableMinutes += matchObserved;
      const target = session.preparation?.targetMinutes[snapshot.id];
      if (target !== undefined) player.targetMinutes = (player.targetMinutes ?? 0) + target;
      player.trend.push({ matchId: session.matchId, opponent: record.catalog.opponent, date: record.catalog.date, minutes, goals: 0, assists: 0, threats: 0, goalsForOnCourt: 0, goalsAgainstOnCourt: 0, pointsOnCourt: 0, keyMinutes: 0, goldMinutes: 0 });
      playerMap.set(snapshot.id, player);
    }
    for (const entry of replay.timeline) {
      const event = entry.event;
      for (const playerId of entry.lineupPlayerIds) {
        const player = playerMap.get(playerId);
        if (player) addOnCourtEvent(player, event);
        if (event.type === "threat_recorded" && event.outcome === "GOL") {
          const score = matchOnCourtScore.get(playerId) ?? { goalsFor: 0, goalsAgainst: 0 };
          if (event.side === "FOR") score.goalsFor += 1;
          else score.goalsAgainst += 1;
          matchOnCourtScore.set(playerId, score);
        }
      }
      if (event.type === "threat_recorded" && event.side === "FOR" && event.playerId) {
        const player = playerMap.get(event.playerId);
        if (player) {
          player.ownThreats += 1;
          if (event.outcome === "GOL" || event.outcome === "PARADA") player.ownOnTarget += 1;
          if (["Z1", "Z2", "Z3"].includes(derivePitchOriginZone(event.origin))) player.ownNear += 1;
          const trend = player.trend.find((item) => item.matchId === session.matchId);
          if (trend) trend.threats += 1;
          player.ownOutcomes[event.outcome] += 1;
          player.ownShotPoints.push({ eventId: event.id, matchId: session.matchId, side: "FOR", x: event.origin.x, y: event.origin.y, outcome: event.outcome });
          if (event.outcome === "GOL") { player.goals += 1; if (trend) trend.goals += 1; }
        }
      }
      if (event.type === "threat_recorded" && event.side === "FOR" && event.outcome === "GOL" && event.assist?.status === "PLAYER") {
        const assistant = playerMap.get(event.assist.playerId);
        if (assistant) { assistant.assists += 1; const trend = assistant.trend.find((item) => item.matchId === session.matchId); if (trend) trend.assists += 1; }
      }
      if (event.type === "foul_recorded") {
        const critical = (entry.periodFoulNumber ?? 0) >= 5;
        if (critical) criticalFouls[event.side === "FOR" ? "for" : "against"] += 1;
        if (event.playerId) {
          const player = playerMap.get(event.playerId);
          if (player) {
            if (event.side === "FOR") {
              player.foulsCommitted += 1;
              if (critical) player.criticalFoulsCommitted += 1;
            } else {
              player.foulsReceived += 1;
              if (critical) player.criticalFoulsReceived += 1;
            }
          }
        }
      }
      if (event.type === "card_recorded" && event.side === "FOR" && event.playerId) {
        const player = playerMap.get(event.playerId);
        if (player) {
          if (event.color === "YELLOW") player.yellowCards += 1;
          else player.redCards += 1;
        }
      }
      if (event.type === "threat_recorded" && event.side === "AGAINST") {
        const zone = derivePitchOriginZone(event.origin);
        const stats = pitchZones.find((candidate) => candidate.zone === zone)!;
        stats.threats += 1;
        if (event.outcome === "GOL") stats.goals += 1;
        if (event.outcome === "PARADA") stats.saves += 1;
        if (event.outcome === "FUERA") stats.outside += 1;
        if (event.defensive && event.outcome !== "FUERA") {
          const goalZone = deriveGoalZoneV1(event.defensive.goalTarget, GOAL_FRAME);
          if (!goalZone.startsWith("OUT_")) {
            const target = goalZones.find((candidate) => candidate.zone === goalZone)!;
            target.threats += 1;
            if (event.outcome === "GOL") target.goals += 1;
            if (event.outcome === "PARADA") target.saves += 1;
          }
        }
      }
      if (event.type === "possession_lost") {
        const player = playerMap.get(event.playerId);
        if (player) player.possessionLosses += 1;
      }
    }
    for (const [playerId, score] of Array.from(matchOnCourtScore.entries())) {
      const player = playerMap.get(playerId);
      if (!player || (replay.playerMinutes[playerId]?.totalMinutes ?? 0) <= 0) continue;
      player.onCourtPoints += score.goalsFor > score.goalsAgainst ? 3 : score.goalsFor === score.goalsAgainst ? 1 : 0;
      const trend = player.trend.find((item) => item.matchId === session.matchId);
      if (trend) { trend.goalsForOnCourt = score.goalsFor; trend.goalsAgainstOnCourt = score.goalsAgainst; trend.pointsOnCourt = score.goalsFor > score.goalsAgainst ? 3 : score.goalsFor === score.goalsAgainst ? 1 : 0; }
    }
    for (const snapshot of session.players) {
      const player = playerMap.get(snapshot.id);
      if (!player || (replay.playerMinutes[snapshot.id]?.totalMinutes ?? 0) <= 0 || matchOnCourtScore.has(snapshot.id)) continue;
      player.onCourtPoints += 1;
      const trend = player.trend.find((item) => item.matchId === session.matchId);
      if (trend) trend.pointsOnCourt = 1;
    }
  }

  const players = Array.from(playerMap.values()).filter((player) => player.matches > 0 || player.minutes > 0 || player.ownThreats > 0);
  for (const player of players) finalizePlayer(player);
  const goalkeepers: GoalkeeperAnalysis[] = analytics.goalkeepers.map((keeper) => ({
    ...keeper,
    threatsAgainst40: per40(keeper.threatsAgainst, keeper.minutes),
    interiorThreats: keeper.saves + keeper.goalsAgainst,
    goalsAgainst40: per40(keeper.goalsAgainst, keeper.minutes),
    goalPoints: analytics.goalPoints.filter((point) => {
      const record = selected.find((candidate) => candidate.session.matchId === point.matchId);
      const event = record?.session.events.find((candidate): candidate is ThreatRecordedEvent => candidate.id === point.eventId && candidate.type === "threat_recorded");
      if (!record || !event) return false;
      return normalGoalkeeperForThreat(record.session, event) === keeper.playerId;
    }),
    originPoints: analytics.pitchPoints.filter((point) => {
      if (point.side !== "AGAINST") return false;
      const record = selected.find((candidate) => candidate.session.matchId === point.matchId);
      const event = record?.session.events.find((candidate): candidate is ThreatRecordedEvent => candidate.id === point.eventId && candidate.type === "threat_recorded");
      return Boolean(record && event && normalGoalkeeperForThreat(record.session, event) === keeper.playerId);
    }),
    keyMinutes: 0,
    keyMinutesPercentage: null,
    goldMinutes: 0,
    goldMinutesPercentage: null,
  }));
  finishZones(pitchZones);
  finishZones(goalZones);
  return {
    records: selected,
    samples: selected.filter((record) => observedMinutes(record.session, period) > 0).length,
    analytics,
    rates: {
      observedMinutes: totalMinutes,
      threatsFor40: per40(analytics.threats.FOR.total, totalMinutes),
      threatsAgainst40: per40(analytics.threats.AGAINST.total, totalMinutes),
      goalsFor40: per40(analytics.goalsFor, totalMinutes),
      goalsAgainst40: per40(analytics.goalsAgainst, totalMinutes),
      foulsFor40: per40(analytics.discipline.for.fouls, totalMinutes),
      foulsAgainst40: per40(analytics.discipline.against.fouls, totalMinutes),
      possessionLosses40: per40(selected.flatMap((record) => record.session.events).filter((event) => event.deletedAt === null && event.type === "possession_lost").length, totalMinutes),
    },
    players: players.sort((a, b) => b.minutes - a.minutes || a.number - b.number),
    goalkeepers,
    teamKeyMinutes: 0,
    teamGoldMinutes: 0,
    trends,
    pitchZones,
    goalZones,
    criticalFouls,
    possessionLosses: selected.flatMap((record) => record.session.events).filter((event) => event.deletedAt === null && event.type === "possession_lost").length,
    flyingGoalkeeper,
  };
}

export function analysisMetric(analysis: DashboardAnalysis, metric: "threatsFor" | "threatsAgainst" | "goalsFor" | "goalsAgainst"): number {
  if (metric === "threatsFor") return analysis.analytics.threats.FOR.total;
  if (metric === "threatsAgainst") return analysis.analytics.threats.AGAINST.total;
  if (metric === "goalsFor") return analysis.analytics.goalsFor;
  return analysis.analytics.goalsAgainst;
}

export function compareAnalysisMetric(
  analysis: DashboardAnalysis,
  reference: DashboardAnalysis,
  metric: "threatsFor" | "threatsAgainst" | "goalsFor" | "goalsAgainst",
): MetricComparison {
  return compareToAverage(analysisMetric(analysis, metric), analysisMetric(reference, metric), reference.samples);
}
