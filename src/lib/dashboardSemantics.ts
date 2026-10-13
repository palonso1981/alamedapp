export type DashboardDeviation = "FAVORABLE" | "UNFAVORABLE" | "NEUTRAL" | "UNAVAILABLE";
export type DashboardHabitualPosition = "above" | "below" | "within" | "unavailable";
export type DashboardSummaryMetric = "VOLUME" | "OUTSIDE" | "ON_TARGET" | "SAVES" | "GOALS";

export function evaluateDashboardDeviation(position: DashboardHabitualPosition, favorableWhenHigher: boolean): DashboardDeviation {
  if (position === "unavailable") return "UNAVAILABLE";
  if (position === "within") return "NEUTRAL";
  const higher = position === "above";
  return higher === favorableWhenHigher ? "FAVORABLE" : "UNFAVORABLE";
}

export function summaryMetricFavorableWhenHigher(side: "CDA" | "RIVAL", metric: DashboardSummaryMetric): boolean {
  if (side === "CDA") return metric === "VOLUME" || metric === "ON_TARGET" || metric === "GOALS";
  return metric === "OUTSIDE" || metric === "SAVES";
}
