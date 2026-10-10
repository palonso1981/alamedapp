"use client";

import { createContext, ReactNode, useContext, useMemo, useRef } from "react";
import { DashboardMatchRecord } from "../../lib/dashboardAnalytics";
import { DashboardScopeV2, DashboardValueMode } from "../../lib/dashboardV2";
import { buildDistributionUniverse, metricComparison, MetricComparison, MetricDistribution } from "../../lib/dashboardDistribution";
import { distributionPosition, distributionScale, DistributionScale, distributionTone, MIN_MATCHES_FOR_HABITUAL_RANGE } from "../../lib/distributionStatistics";

const DistributionContext = createContext<{ get: (metric: string, mode?: DashboardValueMode) => MetricComparison; referenceLabel: string; currentLabel: string } | null>(null);
export function DashboardDistributionProvider({ records, scope, referenceScope, mode, enabled, active, referenceLabel, currentLabel, children }: { records: DashboardMatchRecord[]; scope: DashboardScopeV2; referenceScope: DashboardScopeV2; mode: DashboardValueMode; enabled: boolean; active: boolean; referenceLabel: string; currentLabel: string; children: ReactNode }) {
  const value = useMemo(() => {
    if (!active) return null;
    const current = buildDistributionUniverse(records, scope), reference = enabled ? buildDistributionUniverse(records, referenceScope) : null;
    const cache = new Map<string, MetricComparison>();
    return { referenceLabel, currentLabel, get: (metric: string, requested = mode) => {
      const key = `${metric}:${requested}`; let result = cache.get(key);
      if (!result) { result = metricComparison(current, reference, metric, requested); cache.set(key, result); }
      return result;
    } };
  }, [active, records, scope, referenceScope, mode, enabled, referenceLabel, currentLabel]);
  return <DistributionContext.Provider value={value}>{children}</DistributionContext.Provider>;
}
const format = (n: number | null) => n === null ? "N/D" : n.toLocaleString("es-ES", { maximumFractionDigits: 1 });
const HELP = `RANGO HABITUAL: el 50% central de los partidos de la referencia está dentro de este intervalo. MEDIANA: la mitad de los partidos queda por debajo y la mitad por encima. DESVIACIÓN: indica cuánto varía el dato entre partidos. Menos de ${MIN_MATCHES_FOR_HABITUAL_RANGE} partidos: muestra reducida; sin banda habitual. N cuenta valores calculables; los ceros reales se incluyen.`;
export function distributionExtent(comparison: MetricComparison): Array<number | null> { const s = (comparison.reference ?? comparison.current).stats; return [s.min, s.max, comparison.value, comparison.referenceValue]; }
function StatsDetail({ data, title }: { data: MetricDistribution; title: string }) {
  const s = data.stats;
  return <div className="min-w-0"><h4 className="mb-2 break-words text-xs font-black text-slate-200">{title}</h4><dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 text-xs text-slate-300">{[["Media", format(s.mean)], ["Mediana", format(s.median)], [s.n >= MIN_MATCHES_FOR_HABITUAL_RANGE ? "Rango habitual" : "Intervalo central · muestra reducida", `${format(s.p25)}–${format(s.p75)}`], ["Desviación", format(s.stdDev)], ["Mín–Máx", `${format(s.min)}–${format(s.max)}`], ["N partidos", s.n]].map(([label, value]) => <div key={String(label)} className="contents"><dt>{label}</dt><dd className="font-bold">{value}</dd></div>)}</dl>{s.missing > 0 && <p className="mt-1 text-[9px] text-amber-200">{s.missing} sin dato calculable</p>}{([["Mín", data.minimumMatches], ["Máx", data.maximumMatches]] as const).map(([label, matches]) => matches.length > 0 && <p key={label} className="mt-1 break-words text-[9px] text-slate-400" title={matches.map(m => m.label).join("; ")}>{label} · {matches.length === 1 ? matches[0].label : `${matches.length} partidos empatados`}</p>)}</div>;
}
export function DistributionStrip({ comparison, referenceLabel, currentLabel, scale }: { comparison: MetricComparison; referenceLabel: string; currentLabel: string; scale?: DistributionScale }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { definition, value, referenceValue } = comparison, data = comparison.reference ?? comparison.current, s = data.stats;
  const domain = scale ?? distributionScale(distributionExtent(comparison)), pos = (v: number) => distributionPosition(v, domain);
  const limited = s.n < MIN_MATCHES_FOR_HABITUAL_RANGE;
  const tone = distributionTone(value, referenceValue, definition.direction);
  const color = tone === "positive" ? "fill-emerald-300" : tone === "negative" ? "fill-rose-300" : "fill-cyan-200";
  const label = comparison.reference ? referenceLabel : currentLabel;
  const unit = definition.percentage ? "%" : "";
  return <div data-distribution={comparison.metric} className="mt-2 min-w-0 text-left">
    <button type="button" onClick={() => dialog.current?.showModal()} aria-haspopup="dialog" className="block w-full cursor-pointer rounded text-left focus-visible:outline focus-visible:outline-cyan-300" aria-label={`Distribución de ${definition.label}. ${label}. Actual ${format(value)}${unit}, referencia ${format(referenceValue)}${unit}, mediana ${format(s.median)}${unit}, ${s.n} partidos. ${limited ? "Muestra reducida" : `Rango habitual ${format(s.p25)}–${format(s.p75)}${unit}`}. Ver detalle`}>
      <span className="flex min-w-0 items-baseline justify-between gap-2 text-[9px] text-slate-400"><span className="truncate" title={label}>{comparison.reference ? `○ ${label}` : label}</span>{comparison.reference && <b className="shrink-0 text-slate-300">{format(referenceValue)}{unit}</b>}<span className="shrink-0">{limited ? "⚠ " : ""}N={s.n} ⌄</span></span>
      <svg role="img" aria-label={`${definition.label}: ● actual, ○ referencia, │ mediana, banda rango habitual. Escala ${format(domain.min)} a ${format(domain.max)}${unit}`} className={`h-9 w-full overflow-visible ${limited ? "opacity-50" : ""}`}>
        <line x1="0%" x2="100%" y1="18" y2="18" stroke="#64748b" strokeWidth=".5" />
        {!limited && s.p25 !== null && s.p75 !== null && <rect data-habitual-band x={`${pos(s.p25)}%`} y="14" width={`${Math.max(.2, pos(s.p75) - pos(s.p25))}%`} height="8" fill="#475569" stroke="#94a3b8" strokeWidth=".4" />}
        {s.median !== null && <line data-median x1={`${pos(s.median)}%`} x2={`${pos(s.median)}%`} y1="10" y2="26" stroke="#f8fafc" strokeWidth=".6" />}
        {referenceValue !== null && <circle data-reference cx={`${pos(referenceValue)}%`} cy="28" r="3" fill="#0f172a" stroke="#fcd34d" strokeWidth=".7" />}
        {value !== null && <circle data-current cx={`${pos(value)}%`} cy="8" r="3" className={color} stroke="#f8fafc" strokeWidth=".5" />}
      </svg>
      <span className="flex justify-between text-[8px] text-slate-500"><span>{format(domain.min)}</span><span>{limited ? "MUESTRA REDUCIDA" : "RANGO HABITUAL"}</span><span>{format(domain.max)}{unit}</span></span>
    </button>
    <dialog ref={dialog} aria-label={`Distribución de ${definition.label}`} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }} className="max-h-[85dvh] w-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto rounded-2xl border border-slate-600 bg-slate-950 p-4 text-white shadow-2xl backdrop:bg-black/60"><header className="mb-4 flex items-center justify-between gap-3"><h3 className="text-sm font-black">{definition.label}</h3><button type="button" autoFocus onClick={() => dialog.current?.close()} className="min-h-10 rounded-lg bg-slate-800 px-3 text-xs">CERRAR</button></header><p className="mb-3 text-sm">● Actual <b>{format(value)}{unit}</b>{comparison.reference && <> · ○ Referencia <b>{format(referenceValue)}{unit}</b></>}</p><div><div className={`grid gap-3 ${comparison.reference ? "sm:grid-cols-2" : ""}`}><StatsDetail data={comparison.current} title={currentLabel}/>{comparison.reference && <StatsDetail data={comparison.reference} title={referenceLabel}/>}</div><p className="mt-2 text-[9px] text-slate-400">● Actual · ○ Referencia · │ Mediana · ▰ Rango habitual</p><details className="mt-3 text-xs text-slate-400"><summary className="cursor-pointer">Cómo leer la distribución</summary><p className="mt-2">{HELP}</p><p className="mt-1 text-[9px] text-slate-500">Escala lineal completa, sin recortar extremos. Cada partido cuenta una vez. En modo Total los marcadores siguen siendo acumulados; la banda describe partidos individuales.</p></details></div></dialog>
  </div>;
}
export function MetricRange({ metric, mode, peerMetric }: { metric: string; mode?: DashboardValueMode; peerMetric?: string }) {
  const context = useContext(DistributionContext);
  return context ? <DistributionStrip comparison={context.get(metric, mode)} referenceLabel={context.referenceLabel} currentLabel={context.currentLabel} scale={peerMetric ? distributionScale([context.get(metric, mode), context.get(peerMetric, mode)].flatMap(distributionExtent)) : undefined}/> : null;
}
/** Both sides of a faced row always share a domain. */
export function MetricRangePair({ metrics, mode, scaleMetrics, stacked = false }: { stacked?: boolean; metrics: readonly [string, string]; mode?: DashboardValueMode; scaleMetrics?: readonly string[] }) {
  const context = useContext(DistributionContext);
  if (!context) return null;
  const pair = metrics.map(metric => context.get(metric, mode));
  const scale = distributionScale((scaleMetrics ? scaleMetrics.map(metric => context.get(metric, mode)) : pair).flatMap(distributionExtent));
  return <div className={`grid min-w-0 gap-3 ${stacked ? "grid-cols-1" : "grid-cols-2"}`}>{pair.map((comparison, i) => <DistributionStrip key={i} comparison={comparison} referenceLabel={context.referenceLabel} currentLabel={context.currentLabel} scale={scale}/>)}</div>;
}
