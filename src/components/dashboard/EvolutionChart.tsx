"use client";

import { useEffect, useRef, useState } from "react";
import { DistributionStats, MIN_MATCHES_FOR_HABITUAL_RANGE } from "../../lib/distributionStatistics";
import { adaptiveChartLayout } from "../../lib/dashboardSelectors";

export interface EvolutionPoint { id: string; label: string; detail: string; value: number | null; }

export function EvolutionChart({ points, reference, referenceLabel, distribution }: { points: EvolutionPoint[]; reference: number | null; referenceLabel: string; distribution?: DistributionStats }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(620);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const numeric = points.flatMap((point) => point.value === null ? [] : [point.value]);
  const max = Math.max(1, reference ?? 0, distribution?.max ?? 0, ...numeric);
  const [showRange, setShowRange] = useState(true);
  const rangeAvailable = !!distribution && distribution.n >= MIN_MATCHES_FOR_HABITUAL_RANGE;
  const layout = adaptiveChartLayout(points.length, width);
  return <div ref={host} data-evolution-chart data-point-count={points.length} className="w-full min-w-0 overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 p-3 sm:p-4">{distribution && <label className="mb-2 flex items-center gap-2 text-[9px] text-slate-400"><input type="checkbox" checked={showRange} onChange={event => setShowRange(event.target.checked)} disabled={!rangeAvailable}/>Rango habitual · │ Mediana · {referenceLabel} · N={distribution.n}{!rangeAvailable && " · Muestra reducida"}</label>}<div className="relative h-56 w-full min-w-0">
    {reference !== null && <div className="pointer-events-none absolute inset-x-1 bottom-7 top-0"><div className="absolute inset-x-0 border-t border-dashed border-amber-300" style={{ bottom: `${reference / max * 82}%` }}><span className="absolute right-0 -top-5 rounded bg-amber-950 px-2 py-0.5 text-[9px] font-black text-amber-100">{referenceLabel} {format(reference)}</span></div></div>}
    {showRange && rangeAvailable && distribution && <div aria-label={`Rango habitual ${format(distribution.p25!)}–${format(distribution.p75!)}; mediana ${format(distribution.median!)}`} className="pointer-events-none absolute inset-x-1 bottom-7 top-0"><div data-evolution-band className="absolute inset-x-0 border-y border-slate-500 bg-slate-400/15" style={{ bottom: `${distribution.p25! / max * 82}%`, height: `${(distribution.p75! - distribution.p25!) / max * 82}%` }}/><div className="absolute inset-x-0 border-t border-white/70" style={{ bottom: `${distribution.median! / max * 82}%` }}/></div>}
    <div className="absolute inset-0 grid items-end border-b border-slate-700 px-1 pb-7" style={{ gridTemplateColumns: `repeat(${Math.max(1, points.length)}, minmax(0, 1fr))`, gap: `${layout.gap}px` }}>{points.map((point, index) => <button type="button" key={point.id} title={`${point.label} · ${point.detail} · ${point.value === null ? "N/D" : format(point.value)}${reference === null ? "" : ` · ${referenceLabel} ${format(reference)}`}`} className="group relative h-full min-w-0"><span className="absolute inset-x-0 bottom-0 min-w-px rounded-t bg-cyan-400 transition group-focus:bg-cyan-200" style={{ height: point.value === null ? "0" : `${Math.max(3, point.value / max * 82)}%` }}/>{(index % layout.labelEvery === 0 || index === points.length - 1) && <strong className="absolute inset-x-0 bottom-[-22px] truncate text-[8px] text-slate-400">{point.label}</strong>}{point.value !== null && points.length <= 15 && <span className="absolute inset-x-0 text-center text-[8px] font-black text-white" style={{ bottom: `${Math.max(4, point.value / max * 82 + 1)}%` }}>{format(point.value)}</span>}</button>)}</div>
  </div></div>;
}

const format = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
