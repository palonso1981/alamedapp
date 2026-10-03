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
  { key: "withOnTarget", label: "A PUERTA" },
  { key: "withGoal", label: "GOL" },
];

function FunnelSide({ title, tone, stats, scaleMaximum }: { title: string; tone: "cyan" | "rose"; stats: SetPieceFunnelSide; scaleMaximum: number }) {
  const fill = tone === "cyan" ? "bg-cyan-400" : "bg-rose-400";
  const text = tone === "cyan" ? "text-cyan-200" : "text-rose-200";
  if (stats.opportunities === 0) return <article className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-5 text-center"><h3 className={`text-sm font-black ${text}`}>{title}</h3><p className="mt-5 text-sm text-slate-500">Sin ABP registradas</p></article>;

  return <article data-abp-funnel-side={title} className="rounded-xl bg-slate-950/70 p-3">
    <h3 className={`text-center text-sm font-black tracking-wide ${text}`}>{title}</h3>
    <div className="mt-3 space-y-2">
      {STAGES.map(({ key, label }) => {
        const value = stats[key];
        const percentage = setPieceFunnelPercentage(value, stats.opportunities);
        const width = setPieceFunnelWidth(value, scaleMaximum);
        return <div key={key} data-abp-funnel-stage={key} data-value={value} data-width={width.toFixed(2)} className="text-center">
          <div className="mb-1 flex items-baseline justify-center gap-2"><span className="text-[9px] font-black tracking-wide text-slate-400">{label}</span><strong className="text-sm text-white">{value}</strong><small className="text-[10px] font-bold text-slate-400">{percentage === null ? "—" : `${Math.round(percentage)}%`}</small></div>
          <div data-abp-funnel-bar className={`mx-auto h-3 rounded-md ${fill}`} style={{ width: `${width}%` }}/>
        </div>;
      })}
    </div>
    <div data-abp-total-shots className="mt-3 border-t border-slate-800 pt-2 text-center"><span className="text-[9px] font-black tracking-wide text-slate-500">REMATES TOTALES</span><strong className={`ml-2 text-lg ${text}`}>{stats.totalShots}</strong><p className="text-[9px] text-slate-500">Una ABP puede generar más de un remate.</p></div>
  </article>;
}

export function SetPieceFunnel({ records }: { records: readonly DashboardMatchRecord[] }) {
  const [kind, setKind] = useState<SetPieceFunnelKind>("ALL");
  const funnel = useMemo(() => buildSetPieceFunnel(records, kind), [kind, records]);
  return <section data-abp-funnel className="rounded-2xl bg-slate-900/50 p-2 sm:p-3">
    <div className="mb-3 flex gap-2 overflow-x-auto pb-1" aria-label="Tipo de ABP">{SET_PIECE_FUNNEL_OPTIONS.map((option) => <button type="button" key={option.value} aria-pressed={kind === option.value} onClick={() => setKind(option.value)} className={`min-h-11 shrink-0 rounded-xl px-3 text-[10px] font-black ${kind === option.value ? "bg-amber-300 text-slate-950" : "bg-slate-800 text-slate-300"}`}>{option.label}</button>)}</div>
    <div className="grid gap-3 lg:grid-cols-2"><FunnelSide title="ABP A FAVOR" tone="cyan" stats={funnel.FOR} scaleMaximum={funnel.scaleMaximum}/><FunnelSide title="ABP EN CONTRA" tone="rose" stats={funnel.AGAINST} scaleMaximum={funnel.scaleMaximum}/></div>
    <p className="mt-2 text-center text-[9px] leading-relaxed text-slate-500">Escala común entre ambos lados. A puerta incluye GOL y PARADA; FUERA y BLOQUEADO no.</p>
  </section>;
}
