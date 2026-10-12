"use client";

import { useEffect, useRef, useState } from "react";
import { DashboardDistributionMetric, dashboardMetricDistribution } from "../../lib/dashboardDistribution";
import { DashboardMatchRecord } from "../../lib/dashboardAnalytics";
import { DashboardScopeV2, DashboardValueMode } from "../../lib/dashboardV2";
import { habitualPosition } from "../../lib/distributionStatistics";

const format = (value: number | null) => value === null ? "N/D" : Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");

export function HabitualRange({ records, scope, metric, mode, value }: { records: readonly DashboardMatchRecord[]; scope: DashboardScopeV2; metric: DashboardDistributionMetric; mode: DashboardValueMode; value: number | null }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const distribution = dashboardMetricDistribution(records, scope, metric, mode);
  const { stats } = distribution;
  const position = habitualPosition(value, stats);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  if (position === "unavailable") return <span className="text-[9px] text-slate-500">habitual · muestra {stats.n}/4</span>;
  const symbol = position === "above" ? "↑" : position === "below" ? "↓" : "·";
  return <div ref={host} className="relative inline-block text-left">
    <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} className="text-[10px] font-bold text-amber-200">{symbol} habitual {format(stats.p25)}–{format(stats.p75)}</button>
    {open && <div role="dialog" className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-amber-900 bg-slate-950 p-3 text-[10px] shadow-xl">
      <b className="block text-amber-200">{position === "within" ? "DENTRO DE LO HABITUAL" : position === "above" ? "POR ENCIMA" : "POR DEBAJO"}</b>
      <p className="mt-1 text-slate-300">La mitad central de los partidos de esta referencia se sitúa entre {format(stats.p25)} y {format(stats.p75)}. Ese intervalo es el comportamiento habitual.</p>
      <span className="mt-2 block text-slate-400">Actual {format(value)} · media {format(stats.mean)} · mediana {format(stats.median)}</span>
      <span className="block text-slate-500">Mín {format(stats.min)} · máx {format(stats.max)} · {stats.n} partidos</span>
    </div>}
  </div>;
}
