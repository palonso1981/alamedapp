"use client";

import { useState } from "react";
import { MetricId, metricDefinition } from "../../lib/dashboardMetricDefinitions";

export function MetricHelp({ metricId, className = "" }: { metricId: MetricId; className?: string }) {
  const [open, setOpen] = useState(false);
  const metric = metricDefinition(metricId);
  return <span className={`relative inline-flex ${className}`}>
    <button type="button" aria-label={`Ayuda: ${metric.name}`} aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }} className="grid h-6 w-6 place-items-center rounded-full border border-slate-600 text-[10px] font-black text-slate-300">i</button>
    {open && <span role="dialog" className="absolute right-0 top-8 z-50 w-72 rounded-2xl border border-slate-600 bg-slate-950 p-3 text-left text-[10px] font-normal leading-relaxed text-slate-300 shadow-2xl"><strong className="block text-xs text-white">{metric.name}</strong><span className="mt-1 block">{metric.description}</span><span className="mt-2 block text-slate-500">Fórmula: {metric.formula}<br/>Denominador: {metric.denominator}</span></span>}
  </span>;
}
