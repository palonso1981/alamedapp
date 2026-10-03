"use client";

import { useMemo, useState } from "react";
import { DashboardMatchRecord } from "../../lib/dashboardAnalytics";
import {
  buildSetPieceFunnel,
  SET_PIECE_FUNNEL_OPTIONS,
  SetPieceFunnelKind,
  SetPieceFunnelSide,
  setPieceFunnelPercentage,
  setPieceFunnelWidth,
} from "../../lib/dashboardV2";

const STAGES: ReadonlyArray<{ key: keyof Pick<SetPieceFunnelSide, "opportunities" | "withShot" | "withOnTarget" | "withGoal">; label: string }> = [
  { key: "opportunities", label: "ABP" },
  { key: "withShot", label: "GENERAN REMATE" },
  { key: "withOnTarget", label: "GENERAN REMATE A PUERTA" },
  { key: "withGoal", label: "GENERAN GOL" },
];

function FunnelSide({ title, tone, stats, scaleMaximum }: { title: string; tone: "cyan" | "rose"; stats: SetPieceFunnelSide; scaleMaximum: number }) {
  const fill = tone === "cyan" ? "bg-cyan-400" : "bg-rose-400";
  const text = tone === "cyan" ? "text-cyan-200" : "text-rose-200";
  if (stats.opportunities === 0) return <article className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-5 text-center"><h3 className={`text-sm font-black ${text}`}>{title}</h3><p className="mt-5 text-sm text-slate-500">Sin ABP registradas</p></article>;

  return <article data-abp-funnel-side={title} className="rounded-2xl border border-slate-700 bg-slate-950/70 p-3 sm:p-4">
    <h3 className={`text-sm font-black tracking-wide ${text}`}>{title}</h3>
    <div className="mt-4 space-y-3">
      {STAGES.map(({ key, label }) => {
        const value = stats[key];
        const percentage = setPieceFunnelPercentage(value, stats.opportunities);
        const width = setPieceFunnelWidth(value, scaleMaximum);
        return <div key={key} data-abp-funnel-stage={key} data-value={value} data-width={width.toFixed(2)}>
          <div className="mb-1 flex items-end justify-between gap-3"><span className="text-[9px] font-black tracking-wide text-slate-400">{label}</span><span className="shrink-0 text-sm font-black text-white">{value} <small className="text-[10px] text-slate-400">· {percentage === null ? "—" : `${Math.round(percentage)}%`}</small></span></div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-800"><div className={`h-full min-w-0 rounded-full ${fill}`} style={{ width: `${width}%` }}/></div>
        </div>;
      })}
    </div>
    <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/80 p-3"><span className="text-[9px] font-black tracking-wide text-slate-500">REMATES TOTALES GENERADOS</span><strong className={`ml-3 text-xl ${text}`}>{stats.totalShots}</strong><p className="mt-1 text-[9px] text-slate-500">Una misma ABP puede generar varios remates.</p></div>
  </article>;
}

export function SetPieceFunnel({ records }: { records: readonly DashboardMatchRecord[] }) {
  const [kind, setKind] = useState<SetPieceFunnelKind>("ALL");
  const funnel = useMemo(() => buildSetPieceFunnel(records, kind), [kind, records]);
  return <section data-abp-funnel className="mb-4 rounded-2xl border border-amber-900/50 bg-slate-900/60 p-3 sm:p-4">
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1" aria-label="Tipo de ABP">{SET_PIECE_FUNNEL_OPTIONS.map((option) => <button type="button" key={option.value} aria-pressed={kind === option.value} onClick={() => setKind(option.value)} className={`min-h-11 shrink-0 rounded-xl px-3 text-[10px] font-black ${kind === option.value ? "bg-amber-300 text-slate-950" : "bg-slate-800 text-slate-300"}`}>{option.label}</button>)}</div>
    <div className="grid gap-3 lg:grid-cols-2"><FunnelSide title="ABP A FAVOR" tone="cyan" stats={funnel.FOR} scaleMaximum={funnel.scaleMaximum}/><FunnelSide title="ABP EN CONTRA" tone="rose" stats={funnel.AGAINST} scaleMaximum={funnel.scaleMaximum}/></div>
    <p className="mt-3 text-[9px] leading-relaxed text-slate-500">Escala común entre ambos lados. A puerta incluye GOL y PARADA; FUERA y BLOQUEADO no se consideran remate a puerta.</p>
  </section>;
}
