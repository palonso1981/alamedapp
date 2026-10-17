import { DashboardMatchRecord } from "./dashboardAnalytics";
import { buildDashboardV2, DashboardScopeV2, DashboardValueMode, filterDashboardMatchSelection, normalizeDashboardCount, teamMetricValue, teamThreatProfile } from "./dashboardV2";
import { describeDistribution } from "./distributionStatistics";

type Analysis = ReturnType<typeof buildDashboardV2>;
export type DashboardDistributionMetric =
  | "goalsFor" | "goalsAgainst" | "threatsFor" | "threatsAgainst" | "possessionLosses"
  | "FOR.outside" | "AGAINST.outside"
  | "FOR.onTarget" | "AGAINST.onTarget" | "FOR.saves" | "AGAINST.saves"
  | "FOR.outsidePct" | "AGAINST.outsidePct"
  | "FOR.onTargetPct" | "AGAINST.onTargetPct"
  | "FOR.conversionPct" | "AGAINST.conversionPct"
  | "FOR.savePct" | "AGAINST.savePct";

function readMetric(analysis: Analysis, metric: DashboardDistributionMetric, mode: DashboardValueMode): number | null {
  if (["goalsFor", "goalsAgainst", "threatsFor", "threatsAgainst", "possessionLosses"].includes(metric)) {
    return teamMetricValue(analysis, metric as "goalsFor" | "goalsAgainst" | "threatsFor" | "threatsAgainst" | "possessionLosses", mode);
  }
  const [side, field] = metric.split(".") as ["FOR" | "AGAINST", "outside" | "onTarget" | "saves" | "outsidePct" | "onTargetPct" | "conversionPct" | "savePct"];
  const profile = teamThreatProfile(analysis.records.flatMap((record) => record.session.events), side);
  if (field === "outsidePct") return profile.outsidePercentage;
  if (field === "onTargetPct") return profile.onTargetPercentage;
  if (field === "conversionPct") return profile.conversionPercentage;
  if (field === "savePct") return profile.goalkeeperSavePercentage;
  return normalizeDashboardCount(profile[field], mode, analysis.samples, analysis.rates.observedMinutes);
}

export function dashboardMetricDistribution(records: readonly DashboardMatchRecord[], scope: DashboardScopeV2, metric: DashboardDistributionMetric, mode: DashboardValueMode) {
  const observations = filterDashboardMatchSelection(records, scope).map((record) => ({
    matchId: record.catalog.matchId,
    label: `${record.catalog.date} · ${record.catalog.opponent}`,
    value: readMetric(buildDashboardV2([record], { ...scope, matchIds: [record.catalog.matchId] }), metric, mode),
  }));
  return { observations, stats: describeDistribution(observations.map((observation) => observation.value)) };
}
