"use client";

import { useMemo, useState } from "react";
import { DashboardMatchRecord } from "../../lib/dashboardAnalytics";
import {
  buildSetPieceFunnel,
  DashboardValueMode,
  normalizeDashboardCount,
  SET_PIECE_FUNNEL_OPTIONS,
  SetPieceFunnelKind,
  setPieceFunnelSignal,
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

const format = (value: number | null): string => value === null
  ? "—"
  : Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");

function TransitionSignal({ side, previous, next, from, to }: { side: "FOR" | "AGAINST"; previous: number; next: number; from: string; to: string }) {
  const signal = setPieceFunnelSignal(side, previous, next);
  if (!signal) return null;
  const progression = setPieceFunnelPercentage(next, previous) ?? 0;
  const attention = signal === "ATTENTION";
  const copy = side === "FOR"
    ? attention
      ? `Solo el ${Math.round(progression)}% de ${from.toLowerCase()} terminan en ${to.toLowerCase()}. Pérdida entre etapas: ${Math.round(100 - progression)}%. El aviso aparece cuando la pérdida supera el 65%.`
      : `El ${Math.round(progression)}% de ${from.toLowerCase()} terminan en ${to.toLowerCase()}. Progresión entre etapas: ${Math.round(progression)}%.`
    : attention
      ? `El rival conserva el ${Math.round(progression)}% de las acciones hasta ${to.toLowerCase()}.`
      : `Solo el ${Math.round(progression)}% de las acciones rivales progresa hasta ${to.toLowerCase()}.`;
  return <details data-abp-signal={signal} className="group relative inline-block">
    <summary aria-label={`${attention ? "Punto de atención" : "Fortaleza"}: ${copy}`} className={`grid h-5 w-5 cursor-pointer list-none place-items-center rounded-full text-[11px] font-black ${attention ? "bg-rose-500 text-white" : "bg-emerald-400 text-slate-950"}`}>!</summary>
    <div role="tooltip" className="absolute left-1/2 z-30 mt-1 hidden w-56 -translate-x-1/2 rounded-xl border border-slate-600 bg-slate-950 p-2 text-left text-[9px] leading-4 text-slate-200 shadow-2xl group-hover:block group-open:block"><b className={attention ? "text-rose-300" : "text-emerald-300"}>{attention ? "PUNTO DE ATENCIÓN" : "FORTALEZA"}</b><p>{copy}</p></div>
  </details>;
}

function FunnelSide({ title, side, tone, stats, displayStats, scaleMaximum, kind, habitual }: { title: string; side: "FOR" | "AGAINST"; tone: "cyan" | "rose"; stats: SetPieceFunnelSide; displayStats: SetPieceFunnelSide; scaleMaximum: number; kind: SetPieceFunnelKind; habitual: Array<{ key: string; p25: number; p75: number }> }) {
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
      {stages.map(({ key, label }, index) => {
        const value = displayStats[key];
        const previousStage = index > 0 ? stages[index - 1] : null;
        const percentage = previousStage ? setPieceFunnelPercentage(stats[key], stats[previousStage.key]) : null;
        const width = setPieceFunnelWidth(value, scaleMaximum);
        const usual = habitual.find((item) => item.key === key);
        const equivalent = key === "opportunities" || !usual ? null : [stats.opportunities * usual.p25 / 100, stats.opportunities * usual.p75 / 100];
        return <div key={key} data-abp-funnel-stage={key} data-value={value} data-width={width.toFixed(2)} className="text-center">
          <div className="mb-1 flex items-center justify-center gap-2"><span className="text-[9px] font-black tracking-wide text-slate-400">{label}</span><strong className="text-sm text-white">{format(value)}</strong>{previousStage && <small className="text-[10px] font-bold text-slate-400">{percentage === null ? "—" : `${Math.round(percentage)}%`}</small>}{previousStage && <TransitionSignal side={side} previous={stats[previousStage.key]} next={stats[key]} from={previousStage.label} to={label}/>}</div>
          <div data-abp-funnel-bar className={`mx-auto h-3 rounded-md ${fill}`} style={{ width: `${width}%` }}/>
          <p className="mt-1 text-[8px] text-slate-500">{usual ? key === "opportunities" ? `habitual ${usual.p25.toFixed(1)}–${usual.p75.toFixed(1)}/PJ` : `habitual ${usual.p25.toFixed(0)}–${usual.p75.toFixed(0)}%${equivalent ? ` · eq. ${equivalent[0].toFixed(1)}–${equivalent[1].toFixed(1)}` : ""}` : "Sin muestra habitual suficiente"}</p>
        </div>;
      })}
    </div>
    <div data-abp-total-shots className="mt-3 border-t border-slate-800 pt-2 text-center"><span className="text-[9px] font-black tracking-wide text-slate-500">REMATES TOTALES</span><strong className={`ml-2 text-lg ${text}`}>{format(displayStats.totalShots)}</strong><p className="text-[9px] text-slate-500">Una ABP puede generar más de un remate.</p></div>
  </article>;
}

export function SetPieceFunnel({ records, referenceRecords = [], mode, samples, observedMinutes }: { records: readonly DashboardMatchRecord[]; referenceRecords?: readonly DashboardMatchRecord[]; mode: DashboardValueMode; samples: number; observedMinutes: number }) {
  const [kind, setKind] = useState<SetPieceFunnelKind>("ALL");
  const funnel = useMemo(() => buildSetPieceFunnel(records, kind), [kind, records]);
  const habitual = useMemo(() => (["FOR", "AGAINST"] as const).map((side) => {
    const values = referenceRecords.map((record) => buildSetPieceFunnel([record], kind)[side]);
    return (["opportunities", "withShot", "withOnTarget", "withGoal"] as const).flatMap((key) => {
      const stats = describeDistribution(values.map((value) => key === "opportunities" ? value.opportunities : value.opportunities ? value[key] / value.opportunities * 100 : null));
      return stats.n >= MIN_MATCHES_FOR_HABITUAL_RANGE && stats.p25 !== null && stats.p75 !== null ? [{ key, p25: stats.p25, p75: stats.p75 }] : [];
    });
  }), [kind, referenceRecords]);
  const normalize = (value: number) => normalizeDashboardCount(value, mode, samples, observedMinutes) ?? 0;
  const display = (["FOR", "AGAINST"] as const).map((side): SetPieceFunnelSide => ({
    opportunities: normalize(funnel[side].opportunities),
    withShot: normalize(funnel[side].withShot),
    withOnTarget: normalize(funnel[side].withOnTarget),
    withGoal: normalize(funnel[side].withGoal),
    totalShots: normalize(funnel[side].totalShots),
  }));
  const scaleMaximum = Math.max(1, display[0].opportunities, display[1].opportunities);
  return <section data-abp-funnel className="rounded-2xl bg-slate-900/50 p-2 sm:p-3">
    <div className="mb-3 flex gap-2 overflow-x-auto pb-1" aria-label="Tipo de ABP">{SET_PIECE_FUNNEL_OPTIONS.map((option) => <button type="button" key={option.value} aria-pressed={kind === option.value} onClick={() => setKind(option.value)} className={`min-h-11 shrink-0 rounded-xl px-3 text-[10px] font-black ${kind === option.value ? "bg-amber-300 text-slate-950" : "bg-slate-800 text-slate-300"}`}>{option.label}</button>)}</div>
    <div className="grid gap-3 lg:grid-cols-2"><FunnelSide title="A FAVOR" side="FOR" tone="cyan" stats={funnel.FOR} displayStats={display[0]} scaleMaximum={scaleMaximum} kind={kind} habitual={habitual[0]}/><FunnelSide title="EN CONTRA" side="AGAINST" tone="rose" stats={funnel.AGAINST} displayStats={display[1]} scaleMaximum={scaleMaximum} kind={kind} habitual={habitual[1]}/></div>
    <p className="mt-2 text-center text-[9px] leading-relaxed text-slate-500">Escala común entre ambos lados. A puerta incluye GOL y PARADA; FUERA y BLOQUEADO no.</p>
  </section>;
}
