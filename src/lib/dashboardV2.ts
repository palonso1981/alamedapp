import {
  CompetitionType,
  MatchEvent,
  ThreatOutcome,
  ThreatPhase,
  ThreatRecordedEvent,
} from "../types";
import {
  DashboardMatchRecord,
  DashboardPeriod,
  filterDashboardMatches,
} from "./dashboardAnalytics";
import {
  AnalysisScope,
  buildDashboardAnalysis,
  DashboardAnalysis,
  PitchOriginZone,
  PlayerAnalysis,
  per40,
  ResultFilter,
  VenueFilter,
} from "./dashboardAnalysis";
import { effectiveThreatPhase, replayMatch } from "./matchEngine";
import { deriveGoalZoneV1, GoalZoneV1 } from "./spatialZones";
import { GOAL_FRAME } from "./goalTarget";
import { CompetitiveContext, competitiveEventIds, deriveCompetitiveMinutes, deriveCompetitiveProjection, PlayingStateContext, ScoreStateContext } from "./dashboardCompetitiveContext";

export type DashboardValueMode = "TOTALS" | "PER_MATCH" | "PER_40";
export type DashboardArea = "SUMMARY" | "TEAM" | "PLAYERS" | "GOALKEEPERS" | "MAPS";
export type DashboardPhaseFilter = ThreatPhase | "SET_PIECE";
export type DashboardCompetition = CompetitionType | "UNSPECIFIED" | "ALL";
export type DashboardReferencePreset =
  | "SEASON"
  | "HOME"
  | "AWAY"
  | "WINS"
  | "DRAWS"
  | "LOSSES"
  | "P1"
  | "P2"
  | "FILTERED"
  | "MATCH"
  | "CUSTOM";

export interface DashboardScopeV2 {
  clubId: string;
  teamId: string;
  seasonId: string;
  competition: DashboardCompetition;
  matchIds: string[];
  period: DashboardPeriod;
  venues: Exclude<VenueFilter, "ALL">[];
  results: Exclude<ResultFilter, "ALL">[];
  rivals: string[];
  phases: DashboardPhaseFilter[];
  playerIds: string[];
  goalkeeperIds: string[];
  originZones: PitchOriginZone[];
  targetZones: GoalZoneV1[];
  outcomes: ThreatOutcome[];
  outcomeGroup: "ALL" | "ON_TARGET";
  originDistance: "ALL" | "NEAR" | "FAR";
  competitiveContext: CompetitiveContext;
  playingState: PlayingStateContext;
  scoreState: ScoreStateContext;
  includeArchived: boolean;
}

export interface DashboardViewState {
  analysis: DashboardScopeV2;
  reference: DashboardScopeV2;
  referencePreset: DashboardReferencePreset;
  mode: DashboardValueMode;
  area: DashboardArea;
}

export interface OutcomeDistributionItem {
  outcome: ThreatOutcome;
  count: number;
  percentage: number | null;
}

export interface DerivedThreatSummary {
  total: number;
  onTarget: number;
  onTargetPercentage: number | null;
  near: number;
  nearPercentage: number | null;
}

export function derivedThreatSummary(events: readonly MatchEvent[], side: "FOR" | "AGAINST"): DerivedThreatSummary {
  const threats = events.filter((event): event is ThreatRecordedEvent => event.type === "threat_recorded" && event.deletedAt === null && event.side === side);
  const onTarget = threats.filter((event) => event.outcome === "GOL" || event.outcome === "PARADA").length;
  const near = threats.filter((event) => ["Z1", "Z2", "Z3"].includes(originZone(event))).length;
  return { total: threats.length, onTarget, onTargetPercentage: threats.length ? onTarget / threats.length * 100 : null, near, nearPercentage: threats.length ? near / threats.length * 100 : null };
}

export interface PlayerScore {
  playerId: string;
  score: number | null;
  raw: number | null;
  production: number | null;
  onCourt: number | null;
  reliability: number;
  minutes: number;
  sampleSize: number;
}

export const SCORE_FULL_RELIABILITY_MINUTES = 80;
export const SET_PIECE_PHASES: ThreatPhase[] = [
  "SET_PIECE_CORNER",
  "SET_PIECE_FREE_KICK",
  "SET_PIECE_KICK_IN",
];

export function emptyDashboardScope(
  clubId = "",
  teamId = "",
  seasonId = "",
): DashboardScopeV2 {
  return {
    clubId,
    teamId,
    seasonId,
    competition: "ALL",
    matchIds: [],
    period: "ALL",
    venues: [],
    results: [],
    rivals: [],
    phases: [],
    playerIds: [],
    goalkeeperIds: [],
    originZones: [],
    targetZones: [],
    outcomes: [],
    outcomeGroup: "ALL",
    originDistance: "ALL",
    competitiveContext: "ALL",
    playingState: "ALL",
    scoreState: "ALL",
    includeArchived: false,
  };
}

