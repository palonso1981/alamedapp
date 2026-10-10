/** R-7 quantiles: h=(n-1)*p, linear interpolation between adjacent order statistics. */
export const MIN_MATCHES_FOR_HABITUAL_RANGE = 4;
export interface DistributionStats { n: number; missing: number; mean: number | null; median: number | null; p25: number | null; p75: number | null; stdDev: number | null; min: number | null; max: number | null }
export function describeDistribution(values: readonly (number | null | undefined)[]): DistributionStats {
  const sorted = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  const n = sorted.length, missing = values.length - n;
  if (!n) return { n, missing, mean: null, median: null, p25: null, p75: null, stdDev: null, min: null, max: null };
  const quantile = (p: number) => { const h = (n - 1) * p, i = Math.floor(h); return sorted[i] + (sorted[Math.min(i + 1, n - 1)] - sorted[i]) * (h - i); };
  const mean = sorted.reduce((sum, value) => sum + value / n, 0);
  return { n, missing, mean, median: quantile(.5), p25: quantile(.25), p75: quantile(.75), stdDev: Math.sqrt(sorted.reduce((sum, x) => sum + (x - mean) ** 2 / n, 0)), min: sorted[0], max: sorted[n - 1] };
}
export type { MetricDirection } from "./dashboardMetricDefinitions";
import type { MetricDirection } from "./dashboardMetricDefinitions";
export interface DistributionScale { min: number; max: number }
/** A shared linear domain includes every observed extreme and both aggregate markers. No clipping. */
export function distributionScale(values: readonly (number | null | undefined)[]): DistributionScale {
  const valid = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const min = valid.length ? Math.min(...valid) : 0, max = valid.length ? Math.max(...valid) : 0;
  const pad = (max - min || Math.max(1, Math.abs(max))) * .08;
  return { min: min - pad, max: max + pad };
}
export function distributionPosition(value: number, scale: DistributionScale): number { return (value - scale.min) / (scale.max - scale.min) * 100; }
export function distributionTone(current: number | null, reference: number | null, direction: MetricDirection): "positive" | "negative" | "neutral" {
  if (current === null || reference === null || current === reference || direction === "NEUTRAL") return "neutral";
  return (current > reference) === (direction === "HIGHER_IS_BETTER") ? "positive" : "negative";
}
export function habitualPosition(value: number | null, stats: DistributionStats): "within" | "below" | "above" | "unavailable" {
  if (value === null || stats.n < MIN_MATCHES_FOR_HABITUAL_RANGE || stats.p25 === null || stats.p75 === null) return "unavailable";
  return value < stats.p25 ? "below" : value > stats.p75 ? "above" : "within";
}
