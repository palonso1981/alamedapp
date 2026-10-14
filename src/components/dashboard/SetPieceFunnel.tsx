"use client";

import { useMemo, useState } from "react";
import { DashboardMatchRecord } from "../../lib/dashboardAnalytics";
import {
  buildSetPieceFunnel,
  SET_PIECE_FUNNEL_OPTIONS,
  SetPieceFunnelKind,
  SetPieceFunnelSide,
  setPieceFunnelOpportunityLabel,
  setPieceFunnelPercentage,
  setPieceFunnelWidth,
} from "../../lib/dashboardV2";
import { describeDistribution, MIN_MATCHES_FOR_HABITUAL_RANGE } from "../../lib/distributionStatistics";
const RESULT_STAGES: ReadonlyArray<{ key: keyof Pick<SetPieceFunnelSide, "withShot" | "withOnTarget" | "withGoal">; label: string }> = [
  { key: "withShot", label: "REMATES" },
  { key: "withOnTarget", label: "A PUERTA" },
  { key: "withGoal", label: "GOL" },
];

function FunnelSide({ title, tone, stats, scaleMaximum, kind, habitual }: { title: string; tone: "cyan" | "rose"; stats: SetPieceFunnelSide; scaleMaximum: number; kind: SetPieceFunnelKind; habitual: Array<{ key: string; p25: number; p75: number }> }) {
  const fill = tone === "cyan" ? "bg-cyan-400" : "bg-rose-400";
  const text = tone === "cyan" ? "text-cyan-200" : "text-rose-200";
  const stages: ReadonlyArray<{ key: keyof Pick<SetPieceFunnelSide, "opportunities" | "withShot" | "withOnTarget" | "withGoal">; label: string }> = [
    { key: "opportunities", label: setPieceFunnelOpportunityLabel(kind) },
    ...RESULT_STAGES,
  ];
  if (stats.opportunities === 0) return <article className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-5 text-center"><h3 className={`text-sm font-black ${text}`}>{title}</h3><p className="mt-5 text-sm text-slate-500">Sin ABP registradas</p></article>;

  return <article data-abp-funnel-side={title} className="rounded-xl bg-slate-950/70 p-3">
    <h3 className={`text-center text-sm font-black tracking-wide ${text}`}>{title}</h3>
    <div className="mt-3 space-y-2">
      {stages.map(({ key, label }) => {
        const value = stats[key];
        const percentage = setPieceFunnelPercentage(value, stats.opportunities);
        const width = setPieceFunnelWidth(value, scaleMaximum);
        const usual = habitual.find((item) => item.key === key);
        const equivalent = key === "opportunities" || !usual ? null : [stats.opportunities * usual.p25 / 100, stats.opportunities * usual.p75 / 100];
        return <div key={key} data-abp-funnel-stage={key} data-value={value} data-width={width.toFixed(2)} className="text-center">
          <div className="mb-1 flex items-center justify-center gap-2"><span className="text-[9px] font-black tracking-wide text-slate-400">{label}</span><strong className="text-sm text-white">{value}</strong><small className="text-[10px] font-bold text-slate-400">{percentage === null ? "—" : `${Math.round(percentage)}%`}</small></div>
          <div data-abp-funnel-bar className={`mx-auto h-3 rounded-md ${fill}`} style={{ width: `${width}%` }}/>
          <p className="mt-1 text-[8px] text-slate-500">{usual ? key === "opportunities" ? `habitual ${usual.p25.toFixed(1)}–${usual.p75.toFixed(1)}/PJ` : `habitual ${usual.p25.toFixed(0)}–${usual.p75.toFixed(0)}%${equivalent ? ` · eq. ${equivalent[0].toFixed(1)}–${equivalent[1].toFixed(1)}` : ""}` : "Sin muestra habitual suficiente"}</p>
        </div>;
      })}
    </div>
    <div data-abp-total-shots className="mt-3 border-t border-slate-800 pt-2 text-center"><span className="text-[9px] font-black tracking-wide text-slate-500">REMATES TOTALES</span><strong className={`ml-2 text-lg ${text}`}>{stats.totalShots}</strong><p className="text-[9px] text-slate-500">Una ABP puede generar más de un remate.</p></div>
  </article>;
}

export function SetPieceFunnel({ records, referenceRecords = [] }: { records: readonly DashboardMatchRecord[]; referenceRecords?: readonly DashboardMatchRecord[] }) {
  const [kind, setKind] = useState<SetPieceFunnelKind>("ALL");
  const funnel = useMemo(() => buildSetPieceFunnel(records, kind), [kind, records]);
  const habitual = useMemo(() => (["FOR", "AGAINST"] as const).map((side) => {
    const values = referenceRecords.map((record) => buildSetPieceFunnel([record], kind)[side]);
    return (["opportunities", "withShot", "withOnTarget", "withGoal"] as const).flatMap((key) => {
      const stats = describeDistribution(values.map((value) => key === "opportunities" ? value.opportunities : value.opportunities ? value[key] / value.opportunities * 100 : null));
      return stats.n >= MIN_MATCHES_FOR_HABITUAL_RANGE && stats.p25 !== null && stats.p75 !== null ? [{ key, p25: stats.p25, p75: stats.p75 }] : [];
    });
  }), [kind, referenceRecords]);
  return <section data-abp-funnel className="rounded-2xl bg-slate-900/50 p-2 sm:p-3">
    <div className="mb-3 flex gap-2 overflow-x-auto pb-1" aria-label="Tipo de ABP">{SET_PIECE_FUNNEL_OPTIONS.map((option) => <button type="button" key={option.value} aria-pressed={kind === option.value} onClick={() => setKind(option.value)} className={`min-h-11 shrink-0 rounded-xl px-3 text-[10px] font-black ${kind === option.value ? "bg-amber-300 text-slate-950" : "bg-slate-800 text-slate-300"}`}>{option.label}</button>)}</div>
    <div className="grid gap-3 lg:grid-cols-2"><FunnelSide title="A FAVOR" tone="cyan" stats={funnel.FOR} scaleMaximum={funnel.scaleMaximum} kind={kind} habitual={habitual[0]}/><FunnelSide title="EN CONTRA" tone="rose" stats={funnel.AGAINST} scaleMaximum={funnel.scaleMaximum} kind={kind} habitual={habitual[1]}/></div>
    <p className="mt-2 text-center text-[9px] leading-relaxed text-slate-500">Escala común entre ambos lados. A puerta incluye GOL y PARADA; FUERA y BLOQUEADO no.</p>
  </section>;
}
