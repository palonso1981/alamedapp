/** R-7 quantiles: h=(n-1)*p, with linear interpolation. */
export const MIN_MATCHES_FOR_HABITUAL_RANGE = 4;

export interface DistributionStats {
  n: number;
  missing: number;
  mean: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  stdDev: number | null;
  min: number | null;
  max: number | null;
}

export function describeDistribution(values: readonly (number | null | undefined)[]): DistributionStats {
  const sorted = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  const n = sorted.length;
  const missing = values.length - n;
  if (!n) return { n, missing, mean: null, median: null, p25: null, p75: null, stdDev: null, min: null, max: null };
  const quantile = (p: number) => {
    const h = (n - 1) * p;
    const index = Math.floor(h);
    return sorted[index] + (sorted[Math.min(index + 1, n - 1)] - sorted[index]) * (h - index);
  };
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  return {
    n,
    missing,
    mean,
    median: quantile(.5),
    p25: quantile(.25),
    p75: quantile(.75),
    stdDev: Math.sqrt(sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n),
    min: sorted[0],
    max: sorted[n - 1],
  };
}

export function habitualPosition(value: number | null, stats: DistributionStats): "within" | "below" | "above" | "unavailable" {
  if (value === null || stats.n < MIN_MATCHES_FOR_HABITUAL_RANGE || stats.p25 === null || stats.p75 === null) return "unavailable";
  return value < stats.p25 ? "below" : value > stats.p75 ? "above" : "within";
}

export function sharedMetricMaximum(...values: Array<number | null | undefined>): number {
  return Math.max(1, ...values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
}
