import {
  MatchEvent,
  ThreatOutcome,
  ThreatPhase,
  ThreatRecordedEvent,
} from "../types";
import {
  DashboardMatchRecord,
  DashboardPeriod,
  filterDashboardMatches,
  normalGoalkeeperForThreat,
} from "./dashboardAnalytics";
import {
  AnalysisScope,
  buildDashboardAnalysis,
  DashboardAnalysis,
  PitchOriginZone,
  PlayerAnalysis,
  ResultFilter,
  VenueFilter,
} from "./dashboardAnalysis";
import { effectiveThreatPhase, replayMatch } from "./matchEngine";
import { deriveGoalZoneV1, GoalZoneV1 } from "./spatialZones";
import { GOAL_FRAME } from "./goalTarget";

export type DashboardValueMode = "TOTALS" | "PER_MATCH" | "PER_40";
export type DashboardArea = "SUMMARY" | "TEAM" | "PLAYERS" | "GOALKEEPERS" | "MAPS";
export type DashboardPhaseFilter = ThreatPhase | "SET_PIECE";
export type DashboardReferencePreset =
  | "SEASON"
  | "HOME"
  | "AWAY"
  | "WINS"
  | "DRAWS"
  | "LOSSES"
  | "P1"
  | "P2"
  | "FILTERED";

export interface DashboardScopeV2 {
  clubId: string;
  teamId: string;
  seasonId: string;
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
  return reference;
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
  if (scope.originZones.length > 0 && !scope.originZones.includes(originZone(event))) return false;
  if (scope.targetZones.length > 0) {
    if (!event.defensive || event.outcome === "FUERA") return false;
    const target = deriveGoalZoneV1(event.defensive.goalTarget, GOAL_FRAME);
    if (target.startsWith("OUT_") || !scope.targetZones.includes(target as GoalZoneV1)) return false;
  }
  if (scope.playerIds.length > 0 && (!event.playerId || !scope.playerIds.includes(event.playerId))) return false;
  if (scope.goalkeeperIds.length > 0) {
    if (event.side !== "AGAINST") return false;
    const goalkeeperId = normalGoalkeeperForThreat(record.session, event);
    if (!goalkeeperId || !scope.goalkeeperIds.includes(goalkeeperId)) return false;
  }
  return true;
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
  if (scope.playerIds.length > 0 && (event.type === "foul_recorded" || event.type === "card_recorded")) {
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
    .filter((record) => scope.rivals.length === 0 || scope.rivals.includes(record.catalog.opponent))
    .filter((record) => scope.venues.length === 0 || scope.venues.includes(record.catalog.venue))
    .filter((record) => scope.results.length === 0 || Boolean(matchResult(record) && scope.results.includes(matchResult(record)!)))
    .map((record) => ({
      catalog: record.catalog,
      session: {
        ...record.session,
        events: record.session.events.filter((event) => {
          if (event.type === "lineup_initialized" || event.type === "substitution" || event.type === "game_state_changed") {
            return scope.period === "ALL" || event.period === scope.period;
          }
          return eventMatches(event, record, scope);
        }),
      },
    }));
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
  return buildDashboardAnalysis(filtered, analysisScope);
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

export type TeamMetricKey = "threatsFor" | "threatsAgainst" | "goalsFor" | "goalsAgainst" | "foulsFor" | "foulsAgainst";

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
            : analysis.analytics.discipline.against.fouls;
  if (mode === "TOTALS") return total;
  if (mode === "PER_MATCH") return analysis.samples > 0 ? total / analysis.samples : null;
  return analysis.rates[
    metric === "threatsFor" ? "threatsFor40"
      : metric === "threatsAgainst" ? "threatsAgainst40"
        : metric === "goalsFor" ? "goalsFor40"
          : metric === "goalsAgainst" ? "goalsAgainst40"
            : metric === "foulsFor" ? "foulsFor40" : "foulsAgainst40"
  ];
}

export function playerMetricValue(
  player: PlayerAnalysis,
  metric: "minutes" | "goals" | "assists" | "threats" | "foulsCommitted" | "foulsReceived" | "criticalCommitted" | "criticalReceived" | "points",
  mode: DashboardValueMode,
): number | null {
  if (metric === "minutes") return mode === "PER_MATCH" ? player.averageMinutes : mode === "PER_40" ? null : player.minutes;
  const totals = {
    goals: player.goals,
    assists: player.assists,
    threats: player.ownThreats,
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
  if (scope.period !== "ALL") params.set(`${prefix}Period`, String(scope.period));
  if (scope.includeArchived) params.set(`${prefix}Archived`, "1");
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
    period: period === "1" ? 1 : period === "2" ? 2 : fallback.period,
    includeArchived: params.get(`${prefix}Archived`) === "1" || fallback.includeArchived,
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