/** Referencia independiente pero homogénea en periodo y filtros de evento. */
export function referenceScopeForPreset(
  analysis: DashboardScopeV2,
  preset: DashboardReferencePreset,
): DashboardScopeV2 {
  const reference: DashboardScopeV2 = {
    ...analysis,
    matchIds: [],
    rivals: [],
    playerIds: [],
    goalkeeperIds: [],
    venues: [],
    results: [],
  };
  if (preset === "HOME") reference.venues = ["HOME"];
  if (preset === "AWAY") reference.venues = ["AWAY"];
  if (preset === "WINS") reference.results = ["WIN"];
  if (preset === "DRAWS") reference.results = ["DRAW"];
  if (preset === "LOSSES") reference.results = ["LOSS"];
  if (preset === "P1") reference.period = 1;
  if (preset === "P2") reference.period = 2;
  if (preset === "FILTERED") return { ...analysis, matchIds: [] };
  // MATCH y CUSTOM conservan un scope explícito gestionado por la interfaz.
  // Este fallback solo se usa al inicializarlos por primera vez.
  if (preset === "MATCH" || preset === "CUSTOM") return reference;
  return reference;
}

/** Una comparación primaria nunca enfrenta acumulados de muestras distintas. */
export function homogeneousComparisonMode(
  analysisSamples: number,
  referenceSamples: number,
  requested: DashboardValueMode,
): DashboardValueMode {
  if (requested !== "TOTALS") return requested;
  return analysisSamples === 1 && referenceSamples === 1 ? "TOTALS" : "PER_MATCH";
}

function matchResult(record: DashboardMatchRecord): Exclude<ResultFilter, "ALL"> | null {
  if (!record.session.matchFinished && record.catalog.status !== "FINISHED") return null;
  const score = replayMatch(record.session.players, record.session.events).score;
  return score.for > score.against ? "WIN" : score.for < score.against ? "LOSS" : "DRAW";
}

function phaseMatches(
  selected: readonly DashboardPhaseFilter[],
  phase: ThreatPhase,
): boolean {
  if (selected.length === 0) return true;
  return selected.some((candidate) =>
    candidate === "SET_PIECE" ? SET_PIECE_PHASES.includes(phase) : candidate === phase,
  );
}

function threatMatches(
  event: ThreatRecordedEvent,
  record: DashboardMatchRecord,
  scope: DashboardScopeV2,
): boolean {
  if (!phaseMatches(scope.phases, effectiveThreatPhase(record.session.events, event))) return false;
  if (scope.outcomes.length > 0 && !scope.outcomes.includes(event.outcome)) return false;
  if (scope.outcomeGroup === "ON_TARGET" && event.outcome !== "GOL" && event.outcome !== "PARADA") return false;
  if (scope.originDistance !== "ALL") {
    const near = ["Z1", "Z2", "Z3"].includes(originZone(event));
    if ((scope.originDistance === "NEAR") !== near) return false;
  }
  if (scope.originZones.length > 0 && !scope.originZones.includes(originZone(event))) return false;
  if (scope.targetZones.length > 0) {
    if (!event.defensive || event.outcome === "FUERA") return false;
    const target = deriveGoalZoneV1(event.defensive.goalTarget, GOAL_FRAME);
    if (target.startsWith("OUT_") || !scope.targetZones.includes(target as GoalZoneV1)) return false;
  }
  if (scope.playerIds.length > 0 && (!event.playerId || !scope.playerIds.includes(event.playerId))) return false;
  return true;
}

export function matchCompetition(record: DashboardMatchRecord): Exclude<DashboardCompetition, "ALL"> {
  return record.session.preparation?.competitionType ?? "UNSPECIFIED";
}

export function defaultDashboardCompetition(records: readonly DashboardMatchRecord[], scope: Pick<DashboardScopeV2, "clubId" | "teamId" | "seasonId">): DashboardCompetition {
  const available = new Set(records.filter((record) => record.catalog.clubId === scope.clubId && record.catalog.teamId === scope.teamId && record.catalog.seasonId === scope.seasonId).map(matchCompetition));
  if (available.has("LEAGUE")) return "LEAGUE";
  return available.size === 1 ? Array.from(available)[0] : "ALL";
}

