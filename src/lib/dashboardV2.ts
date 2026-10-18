import {
  CompetitionType,
  MatchEvent,
  KeeperBodyPart,
  SaveOutcome,
  ThreatOutcome,
  ThreatPhase,
  ThreatRecordedEvent,
  ThreatSide,
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
  deriveThreatOriginZone,
  per40,
  ResultFilter,
  VenueFilter,
} from "./dashboardAnalysis";
import { effectiveThreatPhase, isActiveMatchEvent } from "./matchEngine";
import { replayDashboardMatch } from "./dashboardReplayCache";
import { deriveGoalZoneV1, GoalZoneV1 } from "./spatialZones";
import { GOAL_FRAME } from "./goalTarget";
import { CompetitiveContext, competitiveEventIds, deriveCompetitiveMinutes, deriveCompetitiveProjection, PlayingStateContext, ScoreStateContext } from "./dashboardCompetitiveContext";

export type DashboardValueMode = "TOTALS" | "PER_MATCH" | "PER_40";
export type DashboardArea = "SUMMARY" | "DATA" | "PLAYERS" | "GOALKEEPERS" | "COMBINATIONS" | "MAPS";
export const DASHBOARD_AREAS: readonly DashboardArea[] = ["SUMMARY", "DATA", "PLAYERS", "GOALKEEPERS", "COMBINATIONS", "MAPS"];
export function normalizeDashboardArea(value: string | null): DashboardArea {
  return value === "TEAM" ? "SUMMARY" : DASHBOARD_AREAS.includes(value as DashboardArea) ? value as DashboardArea : "SUMMARY";
}
export type DashboardPhaseFilter = ThreatPhase | "SET_PIECE";
export type DashboardCompetition = CompetitionType | "UNSPECIFIED" | "ALL";
export type DashboardSetPieceTraceability = "ALL_CLASSIFIED" | "LINKED_RESTART_ONLY";
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
  keeperBodyParts: KeeperBodyPart[];
  saveOutcomes: SaveOutcome[];
  threatSides: ThreatSide[];
  setPieceTraceability: DashboardSetPieceTraceability;
  outcomeGroup: "ALL" | "ON_TARGET";
  originDistance: "ALL" | "NEAR" | "FAR";
  competitiveContext: CompetitiveContext;
  playingState: PlayingStateContext;
  scoreState: ScoreStateContext;
  includeArchived: boolean;
}

export function dashboardActiveFilterCount(scope: DashboardScopeV2): number {
  return (scope.period === "ALL" ? 0 : 1)
    + scope.matchIds.length + scope.rivals.length + scope.venues.length + scope.results.length
    + scope.phases.length + scope.originZones.length + scope.targetZones.length + scope.outcomes.length
    + scope.keeperBodyParts.length + scope.saveOutcomes.length + scope.playerIds.length + scope.goalkeeperIds.length
    + scope.threatSides.length
    + (scope.outcomeGroup === "ALL" ? 0 : 1) + (scope.originDistance === "ALL" ? 0 : 1)
    + (scope.competitiveContext === "ALL" ? 0 : 1) + (scope.playingState === "ALL" ? 0 : 1)
    + (scope.scoreState === "ALL" ? 0 : 1) + (scope.setPieceTraceability === "ALL_CLASSIFIED" ? 0 : 1);
}

