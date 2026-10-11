import { DashboardDistributionMetric, dashboardMetricDistribution } from "../../lib/dashboardDistribution";
import { DashboardMatchRecord } from "../../lib/dashboardAnalytics";
import { DashboardScopeV2, DashboardValueMode } from "../../lib/dashboardV2";
import { habitualPosition } from "../../lib/distributionStatistics";

const format = (value: number | null) => value === null ? "N/D" : Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");

export function HabitualRange({ records, scope, metric, mode, value }: { records: readonly DashboardMatchRecord[]; scope: DashboardScopeV2; metric: DashboardDistributionMetric; mode: DashboardValueMode; value: number | null }) {
  const distribution = dashboardMetricDistribution(records, scope, metric, mode);
  const { stats } = distribution;
  const position = habitualPosition(value, stats);
  if (position === "unavailable") return <span className="text-[9px] text-slate-500">habitual · muestra {stats.n}/4</span>;
  const symbol = position === "above" ? "↑" : position === "below" ? "↓" : "·";
  return <details className="group inline-block text-left">
    <summary className="cursor-pointer list-none text-[10px] font-bold text-amber-200">{symbol} habitual {format(stats.p25)}–{format(stats.p75)}</summary>
    <div className="absolute z-20 mt-1 w-52 rounded-xl border border-amber-900 bg-slate-950 p-3 text-[10px] shadow-xl">
      <b className="block text-amber-200">{position === "within" ? "DENTRO DE LO HABITUAL" : position === "above" ? "POR ENCIMA" : "POR DEBAJO"}</b>
      <span className="mt-1 block text-slate-400">Mediana {format(stats.median)} · media {format(stats.mean)} · N {stats.n}</span>
      <span className="block text-slate-500">Mín {format(stats.min)} · máx {format(stats.max)} · σ {format(stats.stdDev)}</span>
    </div>
  </details>;
}