function originZone(event: ThreatRecordedEvent): PitchOriginZone {
  const far = event.origin.x >= 0.25;
  const lane = event.origin.y >= 2 / 3 ? 1 : event.origin.y <= 1 / 3 ? 3 : 2;
  return `Z${far ? lane + 3 : lane}` as PitchOriginZone;
}

function eventMatches(
  event: MatchEvent,
  record: DashboardMatchRecord,
  scope: DashboardScopeV2,
): boolean {
  if (scope.period !== "ALL" && event.period !== scope.period) return false;
  if (event.type === "threat_recorded") return threatMatches(event, record, scope);
  if (scope.playerIds.length > 0 && (event.type === "foul_recorded" || event.type === "card_recorded" || event.type === "possession_lost")) {
    return Boolean(event.playerId && scope.playerIds.includes(event.playerId));
  }
  return true;
}

/**
 * Construye una vista efímera del event log. Los eventos estructurales se conservan
 * para que replay reconstruya alineaciones; nunca se persisten agregados ni filtros.
 */
export function filterDashboardDataset(
  records: readonly DashboardMatchRecord[],
  scope: DashboardScopeV2,
): DashboardMatchRecord[] {
  const base = filterDashboardMatches(records, {
    clubId: scope.clubId,
    teamId: scope.teamId,
    seasonId: scope.seasonId,
    period: scope.period,
    includeArchived: scope.includeArchived,
  });
  return base
    .filter((record) => scope.matchIds.length === 0 || scope.matchIds.includes(record.catalog.matchId))
    .filter((record) => scope.competition === "ALL" || matchCompetition(record) === scope.competition)
    .filter((record) => scope.rivals.length === 0 || scope.rivals.includes(record.catalog.opponent))
    .filter((record) => scope.venues.length === 0 || scope.venues.includes(record.catalog.venue))
    .filter((record) => scope.results.length === 0 || Boolean(matchResult(record) && scope.results.includes(matchResult(record)!)))
    .map((record) => {
      const contextIds = competitiveEventIds(record.session, scope.period, scope.competitiveContext, scope.goalkeeperIds, scope.playingState, scope.scoreState);
      return {
        catalog: record.catalog,
        session: {
          ...record.session,
          events: record.session.events.filter((event) => {
          if (event.type === "lineup_initialized" || event.type === "substitution" || event.type === "game_state_changed") {
            return scope.period === "ALL" || event.period === scope.period;
          }
          if (!contextIds.has(event.id)) return false;
          return eventMatches(event, record, scope);
          }),
        },
      };
    });
}

