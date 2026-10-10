import { DashboardMatchRecord, DASHBOARD_PHASES } from "./dashboardAnalytics";
import { buildDashboardV2, DashboardScopeV2, DashboardValueMode, filterDashboardMatchSelection, normalizeDashboardCount, teamThreatProfile, teamMetricValue, TeamMetricKey, buildSetPieceFunnel, SET_PIECE_FUNNEL_OPTIONS } from "./dashboardV2";
import { describeDistribution, MetricDirection, DistributionStats } from "./distributionStatistics";

type Analysis = ReturnType<typeof buildDashboardV2>;
export interface DistributionMetric { label: string; direction: MetricDirection; percentage?: boolean; read: (analysis: Analysis, mode: DashboardValueMode) => number | null }
const registry: Record<string, DistributionMetric> = {};
const normalized = (a: Analysis, n: number, mode: DashboardValueMode) => normalizeDashboardCount(n, mode, a.samples, a.rates.observedMinutes);
for (const [id, label, direction] of [
  ["goalsFor", "Goles CDA", "HIGHER_IS_BETTER"], ["goalsAgainst", "Goles recibidos", "LOWER_IS_BETTER"],
  ["threatsFor", "Remates CDA", "HIGHER_IS_BETTER"], ["threatsAgainst", "Amenazas recibidas", "LOWER_IS_BETTER"],
  ["foulsFor", "Faltas CDA", "LOWER_IS_BETTER"], ["foulsAgainst", "Faltas rival", "NEUTRAL"], ["possessionLosses", "Pérdidas", "LOWER_IS_BETTER"],
] as const) registry[id] = { label, direction, read: (a, mode) => teamMetricValue(a, id as TeamMetricKey, mode) };
for (const side of ["FOR", "AGAINST"] as const) {
  const suffix = side === "FOR" ? "CDA" : "rival";
  for (const [field, label, percentage, direction] of [
    ["total", "Remates/amenazas", false, side === "FOR" ? "HIGHER_IS_BETTER" : "LOWER_IS_BETTER"],
    ["goals", "Goles", false, side === "FOR" ? "HIGHER_IS_BETTER" : "LOWER_IS_BETTER"],
    ["onTarget", "A puerta", false, side === "FOR" ? "HIGHER_IS_BETTER" : "LOWER_IS_BETTER"],
    ["near", "Cercanos", false, side === "FOR" ? "HIGHER_IS_BETTER" : "LOWER_IS_BETTER"],
    ["outside", "Fuera", false, "NEUTRAL"], ["saves", "Paradas", false, "NEUTRAL"], ["blocked", "Bloqueados", false, "NEUTRAL"],
    ["onTargetPercentage", "% a puerta", true, "NEUTRAL"], ["conversionPercentage", "% conversión", true, side === "FOR" ? "HIGHER_IS_BETTER" : "LOWER_IS_BETTER"],
    ["outsidePercentage", "% fuera", true, "NEUTRAL"], ["goalkeeperSavePercentage", "% parada", true, "NEUTRAL"],
  ] as const) registry[`${side}.${field}`] = { label: `${label} ${suffix}`, percentage, direction, read: (a, mode) => { const p = teamThreatProfile(a.records.flatMap(r => r.session.events), side); const v = p[field]; return v === null ? null : percentage ? v : normalized(a, v, mode); } };
  registry[`${side}.nearPercentage`] = { label: `% cercanos ${suffix}`, percentage: true, direction: "NEUTRAL", read: a => { const p = teamThreatProfile(a.records.flatMap(r => r.session.events), side); return p.total ? p.near / p.total * 100 : null; } };
  for (const phase of DASHBOARD_PHASES) registry[`phase.${phase}.${side}`] = { label: `${phase.replaceAll("_", " ")} ${suffix}`, direction: side === "FOR" ? "HIGHER_IS_BETTER" : "LOWER_IS_BETTER", read: (a, mode) => normalized(a, a.analytics.phases[phase][side], mode) };
  for (const kind of SET_PIECE_FUNNEL_OPTIONS) for (const field of ["opportunities", "withShot", "withOnTarget", "withGoal", "totalShots"] as const) registry[`abp.${kind.value}.${side}.${field}`] = { label: `${kind.label} · ${field === "opportunities" ? "Oportunidades" : field === "withGoal" ? "Gol" : field === "withOnTarget" ? "A puerta" : "Remates"} ${suffix}`, direction: field === "opportunities" ? "NEUTRAL" : side === "FOR" ? "HIGHER_IS_BETTER" : "LOWER_IS_BETTER", read: (a, mode) => normalized(a, buildSetPieceFunnel(a.records, kind.value)[side][field], mode) };
}
for (const side of ["for", "against"] as const) {
  for (const [field, label] of [["fouls", "Faltas"], ["yellowCards", "Amarillas"], ["redCards", "Rojas"]] as const) registry[`discipline.${side}.${field}`] = { label: `${label} ${side === "for" ? "CDA" : "rival"}`, direction: side === "for" ? "LOWER_IS_BETTER" : "NEUTRAL", read: (a, mode) => normalized(a, a.analytics.discipline[side][field], mode) };
  registry[`critical.${side}`] = { label: `Faltas críticas ${side === "for" ? "CDA" : "rival"}`, direction: side === "for" ? "LOWER_IS_BETTER" : "NEUTRAL", read: (a, mode) => normalized(a, a.criticalFouls[side], mode) };
}
for (const field of ["threats", "goals"] as const) registry[`second.${field}`] = { label: field === "goals" ? "Goles 2ª jugada" : "2ª jugada", direction: "HIGHER_IS_BETTER", read: (a, mode) => normalized(a, a.analytics.secondPlay[field], mode) };
for (const side of ["for", "against"] as const) for (const field of ["minutes", "minutesPerMatch", "goalsFor", "goalsAgainst", "threatsFor", "threatsAgainst", "onTargetFor", "onTargetAgainst"] as const) registry[`pj.${side}.${field}`] = { label: `PJ ${side === "for" ? "CDA" : "rival"} · ${({ minutes: "Minutos", minutesPerMatch: "Min/partido", goalsFor: "GF", goalsAgainst: "GC", threatsFor: "Remates", threatsAgainst: "Amenazas", onTargetFor: "A puerta CDA", onTargetAgainst: "A puerta rival" })[field]}`, direction: field.includes("minutes") ? "NEUTRAL" : field.endsWith("Against") ? "LOWER_IS_BETTER" : "HIGHER_IS_BETTER", read: a => a.flyingGoalkeeper[side][field] };
export const DISTRIBUTION_METRICS: Readonly<Record<string, DistributionMetric>> = registry;
export interface Observation { matchId: string; label: string; value: number | null }
export interface MetricDistribution { stats: DistributionStats; observations: Observation[]; minimumMatches: Observation[]; maximumMatches: Observation[] }
export interface DistributionUniverse { aggregate: Analysis; matches: Array<{ record: DashboardMatchRecord; analysis: Analysis }> }
/** Resolve match membership BEFORE event filtering: zero-event matches retain their real zeros. */
export function buildDistributionUniverse(records: readonly DashboardMatchRecord[], scope: DashboardScopeV2, aggregate = buildDashboardV2(records, scope)): DistributionUniverse {
  return { aggregate, matches: filterDashboardMatchSelection(records, scope).map(record => ({ record, analysis: buildDashboardV2([record], { ...scope, matchIds: [record.catalog.matchId] }) })) };
}
export function metricDistribution(universe: DistributionUniverse, metric: string, mode: DashboardValueMode): MetricDistribution {
  const definition = DISTRIBUTION_METRICS[metric];
  if (!definition) throw new Error(`Unknown distribution metric: ${metric}`);
  const observations = universe.matches.map(({ record, analysis }) => ({ matchId: record.catalog.matchId, label: `${record.catalog.date} · ${record.catalog.opponent}`, value: definition.read(analysis, mode) }));
  const stats = describeDistribution(observations.map(o => o.value));
  return { stats, observations, minimumMatches: observations.filter(o => o.value !== null && o.value === stats.min), maximumMatches: observations.filter(o => o.value !== null && o.value === stats.max) };
}
export interface MetricComparison { metric: string; definition: DistributionMetric; current: MetricDistribution; reference: MetricDistribution | null; value: number | null; referenceValue: number | null }
export function metricComparison(current: DistributionUniverse, reference: DistributionUniverse | null, metric: string, mode: DashboardValueMode): MetricComparison {
  const definition = DISTRIBUTION_METRICS[metric];
  return { metric, definition, current: metricDistribution(current, metric, mode), reference: reference ? metricDistribution(reference, metric, mode) : null, value: definition.read(current.aggregate, mode), referenceValue: reference ? definition.read(reference.aggregate, mode) : null };
}
