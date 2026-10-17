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

export function dashboardTimePercentage(minutes: number, totalMinutes: number): number | null {
  return totalMinutes > 0 ? minutes / totalMinutes * 100 : null;
}

export function formatDashboardDuration(minutes: number): string {
  const seconds = Math.max(0, Math.round(minutes * 60));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