export function buildDashboardV2(
  records: readonly DashboardMatchRecord[],
  scope: DashboardScopeV2,
): DashboardAnalysis {
  const filtered = filterDashboardDataset(records, scope);
  const analysisScope: AnalysisScope = {
    clubId: scope.clubId,
    teamId: scope.teamId,
    seasonId: scope.seasonId,
    period: scope.period,
    includeArchived: scope.includeArchived,
  };
  const analysis = buildDashboardAnalysis(filtered, analysisScope);
  const selectedIds = new Set(filtered.map((record) => record.catalog.matchId));
  const originals = records.filter((record) => selectedIds.has(record.catalog.matchId));
  const keyByPlayer: Record<string, number> = {};
  const goldByPlayer: Record<string, number> = {};
  const keyByGoalkeeper: Record<string, number> = {};
  const goldByGoalkeeper: Record<string, number> = {};
  const contextByPlayer: Record<string, number> = {};
  const contextByGoalkeeper: Record<string, number> = {};
  const contextMatchesByPlayer: Record<string, number> = {};
  let contextObserved = 0;
  let teamKeyMinutes = 0;
  let teamGoldMinutes = 0;
  for (const record of originals) {
    const key = deriveCompetitiveMinutes(record.session, scope.period, "KEY", scope.goalkeeperIds, scope.playingState, scope.scoreState);
    const gold = deriveCompetitiveMinutes(record.session, scope.period, "GOLD", scope.goalkeeperIds, scope.playingState, scope.scoreState);
    const current = deriveCompetitiveMinutes(record.session, scope.period, scope.competitiveContext, scope.goalkeeperIds, scope.playingState, scope.scoreState);
    teamKeyMinutes += key.observed;
    teamGoldMinutes += gold.observed;
    contextObserved += current.observed;
    for (const [id, value] of Object.entries(key.byPlayer)) keyByPlayer[id] = (keyByPlayer[id] ?? 0) + value;
    for (const [id, value] of Object.entries(gold.byPlayer)) goldByPlayer[id] = (goldByPlayer[id] ?? 0) + value;
    for (const [id, value] of Object.entries(key.byGoalkeeper)) keyByGoalkeeper[id] = (keyByGoalkeeper[id] ?? 0) + value;
    for (const [id, value] of Object.entries(gold.byGoalkeeper)) goldByGoalkeeper[id] = (goldByGoalkeeper[id] ?? 0) + value;
    for (const [id, value] of Object.entries(current.byPlayer)) contextByPlayer[id] = (contextByPlayer[id] ?? 0) + value;
    for (const [id, value] of Object.entries(current.byGoalkeeper)) contextByGoalkeeper[id] = (contextByGoalkeeper[id] ?? 0) + value;
    for (const [id, value] of Object.entries(current.byPlayer)) if (value > 0) contextMatchesByPlayer[id] = (contextMatchesByPlayer[id] ?? 0) + 1;
    for (const player of analysis.players) {
      const trend = player.trend.find((item) => item.matchId === record.catalog.matchId);
      if (trend) { trend.keyMinutes = key.byPlayer[player.playerId] ?? 0; trend.goldMinutes = gold.byPlayer[player.playerId] ?? 0; }
    }
  }
  for (const player of analysis.players) {
    player.keyMinutes = keyByPlayer[player.playerId] ?? 0;
    player.goldMinutes = goldByPlayer[player.playerId] ?? 0;
    player.keyMinutesPerMatch = player.matches > 0 ? player.keyMinutes / player.matches : null;
    player.goldMinutesPerMatch = player.matches > 0 ? player.goldMinutes / player.matches : null;
    player.keyMinutesPercentage = chronologicalParticipationPercentage(player.keyMinutes, teamKeyMinutes);
    player.goldMinutesPercentage = chronologicalParticipationPercentage(player.goldMinutes, teamGoldMinutes);
    if (scope.competitiveContext !== "ALL" || scope.playingState !== "ALL" || scope.scoreState !== "ALL") {
      player.minutes = contextByPlayer[player.playerId] ?? 0;
      player.matches = contextMatchesByPlayer[player.playerId] ?? 0;
      player.averageMinutes = player.matches > 0 ? player.minutes / player.matches : null;
      player.keyMinutesPerMatch = player.matches > 0 ? player.keyMinutes / player.matches : null;
      player.goldMinutesPerMatch = player.matches > 0 ? player.goldMinutes / player.matches : null;
      player.participationPercentage = chronologicalParticipationPercentage(player.minutes, contextObserved);
      player.goalsPerMatch = player.matches > 0 ? player.goals / player.matches : null;
      player.goals40 = per40(player.goals, player.minutes);
      player.assistsPerMatch = player.matches > 0 ? player.assists / player.matches : null;
      player.assists40 = per40(player.assists, player.minutes);
      player.ownThreatsPerMatch = player.matches > 0 ? player.ownThreats / player.matches : null;
      player.ownThreats40 = per40(player.ownThreats, player.minutes);
      player.possessionLossesPerMatch = player.matches > 0 ? player.possessionLosses / player.matches : null;
      player.possessionLosses40 = per40(player.possessionLosses, player.minutes);
      player.foulsCommittedPerMatch = player.matches > 0 ? player.foulsCommitted / player.matches : null;
      player.foulsReceivedPerMatch = player.matches > 0 ? player.foulsReceived / player.matches : null;
      player.criticalFoulsCommittedPerMatch = player.matches > 0 ? player.criticalFoulsCommitted / player.matches : null;
      player.criticalFoulsReceivedPerMatch = player.matches > 0 ? player.criticalFoulsReceived / player.matches : null;
      player.foulsCommitted40 = per40(player.foulsCommitted, player.minutes);
      player.foulsReceived40 = per40(player.foulsReceived, player.minutes);
      player.criticalFoulsCommitted40 = per40(player.criticalFoulsCommitted, player.minutes);
      player.criticalFoulsReceived40 = per40(player.criticalFoulsReceived, player.minutes);
      player.onCourt.threatsFor40 = per40(player.onCourt.threatsFor, player.minutes);
      player.onCourt.threatsAgainst40 = per40(player.onCourt.threatsAgainst, player.minutes);
      player.onCourt.threatDifference40 = per40(player.onCourt.threatsFor - player.onCourt.threatsAgainst, player.minutes);
      player.onCourt.goalsFor40 = per40(player.onCourt.goalsFor, player.minutes);
      player.onCourt.goalsAgainst40 = per40(player.onCourt.goalsAgainst, player.minutes);
      player.onCourt.goalDifference40 = per40(player.onCourt.goalDifference, player.minutes);
      player.onCourtPointsPerMatch = player.matches > 0 ? player.onCourtPoints / player.matches : null;
      player.lowSample = player.minutes < 20;
    }
  }
  analysis.teamKeyMinutes = teamKeyMinutes;
  analysis.teamGoldMinutes = teamGoldMinutes;
  for (const goalkeeper of analysis.goalkeepers) {
    goalkeeper.keyMinutes = keyByGoalkeeper[goalkeeper.playerId] ?? 0;
    goalkeeper.goldMinutes = goldByGoalkeeper[goalkeeper.playerId] ?? 0;
    goalkeeper.keyMinutesPercentage = chronologicalParticipationPercentage(goalkeeper.keyMinutes, teamKeyMinutes);
    goalkeeper.goldMinutesPercentage = chronologicalParticipationPercentage(goalkeeper.goldMinutes, teamGoldMinutes);
  }
  if (scope.competitiveContext !== "ALL" || scope.playingState !== "ALL" || scope.scoreState !== "ALL") {
    for (const goalkeeper of analysis.goalkeepers) {
      goalkeeper.minutes = contextByGoalkeeper[goalkeeper.playerId] ?? 0;
      goalkeeper.threatsAgainst40 = per40(goalkeeper.threatsAgainst, goalkeeper.minutes);
      goalkeeper.goalsAgainst40 = per40(goalkeeper.goalsAgainst, goalkeeper.minutes);
    }
    analysis.rates.observedMinutes = contextObserved;
    analysis.rates.threatsFor40 = per40(analysis.analytics.threats.FOR.total, contextObserved);
    analysis.rates.threatsAgainst40 = per40(analysis.analytics.threats.AGAINST.total, contextObserved);
    analysis.rates.goalsFor40 = per40(analysis.analytics.goalsFor, contextObserved);
    analysis.rates.goalsAgainst40 = per40(analysis.analytics.goalsAgainst, contextObserved);
    analysis.rates.possessionLosses40 = per40(analysis.possessionLosses, contextObserved);
  }
  analysis.flyingGoalkeeper.for = summarizePlayingState(originals, scope, "PJ_CDA", analysis.samples);
  analysis.flyingGoalkeeper.against = summarizePlayingState(originals, scope, "PJ_RIVAL", analysis.samples);
  for (const trend of analysis.trends) {
    const record = originals.find((candidate) => candidate.catalog.matchId === trend.matchId);
    trend.pjForMinutes = record ? deriveCompetitiveProjection(record.session, scope.period, scope.competitiveContext, scope.goalkeeperIds, "PJ_CDA", scope.scoreState).observed : 0;
    trend.pjAgainstMinutes = record ? deriveCompetitiveProjection(record.session, scope.period, scope.competitiveContext, scope.goalkeeperIds, "PJ_RIVAL", scope.scoreState).observed : 0;
  }
  return analysis;
}