export interface DashboardViewState {
  analysis: DashboardScopeV2;
  reference: DashboardScopeV2;
  referencePreset: DashboardReferencePreset;
  mode: DashboardValueMode;
  area: DashboardArea;
  comparisonEnabled?: boolean;
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
  const threats = events.filter((event): event is ThreatRecordedEvent => event.type === "threat_recorded" && isActiveMatchEvent(event) && event.side === side);
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
    keeperBodyParts: [],
    saveOutcomes: [],
    threatSides: [],
    setPieceTraceability: "ALL_CLASSIFIED",
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
  const score = replayDashboardMatch(record.session.players, record.session.events).score;
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

export function threatMatches(
  event: ThreatRecordedEvent,
  record: DashboardMatchRecord,
  scope: DashboardScopeV2,
): boolean {
  if (scope.threatSides.length > 0 && !scope.threatSides.includes(event.side)) return false;
  if (scope.setPieceTraceability === "LINKED_RESTART_ONLY" && !linkedRestart(record.session.events, event)) return false;
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
  const keeperBodyPart = event.defensive?.version === 2 ? event.defensive.keeperBodyPart : undefined;
  if (scope.keeperBodyParts.length > 0 && (!keeperBodyPart || !scope.keeperBodyParts.includes(keeperBodyPart))) return false;
  if (scope.saveOutcomes.length > 0 && (!event.defensive?.saveOutcome || !scope.saveOutcomes.includes(event.defensive.saveOutcome))) return false;
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
  return deriveThreatOriginZone(event.origin, event.side);
}

export function normalizeDashboardCount(
  value: number,
  mode: DashboardValueMode,
  samples: number,
  observedMinutes: number,
): number | null {
  if (mode === "TOTALS") return value;
  if (mode === "PER_MATCH") return samples > 0 ? value / samples : null;
  return per40(value, observedMinutes);
}

export interface TeamThreatProfile {
  side: ThreatSide;
  total: number;
  goals: number;
  saves: number;
  outside: number;
  blocked: number;
  onTarget: number;
  near: number;
  pendingReview: number;
  conversionPercentage: number | null;
  onTargetPercentage: number | null;
  outsidePercentage: number | null;
  goalkeeperSavePercentage: number | null;
}

export function teamThreatProfile(events: readonly MatchEvent[], side: ThreatSide): TeamThreatProfile {
  const threats = events.filter((event): event is ThreatRecordedEvent => event.type === "threat_recorded" && isActiveMatchEvent(event) && event.side === side);
  const count = (outcome: ThreatOutcome) => threats.filter((event) => event.outcome === outcome).length;
  const goals = count("GOL");
  const saves = count("PARADA");
  const outside = count("FUERA");
  const blocked = count("BLOQUEADO");
  const total = threats.length;
  const onTarget = goals + saves;
  const rate = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator * 100 : null;
  return {
    side,
    total,
    goals,
    saves,
    outside,
    blocked,
    onTarget,
    near: threats.filter((event) => ["Z1", "Z2", "Z3"].includes(deriveThreatOriginZone(event.origin, side))).length,
    pendingReview: threats.filter((event) => event.pendingReview).length,
    conversionPercentage: rate(goals, total),
    onTargetPercentage: rate(onTarget, total),
    outsidePercentage: rate(outside, total),
    goalkeeperSavePercentage: rate(saves, onTarget),
  };
}

export function normalizedPhaseValue(
  analysis: DashboardAnalysis,
  phase: ThreatPhase,
  side: ThreatSide,
  mode: DashboardValueMode,
): number | null {
  return normalizeDashboardCount(analysis.analytics.phases[phase][side], mode, analysis.samples, analysis.rates.observedMinutes);
}

export interface PhaseImpactShare {
  phaseEvents: number;
  totalEvents: number;
  phaseGoals: number;
  totalGoals: number;
  volumePercentage: number | null;
  goalPercentage: number | null;
}

/** Peso de una fase sobre el volumen y sobre los goles del mismo lado. */
export function phaseImpactShare(records: readonly DashboardMatchRecord[], phase: ThreatPhase, side: ThreatSide): PhaseImpactShare {
  const entries = records.flatMap((record) => record.session.events
    .filter((event): event is ThreatRecordedEvent => event.type === "threat_recorded" && isActiveMatchEvent(event) && event.side === side)
    .map((event) => ({ event, phase: effectiveThreatPhase(record.session.events, event) })));
  const inPhase = entries.filter((entry) => entry.phase === phase);
  const totalGoals = entries.filter((entry) => entry.event.outcome === "GOL").length;
  const phaseGoals = inPhase.filter((entry) => entry.event.outcome === "GOL").length;
  return {
    phaseEvents: inPhase.length,
    totalEvents: entries.length,
    phaseGoals,
    totalGoals,
    volumePercentage: entries.length > 0 ? inPhase.length / entries.length * 100 : null,
    goalPercentage: totalGoals > 0 ? phaseGoals / totalGoals * 100 : null,
  };
}

export function phaseScaleMaximum(
  analysis: DashboardAnalysis,
  reference: DashboardAnalysis | undefined,
  phases: readonly ThreatPhase[],
  mode: DashboardValueMode,
): number {
  const values = phases.flatMap((phase) => [
    normalizedPhaseValue(analysis, phase, "FOR", mode),
    normalizedPhaseValue(analysis, phase, "AGAINST", mode),
    reference ? normalizedPhaseValue(reference, phase, "FOR", mode) : null,
    reference ? normalizedPhaseValue(reference, phase, "AGAINST", mode) : null,
  ]).filter((value): value is number => value !== null);
  return Math.max(1, ...values);
}

export interface SetPiecePerformance {
  phase: ThreatPhase;
  side: ThreatSide;
  opportunities: number | null;
  threats: number;
  onTarget: number;
  goals: number;
  linkedThreats: number;
  linkedOpportunities: number;
  linkageCoverage: number | null;
  threatYield: number | null;
  onTargetPercentage: number | null;
  goalPercentage: number | null;
}

export function setPiecePerformance(
  records: readonly DashboardMatchRecord[],
  phase: "SET_PIECE_CORNER" | "SET_PIECE_KICK_IN" | "SET_PIECE_FREE_KICK",
  side: ThreatSide,
): SetPiecePerformance {
  const threats: Array<{ event: ThreatRecordedEvent; events: readonly MatchEvent[] }> = [];
  const opportunityIds = new Set<string>();
  for (const record of records) {
    const active = record.session.events.filter(isActiveMatchEvent);
    if (phase !== "SET_PIECE_FREE_KICK") {
      const kind = phase === "SET_PIECE_CORNER" ? "CORNER" : "DANGEROUS_KICK_IN";
      active.forEach((event) => { if (event.type === "restart_recorded" && event.side === side && event.restart === kind) opportunityIds.add(event.id); });
    }
    active.forEach((event) => {
      if (event.type === "threat_recorded" && event.side === side && effectiveThreatPhase([...active], event) === phase) threats.push({ event, events: active });
    });
  }
  const linked = threats.map(({ event, events }) => linkedRestart(events, event)).filter((event) => event !== null);
  const linkedOpportunityIds = new Set(linked.map((event) => event.id));
  const rate = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator * 100 : null;
  const opportunities = phase === "SET_PIECE_FREE_KICK" ? null : opportunityIds.size;
  const onTarget = threats.filter(({ event }) => event.outcome === "GOL" || event.outcome === "PARADA").length;
  const goals = threats.filter(({ event }) => event.outcome === "GOL").length;
  return {
    phase,
    side,
    opportunities,
    threats: threats.length,
    onTarget,
    goals,
    linkedThreats: linked.length,
    linkedOpportunities: linkedOpportunityIds.size,
    linkageCoverage: rate(linked.length, threats.length),
    threatYield: opportunities === null ? null : rate(linkedOpportunityIds.size, opportunities),
    onTargetPercentage: rate(onTarget, threats.length),
    goalPercentage: rate(goals, threats.length),
  };
}

function rootThreat(events: readonly MatchEvent[], event: ThreatRecordedEvent): ThreatRecordedEvent {
  const byId = new Map(events.filter((candidate): candidate is ThreatRecordedEvent => candidate.type === "threat_recorded").map((candidate) => [candidate.id, candidate]));
  let current = event;
  const visited = new Set<string>();
  while (current.parentEventId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = byId.get(current.parentEventId);
    if (!parent) break;
    current = parent;
  }
  if (event.sequenceId) return byId.get(event.sequenceId) ?? current;
  return current;
}

export function linkedRestart(events: readonly MatchEvent[], event: ThreatRecordedEvent) {
  const root = rootThreat(events, event);
  if (!root.restartEventId) return null;
  const restart = events.find((candidate) => candidate.id === root.restartEventId);
  if (!restart || !isActiveMatchEvent(restart) || restart.type !== "restart_recorded" || restart.side !== root.side) return null;
  const phase = effectiveThreatPhase([...events], root);
  if (restart.restart === "CORNER" && phase !== "SET_PIECE_CORNER") return null;
  if (restart.restart === "DANGEROUS_KICK_IN" && phase !== "SET_PIECE_KICK_IN") return null;
  return restart;
}

export type SetPieceFunnelKind = "ALL" | "CORNER" | "KICK_IN";

export const SET_PIECE_FUNNEL_OPTIONS: ReadonlyArray<{ value: SetPieceFunnelKind; label: string }> = [
  { value: "ALL", label: "TODAS" },
  { value: "CORNER", label: "CÓRNER" },
  { value: "KICK_IN", label: "BANDA CERCANA" },
];

export function setPieceFunnelOpportunityLabel(kind: SetPieceFunnelKind): string {
  if (kind === "CORNER") return "CÓRNERS";
  if (kind === "KICK_IN") return "BANDAS CERCANAS";
  return "CÓRNER + BANDA CERCANA";
}

export interface SetPieceFunnelSide {
  opportunities: number;
  withShot: number;
  withOnTarget: number;
  withGoal: number;
  totalShots: number;
}

export interface SetPieceFunnelResult {
  kind: SetPieceFunnelKind;
  FOR: SetPieceFunnelSide;
  AGAINST: SetPieceFunnelSide;
  scaleMaximum: number;
}

function funnelKindForPhase(phase: ThreatPhase): Exclude<SetPieceFunnelKind, "ALL"> | null {
  if (phase === "SET_PIECE_CORNER") return "CORNER";
  if (phase === "SET_PIECE_KICK_IN") return "KICK_IN";
  return null;
}

function acceptsFunnelKind(selected: SetPieceFunnelKind, candidate: SetPieceFunnelKind | null): boolean {
  return candidate !== null && (selected === "ALL" || selected === candidate);
}

function summarizeFunnelOpportunities(opportunities: ReadonlyMap<string, readonly ThreatRecordedEvent[]>): SetPieceFunnelSide {
  const entries = Array.from(opportunities.values());
  return {
    opportunities: entries.length,
    withShot: entries.filter((shots) => shots.length > 0).length,
    withOnTarget: entries.filter((shots) => shots.some((shot) => shot.outcome === "GOL" || shot.outcome === "PARADA")).length,
    withGoal: entries.filter((shots) => shots.some((shot) => shot.outcome === "GOL")).length,
    totalShots: entries.reduce((total, shots) => total + shots.length, 0),
  };
}

/**
 * Embudo causal de córners y bandas cercanas. Ambas parten del reinicio explícito,
 * por lo que también conservan oportunidades sin remate. Faltas y penaltis quedan
 * deliberadamente fuera porque el histórico no conserva ubicación suficientemente
 * fiable para este análisis. Nunca se enlaza por proximidad.
 */
export function buildSetPieceFunnel(
  records: readonly DashboardMatchRecord[],
  kind: SetPieceFunnelKind = "ALL",
): SetPieceFunnelResult {
  const grouped: Record<ThreatSide, Map<string, ThreatRecordedEvent[]>> = {
    FOR: new Map(),
    AGAINST: new Map(),
  };

  for (const record of records) {
    const active = record.session.events.filter(isActiveMatchEvent);
    for (const event of active) {
      if (event.type !== "restart_recorded") continue;
      const restartKind = event.restart === "CORNER" ? "CORNER" : "KICK_IN";
      if (!acceptsFunnelKind(kind, restartKind)) continue;
      grouped[event.side].set(`${record.catalog.matchId}:restart:${event.id}`, []);
    }

    for (const event of active) {
      if (event.type !== "threat_recorded") continue;
      const phase = effectiveThreatPhase([...active], event);
      const eventKind = funnelKindForPhase(phase);
      if (!acceptsFunnelKind(kind, eventKind)) continue;

      const restart = linkedRestart(active, event);
      if (!restart) continue;
      const key = `${record.catalog.matchId}:restart:${restart.id}`;
      const shots = grouped[restart.side].get(key);
      if (shots) shots.push(event);
    }
  }

  const FOR = summarizeFunnelOpportunities(grouped.FOR);
  const AGAINST = summarizeFunnelOpportunities(grouped.AGAINST);
  return { kind, FOR, AGAINST, scaleMaximum: Math.max(1, FOR.opportunities, AGAINST.opportunities) };
}

export function setPieceFunnelPercentage(value: number, total: number): number | null {
  return total > 0 ? value / total * 100 : null;
}

export function setPieceFunnelWidth(value: number, scaleMaximum: number): number {
  return scaleMaximum > 0 ? Math.max(0, Math.min(100, value / scaleMaximum * 100)) : 0;
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
export function filterDashboardMatchSelection(
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
;
}

export function filterDashboardDataset(records: readonly DashboardMatchRecord[], scope: DashboardScopeV2): DashboardMatchRecord[] {
  return filterDashboardMatchSelection(records, scope)
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

/**
 * Devuelve los eventos que pertenecen directamente a la selección del Dashboard.
 * `filterDashboardDataset` conserva eventos de apoyo para replay y cálculos de
 * contexto; esos eventos no deben confundirse con el conjunto que abre VIDEO.
 */
export function filterDashboardEventSelection(
  records: readonly DashboardMatchRecord[],
  scope: DashboardScopeV2,
): DashboardMatchRecord[] {
  const filtered = filterDashboardDataset(records, scope);
  const hasThreatFilter = scope.phases.length > 0
    || scope.threatSides.length > 0
    || scope.setPieceTraceability !== "ALL_CLASSIFIED"
    || scope.outcomes.length > 0
    || scope.outcomeGroup !== "ALL"
    || scope.originDistance !== "ALL"
    || scope.originZones.length > 0
    || scope.targetZones.length > 0
    || scope.keeperBodyParts.length > 0
    || scope.saveOutcomes.length > 0;
  const hasPlayerFilter = scope.playerIds.length > 0;

  if (!hasThreatFilter && !hasPlayerFilter) return filtered;

  return filtered.map((record) => ({
    catalog: record.catalog,
    session: {
      ...record.session,
      events: record.session.events.filter((event) => {
        if (hasThreatFilter) return event.type === "threat_recorded";
        if (!hasPlayerFilter) return true;
        return event.type === "threat_recorded"
          || event.type === "foul_recorded"
          || event.type === "card_recorded"
          || event.type === "possession_lost";
      }),
    },
  }));
}

function buildDashboardV2Raw(
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
    trend.keyMinutes = record ? deriveCompetitiveProjection(record.session, scope.period, "KEY", scope.goalkeeperIds, scope.playingState, scope.scoreState).observed : 0;
    trend.goldMinutes = record ? deriveCompetitiveProjection(record.session, scope.period, "GOLD", scope.goalkeeperIds, scope.playingState, scope.scoreState).observed : 0;
  }
  return analysis;
}

/** Reserved for explicit snapshot regeneration and parity tests. */
export function buildDashboardV2Uncached(
  records: readonly DashboardMatchRecord[],
  scope: DashboardScopeV2,
): DashboardAnalysis {
  return buildDashboardV2Raw(records, scope);
}

export interface DashboardBuildMetrics {
  calls: number;
  cacheHits: number;
  rawBuilds: number;
  rawMilliseconds: number;
  matchesProcessed: number;
  eventsProcessed: number;
}

const DASHBOARD_ANALYSIS_CACHE_LIMIT = 240;
const dashboardAnalysisCache = new Map<string, DashboardAnalysis>();
const dashboardSourceFingerprintCache = new WeakMap<object, string>();
export interface DashboardSnapshotPlayerContext {
  playerId: string;
  availableMinutes: number;
  targetMinutes?: number;
  trend: PlayerAnalysis["trend"][number];
}

const registeredMatchSnapshots = new Map<string, { sourceFingerprint: string; analysis: DashboardAnalysis; playerContexts: DashboardSnapshotPlayerContext[] }>();
const dashboardBuildMetricsState: DashboardBuildMetrics = {
  calls: 0,
  cacheHits: 0,
  rawBuilds: 0,
  rawMilliseconds: 0,
  matchesProcessed: 0,
  eventsProcessed: 0,
};

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Fingerprint exclusively of sport/analytics source data. Video segments,
 * anchors, collections and other audiovisual metadata are intentionally not
 * included, so those edits never invalidate analytics.
 */
export function dashboardAnalyticsSourceFingerprint(record: DashboardMatchRecord): string {
  const cached = dashboardSourceFingerprintCache.get(record as object);
  if (cached) return cached;
  const preparation = record.session.preparation;
  const source = {
    matchId: record.catalog.matchId,
    status: record.catalog.status,
    archivedAt: record.catalog.archivedAt ?? null,
    deletedAt: record.catalog.deletedAt ?? null,
    preparation: preparation ? {
      clubId: preparation.clubId ?? null,
      teamId: preparation.teamId,
      seasonId: preparation.seasonId ?? null,
      opponent: preparation.opponent,
      venue: preparation.venue,
      date: preparation.date,
      competitionType: preparation.competitionType ?? null,
      status: preparation.status,
      calledPlayerIds: preparation.calledPlayerIds,
      starterPlayerIds: preparation.starterPlayerIds,
      startingGoalkeeperId: preparation.startingGoalkeeperId ?? null,
      targetMinutes: preparation.targetMinutes,
      archivedAt: preparation.archivedAt ?? null,
      deletedAt: preparation.deletedAt ?? null,
    } : null,
    players: record.session.players,
    period: record.session.period,
    minute: record.session.minute,
    closedPeriods: record.session.closedPeriods ?? [],
    matchFinished: record.session.matchFinished ?? false,
    events: record.session.events,
  };
  const fingerprint = `a1-${hashText(JSON.stringify(source))}`;
  dashboardSourceFingerprintCache.set(record as object, fingerprint);
  return fingerprint;
}

function normalizedScopeKey(scope: DashboardScopeV2): string {
  const normalized = {
    ...scope,
    matchIds: [...scope.matchIds].sort(),
    venues: [...scope.venues].sort(),
    results: [...scope.results].sort(),
    rivals: [...scope.rivals].sort(),
    phases: [...scope.phases].sort(),
    playerIds: [...scope.playerIds].sort(),
    goalkeeperIds: [...scope.goalkeeperIds].sort(),
    originZones: [...scope.originZones].sort(),
    targetZones: [...scope.targetZones].sort(),
    outcomes: [...scope.outcomes].sort(),
    keeperBodyParts: [...scope.keeperBodyParts].sort(),
    saveOutcomes: [...scope.saveOutcomes].sort(),
    threatSides: [...scope.threatSides].sort(),
  };
  return JSON.stringify(normalized);
}

export function dashboardAnalysisCacheKey(
  records: readonly DashboardMatchRecord[],
  scope: DashboardScopeV2,
): string {
  const sources = records
    .map((record) => `${record.catalog.matchId}:${dashboardAnalyticsSourceFingerprint(record)}`)
    .sort()
    .join("|");
  return `${sources}::${normalizedScopeKey(scope)}`;
}

function writeDashboardAnalysisCache(key: string, analysis: DashboardAnalysis): void {
  if (dashboardAnalysisCache.has(key)) dashboardAnalysisCache.delete(key);
  dashboardAnalysisCache.set(key, analysis);
  while (dashboardAnalysisCache.size > DASHBOARD_ANALYSIS_CACHE_LIMIT) {
    const oldest = dashboardAnalysisCache.keys().next().value as string | undefined;
    if (!oldest) break;
    dashboardAnalysisCache.delete(oldest);
  }
}

export function primeDashboardAnalysisCache(
  records: readonly DashboardMatchRecord[],
  scope: DashboardScopeV2,
  analysis: DashboardAnalysis,
): void {
  writeDashboardAnalysisCache(dashboardAnalysisCacheKey(records, scope), {
    ...analysis,
    records: [...records],
  });
}

function snapshotPeriodKey(matchId: string, period: DashboardPeriod): string {
  return `${matchId}:${period}`;
}

export function primeDashboardMatchSnapshot(
  record: DashboardMatchRecord,
  period: DashboardPeriod,
  sourceFingerprint: string,
  analysis: DashboardAnalysis,
  playerContexts: DashboardSnapshotPlayerContext[] = [],
): void {
  dashboardAnalysisCache.clear();
  registeredMatchSnapshots.set(snapshotPeriodKey(record.catalog.matchId, period), {
    sourceFingerprint,
    analysis: { ...analysis, records: [record] },
    playerContexts,
  });
}

function supportsMatchSnapshot(scope: DashboardScopeV2): boolean {
  return scope.phases.length === 0
    && scope.playerIds.length === 0
    && scope.goalkeeperIds.length === 0
    && scope.originZones.length === 0
    && scope.targetZones.length === 0
    && scope.outcomes.length === 0
    && scope.keeperBodyParts.length === 0
    && scope.saveOutcomes.length === 0
    && scope.threatSides.length === 0
    && scope.setPieceTraceability === "ALL_CLASSIFIED"
    && scope.outcomeGroup === "ALL"
    && scope.originDistance === "ALL"
    && scope.competitiveContext === "ALL"
    && scope.playingState === "ALL"
    && scope.scoreState === "ALL";
}

function registeredSnapshotFor(
  records: readonly DashboardMatchRecord[],
  scope: DashboardScopeV2,
): DashboardAnalysis | null {
  if (records.length !== 1 || !supportsMatchSnapshot(scope)) return null;
  const filtered = filterDashboardDataset(records, scope);
  if (filtered.length !== 1) return null;
  const record = records[0];
  const snapshot = registeredMatchSnapshots.get(snapshotPeriodKey(record.catalog.matchId, scope.period));
  return snapshot ? { ...snapshot.analysis, records: filtered } : null;
}

function aggregateRegisteredSnapshots(
  records: readonly DashboardMatchRecord[],
  scope: DashboardScopeV2,
): DashboardAnalysis | null {
  if (!supportsMatchSnapshot(scope)) return null;
  const selected = filterDashboardMatchSelection(records, scope);
  if (selected.length === 0) return null;
  const filtered = filterDashboardDataset(selected, scope);
  const entries = selected.map((record) => registeredMatchSnapshots.get(snapshotPeriodKey(record.catalog.matchId, scope.period)));
  if (entries.some((entry) => !entry)) return null;
  const validEntries = entries as Array<NonNullable<typeof entries[number]>>;
  const values = validEntries.map((entry) => entry.analysis);
  if (values.length === 1) return { ...values[0], records: [...selected] };

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const analytics = clone(values[0].analytics);
  const scalarAnalytics = ["matches", "finishedMatches", "wins", "draws", "losses", "goalsFor", "goalsAgainst"] as const;
  const playerStats = new Map(analytics.players.map((player) => [player.playerId, player]));
  const goalkeeperStats = new Map(analytics.goalkeepers.map((keeper) => [keeper.playerId, keeper]));
  for (const next of values.slice(1).map((value) => value.analytics)) {
    for (const key of scalarAnalytics) analytics[key] += next[key];
    for (const side of ["FOR", "AGAINST"] as const) {
      for (const key of ["total", "GOL", "PARADA", "FUERA", "BLOQUEADO"] as const) analytics.threats[side][key] += next.threats[side][key];
      analytics.discipline[side === "FOR" ? "for" : "against"].fouls += next.discipline[side === "FOR" ? "for" : "against"].fouls;
      analytics.discipline[side === "FOR" ? "for" : "against"].yellowCards += next.discipline[side === "FOR" ? "for" : "against"].yellowCards;
      analytics.discipline[side === "FOR" ? "for" : "against"].redCards += next.discipline[side === "FOR" ? "for" : "against"].redCards;
    }
    for (const key of Object.keys(analytics.secondPlay) as Array<keyof typeof analytics.secondPlay>) analytics.secondPlay[key] += next.secondPlay[key];
    for (const phase of Object.keys(analytics.phases) as Array<keyof typeof analytics.phases>) {
      analytics.phases[phase].FOR += next.phases[phase].FOR;
      analytics.phases[phase].AGAINST += next.phases[phase].AGAINST;
    }
    for (const player of next.players) {
      const current = playerStats.get(player.playerId);
      if (!current) { playerStats.set(player.playerId, clone(player)); continue; }
      current.matches += player.matches;
      current.minutes += player.minutes;
      current.goals += player.goals;
      current.assists += player.assists;
      current.threats += player.threats;
      if (player.targetMinutes !== undefined) current.targetMinutes = (current.targetMinutes ?? 0) + player.targetMinutes;
    }
    for (const keeper of next.goalkeepers) {
      const current = goalkeeperStats.get(keeper.playerId);
      if (!current) { goalkeeperStats.set(keeper.playerId, clone(keeper)); continue; }
      current.minutes += keeper.minutes;
      current.threatsAgainst += keeper.threatsAgainst;
      current.goalsAgainst += keeper.goalsAgainst;
      current.saves += keeper.saves;
      current.outside += keeper.outside;
      for (const part of Object.keys(current.bodyParts) as KeeperBodyPart[]) current.bodyParts[part] += keeper.bodyParts[part];
      for (const outcome of Object.keys(current.saveOutcomes) as SaveOutcome[]) current.saveOutcomes[outcome] += keeper.saveOutcomes[outcome];
    }
    analytics.pitchPoints.push(...clone(next.pitchPoints));
    analytics.goalPoints.push(...clone(next.goalPoints));
    analytics.quality.push(...clone(next.quality));
    for (const key of Object.keys(analytics.missing) as Array<keyof typeof analytics.missing>) analytics.missing[key] += next.missing[key];
  }
  analytics.players = Array.from(playerStats.values()).sort((a, b) => b.minutes - a.minutes || a.number - b.number);
  analytics.goalkeepers = Array.from(goalkeeperStats.values()).map((keeper) => ({
    ...keeper,
    savePercentage: keeper.saves + keeper.goalsAgainst > 0 ? keeper.saves / (keeper.saves + keeper.goalsAgainst) * 100 : null,
  })).sort((a, b) => b.minutes - a.minutes || a.number - b.number);

  const samples = values.reduce((sum, value) => sum + value.samples, 0);
  const observedMinutes = values.reduce((sum, value) => sum + value.rates.observedMinutes, 0);
  const teamKeyMinutes = values.reduce((sum, value) => sum + value.teamKeyMinutes, 0);
  const teamGoldMinutes = values.reduce((sum, value) => sum + value.teamGoldMinutes, 0);
  const mergedPlayers = new Map<string, PlayerAnalysis>();
  const additivePlayerKeys: Array<keyof PlayerAnalysis> = [
    "matches", "minutes", "availableMinutes", "keyMinutes", "goldMinutes", "goals", "assists", "ownThreats", "ownOnTarget", "ownNear",
    "possessionLosses", "foulsCommitted", "foulsReceived", "criticalFoulsCommitted", "criticalFoulsReceived", "yellowCards", "redCards", "onCourtPoints",
  ];
  const additiveOnCourtKeys = ["threatsFor", "threatsAgainst", "goalsFor", "goalsAgainst", "foulsFor", "foulsAgainst", "threatsForOnTarget", "threatsAgainstOnTarget", "threatsForNear", "threatsAgainstNear"] as const;
  for (const value of values) for (const player of value.players) {
    const current = mergedPlayers.get(player.playerId);
    if (!current) { mergedPlayers.set(player.playerId, clone(player)); continue; }
    for (const key of additivePlayerKeys) (current[key] as number) += player[key] as number;
    if (player.targetMinutes !== undefined) current.targetMinutes = (current.targetMinutes ?? 0) + player.targetMinutes;
    for (const outcome of ["GOL", "PARADA", "FUERA", "BLOQUEADO"] as const) current.ownOutcomes[outcome] += player.ownOutcomes[outcome];
    current.ownShotPoints.push(...clone(player.ownShotPoints));
    current.trend.push(...clone(player.trend));
    for (const key of additiveOnCourtKeys) current.onCourt[key] += player.onCourt[key];
  }
  validEntries.forEach((entry) => entry.playerContexts.forEach((context) => {
    if (entry.analysis.players.some((player) => player.playerId === context.playerId)) return;
    const player = mergedPlayers.get(context.playerId);
    if (!player) return;
    player.availableMinutes += context.availableMinutes;
    if (context.targetMinutes !== undefined) player.targetMinutes = (player.targetMinutes ?? 0) + context.targetMinutes;
    player.trend.push(clone(context.trend));
  }));
  const players = Array.from(mergedPlayers.values()).map((player) => {
    player.participationPercentage = player.availableMinutes > 0 ? player.minutes / player.availableMinutes * 100 : null;
    player.averageMinutes = player.matches > 0 ? player.minutes / player.matches : null;
    player.keyMinutesPerMatch = player.matches > 0 ? player.keyMinutes / player.matches : null;
    player.keyMinutesPercentage = teamKeyMinutes > 0 ? player.keyMinutes / teamKeyMinutes * 100 : null;
    player.goldMinutesPerMatch = player.matches > 0 ? player.goldMinutes / player.matches : null;
    player.goldMinutesPercentage = teamGoldMinutes > 0 ? player.goldMinutes / teamGoldMinutes * 100 : null;
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
    for (const key of ["foulsCommitted", "foulsReceived", "criticalFoulsCommitted", "criticalFoulsReceived"] as const) {
      player[`${key}PerMatch` as "foulsCommittedPerMatch"] = player.matches > 0 ? player[key] / player.matches : null;
      player[`${key}40` as "foulsCommitted40"] = per40(player[key], player.minutes);
    }
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
    player.lowSample = player.minutes < 20;
    player.trend.sort((a, b) => a.date.localeCompare(b.date));
    return player;
  }).sort((a, b) => b.minutes - a.minutes || a.number - b.number);

  const mergedGoalkeepers = new Map<string, DashboardAnalysis["goalkeepers"][number]>();
  for (const value of values) for (const keeper of value.goalkeepers) {
    const current = mergedGoalkeepers.get(keeper.playerId);
    if (!current) { mergedGoalkeepers.set(keeper.playerId, clone(keeper)); continue; }
    for (const key of ["minutes", "threatsAgainst", "interiorThreats", "saves", "goalsAgainst", "keyMinutes", "goldMinutes"] as const) current[key] += keeper[key];
    for (const part of Object.keys(current.bodyParts) as KeeperBodyPart[]) current.bodyParts[part] += keeper.bodyParts[part];
    for (const outcome of Object.keys(current.saveOutcomes) as SaveOutcome[]) current.saveOutcomes[outcome] += keeper.saveOutcomes[outcome];
    current.goalPoints.push(...clone(keeper.goalPoints));
    current.originPoints.push(...clone(keeper.originPoints));
  }
  const goalkeepers = Array.from(mergedGoalkeepers.values()).map((keeper) => ({
    ...keeper,
    threatsAgainst40: per40(keeper.threatsAgainst, keeper.minutes),
    goalsAgainst40: per40(keeper.goalsAgainst, keeper.minutes),
    savePercentage: keeper.saves + keeper.goalsAgainst > 0 ? keeper.saves / (keeper.saves + keeper.goalsAgainst) * 100 : null,
    keyMinutesPercentage: teamKeyMinutes > 0 ? keeper.keyMinutes / teamKeyMinutes * 100 : null,
    goldMinutesPercentage: teamGoldMinutes > 0 ? keeper.goldMinutes / teamGoldMinutes * 100 : null,
  })).sort((a, b) => b.minutes - a.minutes || a.number - b.number);

  const mergeZones = <Z extends DashboardAnalysis["pitchZones"] | DashboardAnalysis["goalZones"]>(read: (analysis: DashboardAnalysis) => Z): Z => {
    const zones = clone(read(values[0]));
    for (const value of values.slice(1)) read(value).forEach((zone, index) => {
      zones[index].threats += zone.threats; zones[index].goals += zone.goals; zones[index].saves += zone.saves; zones[index].outside += zone.outside;
    });
    zones.forEach((zone) => { zone.goalPercentage = zone.threats > 0 ? zone.goals / zone.threats * 100 : null; const inside = zone.saves + zone.goals; zone.savePercentage = inside > 0 ? zone.saves / inside * 100 : null; });
    return zones;
  };
  const mergePlayingState = (side: "for" | "against") => {
    const result = clone(values[0].flyingGoalkeeper[side]);
    for (const value of values.slice(1)) for (const key of ["minutes", "matchesWithState", "threatsFor", "threatsAgainst", "goalsFor", "goalsAgainst", "onTargetFor", "onTargetAgainst"] as const) result[key] += value.flyingGoalkeeper[side][key];
    result.minutesPerMatch = samples > 0 ? result.minutes / samples : null;
    result.minutesPerMatchWithState = result.matchesWithState > 0 ? result.minutes / result.matchesWithState : null;
    return result;
  };
  return {
    records: filtered, samples, analytics,
    rates: {
      observedMinutes,
      threatsFor40: per40(analytics.threats.FOR.total, observedMinutes), threatsAgainst40: per40(analytics.threats.AGAINST.total, observedMinutes),
      goalsFor40: per40(analytics.goalsFor, observedMinutes), goalsAgainst40: per40(analytics.goalsAgainst, observedMinutes),
      foulsFor40: per40(analytics.discipline.for.fouls, observedMinutes), foulsAgainst40: per40(analytics.discipline.against.fouls, observedMinutes),
      possessionLosses40: per40(values.reduce((sum, value) => sum + value.possessionLosses, 0), observedMinutes),
    },
    players, goalkeepers, teamKeyMinutes, teamGoldMinutes,
    trends: values.flatMap((value) => clone(value.trends)).sort((a, b) => a.date.localeCompare(b.date)),
    pitchZones: mergeZones((analysis) => analysis.pitchZones),
    goalZones: mergeZones((analysis) => analysis.goalZones),
    criticalFouls: { for: values.reduce((sum, value) => sum + value.criticalFouls.for, 0), against: values.reduce((sum, value) => sum + value.criticalFouls.against, 0) },
    possessionLosses: values.reduce((sum, value) => sum + value.possessionLosses, 0),
    flyingGoalkeeper: { for: mergePlayingState("for"), against: mergePlayingState("against") },
  };
}

export function buildDashboardV2(
  records: readonly DashboardMatchRecord[],
  scope: DashboardScopeV2,
): DashboardAnalysis {
  dashboardBuildMetricsState.calls += 1;
  const key = dashboardAnalysisCacheKey(records, scope);
  const cached = dashboardAnalysisCache.get(key);
  if (cached) {
    dashboardBuildMetricsState.cacheHits += 1;
    dashboardAnalysisCache.delete(key);
    dashboardAnalysisCache.set(key, cached);
    return cached;
  }
  const snapshot = registeredSnapshotFor(records, scope);
  if (snapshot) {
    dashboardBuildMetricsState.cacheHits += 1;
    writeDashboardAnalysisCache(key, snapshot);
    return snapshot;
  }
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const analysis = buildDashboardV2Raw(records, scope);
  const finishedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  dashboardBuildMetricsState.rawBuilds += 1;
  dashboardBuildMetricsState.rawMilliseconds += finishedAt - startedAt;
  dashboardBuildMetricsState.matchesProcessed += records.length;
  dashboardBuildMetricsState.eventsProcessed += records.reduce((total, record) => total + record.session.events.length, 0);
  writeDashboardAnalysisCache(key, analysis);
  return analysis;
}

/**
 * Summary/Data fast path. It aggregates complete per-match materialized views
 * for canonical scopes and deliberately falls back to the proven event-based
 * engine for filters whose granular semantics are not covered in V1.
 */
export function buildDashboardV2FromSnapshots(
  records: readonly DashboardMatchRecord[],
  scope: DashboardScopeV2,
): DashboardAnalysis {
  dashboardBuildMetricsState.calls += 1;
  const key = dashboardAnalysisCacheKey(records, scope);
  const cached = dashboardAnalysisCache.get(key);
  if (cached) {
    dashboardBuildMetricsState.cacheHits += 1;
    return cached;
  }
  const aggregated = aggregateRegisteredSnapshots(records, scope);
  if (aggregated) {
    dashboardBuildMetricsState.cacheHits += 1;
    writeDashboardAnalysisCache(key, aggregated);
    return aggregated;
  }
  return buildDashboardV2(records, scope);
}

export function dashboardBuildMetrics(): Readonly<DashboardBuildMetrics> {
  return { ...dashboardBuildMetricsState };
}

export function resetDashboardAnalysisCache(): void {
  dashboardAnalysisCache.clear();
  registeredMatchSnapshots.clear();
  dashboardBuildMetricsState.calls = 0;
  dashboardBuildMetricsState.cacheHits = 0;
  dashboardBuildMetricsState.rawBuilds = 0;
  dashboardBuildMetricsState.rawMilliseconds = 0;
  dashboardBuildMetricsState.matchesProcessed = 0;
  dashboardBuildMetricsState.eventsProcessed = 0;
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
      if (!isActiveMatchEvent(event) || !projection.eventIds.has(event.id) || event.type !== "threat_recorded" || !eventMatches(event, record, scope)) continue;
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

export type TeamPlayerTableMetricKey =
  | "matches" | "minutes" | "avgMinutes" | "goals" | "assists" | "threats" | "possessionLosses"
  | "points" | "plusMinus" | "goalsFor" | "goalsAgainst" | "threatsFor" | "threatsAgainst" | "threatBalance"
  | "onTargetFor" | "onTargetAgainst" | "onTargetBalance" | "nearFor" | "nearAgainst" | "nearBalance"
  | "keyMinutes" | "keyPercentage" | "goldMinutes" | "goldPercentage"
  | "foulsCommitted" | "foulsReceived" | "criticalCommitted" | "criticalReceived" | "yellowCards" | "redCards" | "score";

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

/**
 * Agregado cronológico del equipo para la tabla de jugadores. Nunca se deriva
 * sumando o promediando filas individuales: los conteos salen de eventos y los
 * tiempos de los intervalos del equipo ya acotados por el scope activo.
 */
export function teamPlayerTableMetricValue(
  analysis: DashboardAnalysis,
  metric: TeamPlayerTableMetricKey,
  mode: DashboardValueMode,
): number | null {
  const matches = analysis.samples;
  const observedMinutes = analysis.rates.observedMinutes;
  const normalizeCount = (value: number) => mode === "TOTALS" ? value
    : mode === "PER_MATCH" ? matches > 0 ? value / matches : null
      : per40(value, observedMinutes);
  const normalizeTime = (value: number) => mode === "TOTALS" ? value
    : mode === "PER_MATCH" ? matches > 0 ? value / matches : null
      : per40(value, observedMinutes);
  const threatsFor = derivedThreatSummary(analysis.records.flatMap((record) => record.session.events), "FOR");
  const threatsAgainst = derivedThreatSummary(analysis.records.flatMap((record) => record.session.events), "AGAINST");

  if (metric === "matches") return analysis.analytics.matches;
  if (metric === "minutes") return normalizeTime(observedMinutes);
  if (metric === "avgMinutes") return matches > 0 ? observedMinutes / matches : null;
  if (metric === "goals" || metric === "goalsFor") return normalizeCount(analysis.analytics.goalsFor);
  if (metric === "goalsAgainst") return normalizeCount(analysis.analytics.goalsAgainst);
  if (metric === "plusMinus") return normalizeCount(analysis.analytics.goalsFor - analysis.analytics.goalsAgainst);
  if (metric === "assists") {
    const assists = analysis.records.flatMap((record) => record.session.events).filter((event) =>
      isActiveMatchEvent(event)
      && event.type === "threat_recorded"
      && event.side === "FOR"
      && event.outcome === "GOL"
      && event.assist?.status === "PLAYER"
    ).length;
    return normalizeCount(assists);
  }
  if (metric === "threats" || metric === "threatsFor") return normalizeCount(threatsFor.total);
  if (metric === "threatsAgainst") return normalizeCount(threatsAgainst.total);
  if (metric === "threatBalance") return normalizeCount(threatsFor.total - threatsAgainst.total);
  if (metric === "onTargetFor") return normalizeCount(threatsFor.onTarget);
  if (metric === "onTargetAgainst") return normalizeCount(threatsAgainst.onTarget);
  if (metric === "onTargetBalance") return normalizeCount(threatsFor.onTarget - threatsAgainst.onTarget);
  if (metric === "nearFor") return normalizeCount(threatsFor.near);
  if (metric === "nearAgainst") return normalizeCount(threatsAgainst.near);
  if (metric === "nearBalance") return normalizeCount(threatsFor.near - threatsAgainst.near);
  if (metric === "possessionLosses") return normalizeCount(analysis.possessionLosses);
  if (metric === "foulsCommitted") return normalizeCount(analysis.analytics.discipline.for.fouls);
  if (metric === "foulsReceived") return normalizeCount(analysis.analytics.discipline.against.fouls);
  if (metric === "criticalCommitted") return normalizeCount(analysis.criticalFouls.for);
  if (metric === "criticalReceived") return normalizeCount(analysis.criticalFouls.against);
  if (metric === "yellowCards") return normalizeCount(analysis.analytics.discipline.for.yellowCards);
  if (metric === "redCards") return normalizeCount(analysis.analytics.discipline.for.redCards);
  if (metric === "keyMinutes") return normalizeTime(analysis.teamKeyMinutes);
  if (metric === "goldMinutes") return normalizeTime(analysis.teamGoldMinutes);
  if (metric === "keyPercentage") return observedMinutes > 0 ? analysis.teamKeyMinutes / observedMinutes * 100 : null;
  if (metric === "goldPercentage") return observedMinutes > 0 ? analysis.teamGoldMinutes / observedMinutes * 100 : null;
  if (metric === "points") {
    const points = analysis.trends.reduce((sum, trend) => sum + (trend.result === "WIN" ? 3 : trend.result === "DRAW" ? 1 : 0), 0);
    return mode === "TOTALS" ? points : mode === "PER_MATCH" ? matches > 0 ? points / matches : null : per40(points, observedMinutes);
  }
  return null;
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

const LIST_KEYS = ["matchIds", "venues", "results", "rivals", "phases", "playerIds", "goalkeeperIds", "originZones", "targetZones", "outcomes", "keeperBodyParts", "saveOutcomes", "threatSides"] as const;

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
  if (scope.setPieceTraceability !== "ALL_CLASSIFIED") params.set(`${prefix}Traceability`, scope.setPieceTraceability);
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
    setPieceTraceability: params.get(`${prefix}Traceability`) === "LINKED_RESTART_ONLY" ? "LINKED_RESTART_ONLY" : fallback.setPieceTraceability,
    matchIds: params.has(`${prefix}matchIds`)
      ? read<string>("matchIds")
      : [params.get(`${prefix}Match`), params.get(`${prefix}MatchId`)].filter((value): value is string => Boolean(value)),
    venues: read<Exclude<VenueFilter, "ALL">>("venues"),
    results: read<Exclude<ResultFilter, "ALL">>("results"),
    rivals: read<string>("rivals"),
    phases: read<DashboardPhaseFilter>("phases"),
    playerIds: read<string>("playerIds"),
    goalkeeperIds: read<string>("goalkeeperIds"),
    originZones: read<PitchOriginZone>("originZones"),
    targetZones: read<GoalZoneV1>("targetZones"),
    outcomes: read<ThreatOutcome>("outcomes"),
    keeperBodyParts: read<KeeperBodyPart>("keeperBodyParts"),
    saveOutcomes: read<SaveOutcome>("saveOutcomes"),
    threatSides: read<ThreatSide>("threatSides"),
  };
}

export function hasDashboardScopeSearchParams(params: URLSearchParams, prefix: "a" | "r"): boolean {
  const scalarKeys = ["Club", "Team", "Season", "Competition", "Period", "Archived", "OutcomeGroup", "Distance", "Context", "PJState", "ScoreState", "Traceability"];
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
  if (view.comparisonEnabled === false) params.set("compare", "off");
  else params.delete("compare");
  return params.toString();
}

export function comparisonEnabledFromSearchParams(params: URLSearchParams): boolean {
  return params.get("compare") !== "off";
}
