"use client";

import { useEffect, useRef, useState } from "react";
import { DistributionStats, habitualPosition } from "../../lib/distributionStatistics";
import { evaluateDashboardDeviation } from "../../lib/dashboardSemantics";

const format = (value: number | null, suffix = "") => value === null ? "N/D" : `${Number.isInteger(value) ? value : value.toFixed(1).replace(".", ",")}${suffix}`;

export function MetricScale({ value, reference, stats, maximum, side, tone = side === "left" ? "cyan" : "rose", suffix = "", favorableWhenHigher }: {
  value: number | null;
  reference?: number | null;
  stats: DistributionStats;
  maximum: number;
  side: "left" | "right";
  tone?: "cyan" | "rose";
  suffix?: string;
  favorableWhenHigher?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const position = habitualPosition(value, stats);
  const evaluation = favorableWhenHigher === undefined ? null : evaluateDashboardDeviation(position, favorableWhenHigher);
  const pct = (candidate: number | null) => candidate === null ? 0 : Math.max(0, Math.min(100, candidate / maximum * 100));
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div ref={host} className="relative mt-1.5">
    <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} className="block w-full py-1" title="Ver detalle del rango habitual">
      <span className="relative block h-3 overflow-visible rounded-full bg-slate-800">
        {stats.n >= 4 && stats.p25 !== null && stats.p75 !== null && <span data-habitual-band className="absolute inset-y-0 rounded-full bg-amber-300/25 ring-1 ring-amber-300/40" style={{ [side === "left" ? "right" : "left"]: `${pct(stats.p25)}%`, width: `${Math.max(2, pct(stats.p75) - pct(stats.p25))}%` }}/>} 
        <span data-current-bar className={`absolute inset-y-0 rounded-full ${side === "left" ? "right-0" : "left-0"} ${tone === "cyan" ? "bg-cyan-400" : "bg-rose-400"}`} style={{ width: `${pct(value)}%` }}/>
        {reference !== undefined && reference !== null && <span data-reference-marker className="absolute -top-1 h-5 w-0.5 bg-white/90" style={{ [side === "left" ? "right" : "left"]: `${pct(reference)}%` }}/>} 
      </span>
      <span data-dashboard-evaluation={evaluation ?? undefined} className={`mt-1 block text-[8px] font-black ${evaluation === "FAVORABLE" ? "text-emerald-300" : evaluation === "UNFAVORABLE" ? "text-rose-300" : position === "within" ? "text-amber-200" : position === "unavailable" ? "text-slate-500" : position === "above" ? "text-rose-300" : "text-sky-300"}`}>{position === "unavailable" ? `habitual · muestra ${stats.n}/4` : `${position === "above" ? "↑ por encima" : position === "below" ? "↓ por debajo" : "· habitual"} ${format(stats.p25, suffix)}–${format(stats.p75, suffix)}`}</span>
    </button>
    {open && <div role="dialog" aria-label="Detalle del rango habitual" className={`absolute z-30 mt-1 w-64 rounded-2xl border border-amber-900 bg-slate-950 p-3 text-left text-[10px] shadow-2xl ${side === "left" ? "right-0" : "left-0"}`}>
      <b className="block text-amber-200">RANGO HABITUAL</b>
      <p className="mt-1 text-slate-300">La mitad central de los partidos de esta referencia está entre {format(stats.p25, suffix)} y {format(stats.p75, suffix)}. Ese intervalo representa el comportamiento habitual.</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-400"><dt>Actual</dt><dd className="text-right text-white">{format(value, suffix)}</dd><dt>Media</dt><dd className="text-right">{format(stats.mean, suffix)}</dd><dt>Mediana</dt><dd className="text-right">{format(stats.median, suffix)}</dd><dt>Mín / máx</dt><dd className="text-right">{format(stats.min, suffix)} / {format(stats.max, suffix)}</dd><dt>Partidos</dt><dd className="text-right">{stats.n}</dd></dl>
    </div>}
  </div>;
}