function summarizePlayingState(
  records: readonly DashboardMatchRecord[],
  scope: DashboardScopeV2,
  playingState: Exclude<PlayingStateContext, "ALL">,
  totalMatches: number,
) {
  let minutes = 0;
  let matchesWithState = 0;
  let threatsFor = 0;
  let threatsAgainst = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let onTargetFor = 0;
  let onTargetAgainst = 0;
  for (const record of records) {
    const projection = deriveCompetitiveProjection(record.session, scope.period, scope.competitiveContext, scope.goalkeeperIds, playingState, scope.scoreState);
    minutes += projection.observed;
    if (projection.observed > 0) matchesWithState += 1;
    for (const event of record.session.events) {
      if (event.deletedAt !== null || !projection.eventIds.has(event.id) || event.type !== "threat_recorded" || !eventMatches(event, record, scope)) continue;
      if (event.side === "FOR") {
        threatsFor += 1;
        if (event.outcome === "GOL") goalsFor += 1;
        if (event.outcome === "GOL" || event.outcome === "PARADA") onTargetFor += 1;
      } else {
        threatsAgainst += 1;
        if (event.outcome === "GOL") goalsAgainst += 1;
        if (event.outcome === "GOL" || event.outcome === "PARADA") onTargetAgainst += 1;
      }
    }
  }
  return {
    minutes,
    matchesWithState,
    minutesPerMatch: totalMatches > 0 ? minutes / totalMatches : null,
    minutesPerMatchWithState: matchesWithState > 0 ? minutes / matchesWithState : null,
    threatsFor,
    threatsAgainst,
    goalsFor,
    goalsAgainst,
    onTargetFor,
    onTargetAgainst,
  };
}

export function outcomeDistribution(
  counts: Record<ThreatOutcome, number> & { total: number },
): OutcomeDistributionItem[] {
  const outcomes: ThreatOutcome[] = counts.BLOQUEADO > 0
    ? ["GOL", "PARADA", "FUERA", "BLOQUEADO"]
    : ["GOL", "PARADA", "FUERA"];
  return outcomes.map((outcome) => ({
    outcome,
    count: counts[outcome],
    percentage: counts.total > 0 ? counts[outcome] / counts.total * 100 : null,
  }));
}

export type TeamMetricKey = "threatsFor" | "threatsAgainst" | "goalsFor" | "goalsAgainst" | "foulsFor" | "foulsAgainst" | "possessionLosses";

export function teamMetricValue(
  analysis: DashboardAnalysis,
  metric: TeamMetricKey,
  mode: DashboardValueMode,
): number | null {
  const total = metric === "threatsFor" ? analysis.analytics.threats.FOR.total
    : metric === "threatsAgainst" ? analysis.analytics.threats.AGAINST.total
      : metric === "goalsFor" ? analysis.analytics.goalsFor
        : metric === "goalsAgainst" ? analysis.analytics.goalsAgainst
          : metric === "foulsFor" ? analysis.analytics.discipline.for.fouls
            : metric === "foulsAgainst" ? analysis.analytics.discipline.against.fouls
              : analysis.possessionLosses;
  if (mode === "TOTALS") return total;
  if (mode === "PER_MATCH") return analysis.samples > 0 ? total / analysis.samples : null;
  return analysis.rates[
    metric === "threatsFor" ? "threatsFor40"
      : metric === "threatsAgainst" ? "threatsAgainst40"
        : metric === "goalsFor" ? "goalsFor40"
          : metric === "goalsAgainst" ? "goalsAgainst40"
            : metric === "foulsFor" ? "foulsFor40"
              : metric === "foulsAgainst" ? "foulsAgainst40" : "possessionLosses40"
  ];
}

export type PairedMetricId = "GOALS" | "THREATS" | "ON_TARGET" | "NEAR";
export interface PairedMetricValue { left: number | null; right: number | null; difference: number | null }

export function chronologicalParticipationPercentage(participantMinutes: number, teamChronologicalMinutes: number): number | null {
  return teamChronologicalMinutes > 0 ? participantMinutes / teamChronologicalMinutes * 100 : null;
}

export function teamPairedMetricValue(analysis: DashboardAnalysis, id: PairedMetricId, mode: DashboardValueMode): PairedMetricValue {
  const summaryFor = derivedThreatSummary(analysis.records.flatMap((record) => record.session.events), "FOR");
  const summaryAgainst = derivedThreatSummary(analysis.records.flatMap((record) => record.session.events), "AGAINST");
  const totals = id === "GOALS" ? [analysis.analytics.goalsFor, analysis.analytics.goalsAgainst]
    : id === "THREATS" ? [analysis.analytics.threats.FOR.total, analysis.analytics.threats.AGAINST.total]
      : id === "ON_TARGET" ? [summaryFor.onTarget, summaryAgainst.onTarget]
        : [summaryFor.near, summaryAgainst.near];
  const normalize = (value: number): number | null => mode === "TOTALS" ? value
    : mode === "PER_MATCH" ? analysis.samples > 0 ? value / analysis.samples : null
      : per40(value, analysis.rates.observedMinutes);
  const left = normalize(totals[0]);
  const right = normalize(totals[1]);
  return { left, right, difference: left === null || right === null ? null : left - right };
}

export function playerMetricValue(
  player: PlayerAnalysis,
  metric: "minutes" | "goals" | "assists" | "threats" | "possessionLosses" | "foulsCommitted" | "foulsReceived" | "criticalCommitted" | "criticalReceived" | "points",
  mode: DashboardValueMode,
): number | null {
  if (metric === "minutes") return mode === "PER_MATCH" ? player.averageMinutes : mode === "PER_40" ? null : player.minutes;
  const totals = {
    goals: player.goals,
    assists: player.assists,
    threats: player.ownThreats,
    possessionLosses: player.possessionLosses,
    foulsCommitted: player.foulsCommitted,
    foulsReceived: player.foulsReceived,
    criticalCommitted: player.criticalFoulsCommitted,
    criticalReceived: player.criticalFoulsReceived,
    points: player.onCourtPoints,
  };
  if (mode === "TOTALS") return totals[metric];
  if (mode === "PER_MATCH") return metric === "points" ? player.onCourtPointsPerMatch : player.matches > 0 ? totals[metric] / player.matches : null;
  if (metric === "points") return null;
  return player.minutes > 0 ? totals[metric] / player.minutes * 40 : null;
}

export function percentagePointsDifference(value: number | null, reference: number | null): number | null {
  return value === null || reference === null ? null : value - reference;
}

function percentile(value: number | null, values: readonly number[], inverse = false): number | null {
  if (value === null || values.length < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const less = sorted.filter((candidate) => candidate < value).length;
  const equal = sorted.filter((candidate) => candidate === value).length;
  const rank = less + (equal - 1) / 2;
  const result = sorted.length === 1 ? 50 : rank / (sorted.length - 1) * 100;
  return inverse ? 100 - result : result;
}

export function buildPlayerScores(players: readonly PlayerAnalysis[]): PlayerScore[] {
  const eligible = players.filter((player) => player.minutes > 0);
  const values = {
    goals: eligible.map((player) => player.goals40).filter((value): value is number => value !== null),
    assists: eligible.map((player) => player.assists40).filter((value): value is number => value !== null),
    threats: eligible.map((player) => player.ownThreats40).filter((value): value is number => value !== null),
    teamThreats: eligible.map((player) => player.onCourt.threatsFor40).filter((value): value is number => value !== null),
    concededThreats: eligible.map((player) => player.onCourt.threatsAgainst40).filter((value): value is number => value !== null),
    points: eligible.map((player) => player.onCourtPointsPerMatch).filter((value): value is number => value !== null),
  };
  return players.map((player) => {
    const productionParts = [
      percentile(player.goals40, values.goals),
      percentile(player.assists40, values.assists),
      percentile(player.ownThreats40, values.threats),
    ];
    const onCourtParts = [
      percentile(player.onCourt.threatsFor40, values.teamThreats),
      percentile(player.onCourt.threatsAgainst40, values.concededThreats, true),
      percentile(player.onCourtPointsPerMatch, values.points),
    ];
    const validAverage = (parts: Array<number | null>) => parts.every((part) => part !== null)
      ? parts.reduce<number>((sum, part) => sum + (part ?? 0), 0) / parts.length
      : null;
    const production = eligible.length >= 3 ? validAverage(productionParts) : null;
    const onCourt = eligible.length >= 3 ? validAverage(onCourtParts) : null;
    const raw = production === null || onCourt === null ? null : (production + onCourt) / 2;
    const reliability = Math.min(1, player.minutes / SCORE_FULL_RELIABILITY_MINUTES);
    return {
      playerId: player.playerId,
      score: raw === null ? null : 50 + reliability * (raw - 50),
      raw,
      production,
      onCourt,
      reliability,
      minutes: player.minutes,
      sampleSize: eligible.length,
    };
  });
}

export type SortDirection = "asc" | "desc";

export interface SquadAverage {
  value: number | null;
  eligiblePlayers: number;
  validValues: number;
}

/** Benchmark del jugador típico: primero deriva cada valor individual y después
 * calcula la media. Los N/D no se convierten en cero. */
export function squadAverage<T extends { minutes: number }>(items: readonly T[], value: (item: T) => number | null): SquadAverage {
  const eligible = items.filter((item) => item.minutes > 0);
  const values = eligible.map(value).filter((candidate): candidate is number => candidate !== null && Number.isFinite(candidate));
  return {
    value: values.length > 0 ? values.reduce((sum, candidate) => sum + candidate, 0) / values.length : null,
    eligiblePlayers: eligible.length,
    validValues: values.length,
  };
}

export function stableSortByMetric<T>(
  items: readonly T[],
  value: (item: T) => number | null,
  direction: SortDirection,
): T[] {
  return items.map((item, index) => ({ item, index, value: value(item) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      const delta = a.value - b.value;
      return (direction === "asc" ? delta : -delta) || a.index - b.index;
    })
    .map(({ item }) => item);
}

const LIST_KEYS = ["matchIds", "venues", "results", "rivals", "phases", "playerIds", "goalkeeperIds", "originZones", "targetZones", "outcomes"] as const;

export function scopeToSearchParams(scope: DashboardScopeV2, prefix: "a" | "r"): URLSearchParams {
  const params = new URLSearchParams();
  params.set(`${prefix}Club`, scope.clubId);
  params.set(`${prefix}Team`, scope.teamId);
  params.set(`${prefix}Season`, scope.seasonId);
  params.set(`${prefix}Competition`, scope.competition);
  if (scope.period !== "ALL") params.set(`${prefix}Period`, String(scope.period));
  if (scope.includeArchived) params.set(`${prefix}Archived`, "1");
  if (scope.outcomeGroup !== "ALL") params.set(`${prefix}OutcomeGroup`, scope.outcomeGroup);
  if (scope.originDistance !== "ALL") params.set(`${prefix}Distance`, scope.originDistance);
  if (scope.competitiveContext !== "ALL") params.set(`${prefix}Context`, scope.competitiveContext);
  if (scope.playingState !== "ALL") params.set(`${prefix}PJState`, scope.playingState);
  if (scope.scoreState !== "ALL") params.set(`${prefix}ScoreState`, scope.scoreState);
  for (const key of LIST_KEYS) if (scope[key].length > 0) params.set(`${prefix}${key}`, scope[key].join("~"));
  return params;
}

export function scopeFromSearchParams(
  params: URLSearchParams,
  prefix: "a" | "r",
  fallback: DashboardScopeV2,
): DashboardScopeV2 {
  const read = <T extends string>(key: typeof LIST_KEYS[number]) =>
    (params.get(`${prefix}${key}`)?.split("~").filter(Boolean) ?? fallback[key]) as T[];
  const period = params.get(`${prefix}Period`);
  return {
    ...fallback,
    clubId: params.get(`${prefix}Club`) ?? fallback.clubId,
    teamId: params.get(`${prefix}Team`) ?? fallback.teamId,
    seasonId: params.get(`${prefix}Season`) ?? fallback.seasonId,
    competition: (["ALL", "LEAGUE", "CUP", "FRIENDLY", "OTHER", "UNSPECIFIED"] as DashboardCompetition[]).includes(params.get(`${prefix}Competition`) as DashboardCompetition) ? params.get(`${prefix}Competition`) as DashboardCompetition : fallback.competition,
    period: period === "1" ? 1 : period === "2" ? 2 : fallback.period,
    includeArchived: params.get(`${prefix}Archived`) === "1" || fallback.includeArchived,
    outcomeGroup: params.get(`${prefix}OutcomeGroup`) === "ON_TARGET" ? "ON_TARGET" : fallback.outcomeGroup,
    originDistance: params.get(`${prefix}Distance`) === "NEAR" ? "NEAR" : params.get(`${prefix}Distance`) === "FAR" ? "FAR" : fallback.originDistance,
    competitiveContext: params.get(`${prefix}Context`) === "KEY" ? "KEY" : params.get(`${prefix}Context`) === "GOLD" ? "GOLD" : fallback.competitiveContext,
    playingState: params.get(`${prefix}PJState`) === "PJ_CDA" ? "PJ_CDA" : params.get(`${prefix}PJState`) === "PJ_RIVAL" ? "PJ_RIVAL" : fallback.playingState,
    scoreState: params.get(`${prefix}ScoreState`) === "LEADING" ? "LEADING" : params.get(`${prefix}ScoreState`) === "DRAWING" ? "DRAWING" : params.get(`${prefix}ScoreState`) === "TRAILING" ? "TRAILING" : fallback.scoreState,
    matchIds: read<string>("matchIds"),
    venues: read<Exclude<VenueFilter, "ALL">>("venues"),
    results: read<Exclude<ResultFilter, "ALL">>("results"),
    rivals: read<string>("rivals"),
    phases: read<DashboardPhaseFilter>("phases"),
    playerIds: read<string>("playerIds"),
    goalkeeperIds: read<string>("goalkeeperIds"),
    originZones: read<PitchOriginZone>("originZones"),
    targetZones: read<GoalZoneV1>("targetZones"),
    outcomes: read<ThreatOutcome>("outcomes"),
  };
}

export function hasDashboardScopeSearchParams(params: URLSearchParams, prefix: "a" | "r"): boolean {
  const scalarKeys = ["Club", "Team", "Season", "Competition", "Period", "Archived", "OutcomeGroup", "Distance", "Context", "PJState", "ScoreState"];
  return [...scalarKeys, ...LIST_KEYS].some((key) => params.has(`${prefix}${key}`));
}

export function mergeDashboardSearchParams(
  view: DashboardViewState,
  current?: URLSearchParams,
): string {
  const params = new URLSearchParams(current);
  for (const prefix of ["a", "r"] as const) {
    Array.from(params.keys()).filter((key) => key.startsWith(prefix)).forEach((key) => params.delete(key));
  }
  scopeToSearchParams(view.analysis, "a").forEach((value, key) => params.set(key, value));
  scopeToSearchParams(view.reference, "r").forEach((value, key) => params.set(key, value));
  params.set("mode", view.mode);
  params.set("area", view.area);
  params.set("reference", view.referencePreset);
  return params.toString();
}
