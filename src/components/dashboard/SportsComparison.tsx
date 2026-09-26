import { DashboardAnalysis } from "../../lib/dashboardAnalysis";
import { DashboardValueMode, homogeneousComparisonMode, outcomeDistribution, TeamMetricKey, teamMetricValue, teamPairedMetricValue } from "../../lib/dashboardV2";
import { PAIRED_METRIC_DEFINITIONS } from "../../lib/dashboardMetricDefinitions";
import { ThreatOutcomeStats } from "../../lib/dashboardAnalytics";
import { ThreatSide } from "../../types";
import { comparisonBarPercentage, comparisonBarValueStyle } from "../../lib/dashboardBarLayout";

const format = (value: number | null, suffix = "") => value === null ? "N/D" : `${Number.isInteger(value) ? value : value.toFixed(1).replace(".", ",")}${suffix}`;

export function FacedMetricRow({ label, own, rival, ownReference, rivalReference, ownGoals, rivalGoals, semantics = "neutral", showReference = true }: { label: string; own: number | null; rival: number | null; ownReference: number | null; rivalReference: number | null; ownGoals?: number; rivalGoals?: number; semantics?: "higher" | "lower" | "neutral"; showReference?: boolean }) {
  const max = Math.max(1, own ?? 0, rival ?? 0, ownReference ?? 0, rivalReference ?? 0, ownGoals ?? 0, rivalGoals ?? 0);
  const ownWidth = comparisonBarPercentage(own, max);
  const rivalWidth = comparisonBarPercentage(rival, max);
  const ownReferencePosition = comparisonBarPercentage(ownReference, max);
  const rivalReferencePosition = comparisonBarPercentage(rivalReference, max);
  const ownDiff = own === null || ownReference === null ? null : own - ownReference;
  const rivalDiff = rival === null || rivalReference === null ? null : rival - rivalReference;
  const differenceColor = (difference: number | null, side: "own" | "rival") => {
    if (difference === null || semantics === "neutral") return "text-slate-400";
    const beneficial = semantics === "higher" ? difference > 0 : difference < 0;
    return side === "own" && beneficial ? "text-emerald-300" : side === "own" ? "text-rose-300" : "text-slate-400";
  };
  return <div className="grid grid-cols-[minmax(6rem,1fr)_5rem_minmax(6rem,1fr)] items-center gap-2 sm:gap-3">
    <div className="relative h-8 rounded-l-full bg-slate-950"><span className="absolute right-0 top-1 h-6 rounded-l-full bg-cyan-400" style={{ width: `${ownWidth}%` }} /><strong data-bar-value="outside" data-bar-side="left" className="absolute top-1/2 z-20 -translate-y-1/2 whitespace-nowrap text-base font-black text-cyan-100" style={comparisonBarValueStyle("left", ownWidth)}>{format(own)}</strong>{showReference && ownReference !== null && <i title={`Referencia ${format(ownReference)}`} aria-label={`Referencia ${format(ownReference)}`} className="absolute bottom-[-2px] top-[-2px] z-10 border-l-2 border-dashed border-amber-200" style={{ right: `${ownReferencePosition}%` }}><b className="absolute -top-3 -translate-x-1/2 text-[8px] not-italic text-amber-100">{format(ownReference)}</b></i>}{ownGoals !== undefined && <span title={`${label} CDA · Remates ${format(own)} · Referencia ${format(ownReference)} · GF ${ownGoals} · % gol ${format(own && own > 0 ? ownGoals / own * 100 : null, "%")}`} aria-label={`GF ${ownGoals}`} className="absolute top-0 z-20 -translate-x-1/2 rounded-full border border-emerald-200 bg-emerald-500 px-1 text-[8px] font-black text-slate-950" style={{ right: `${comparisonBarPercentage(ownGoals, max)}%` }}>GF {ownGoals}</span>}</div>
    <div className="text-center"><strong className="block text-[10px]">{label}</strong><span className="text-[8px] text-slate-500">{showReference ? "ACTUAL · ◇ MEDIA" : "ACTUAL"}</span>{showReference && <span className={`block text-[8px] ${differenceColor(ownDiff, "own")}`}>CDA Δ {format(ownDiff)}</span>}</div>
    <div className="relative h-8 rounded-r-full bg-slate-950"><span className="absolute left-0 top-1 h-6 rounded-r-full bg-rose-400" style={{ width: `${rivalWidth}%` }} /><strong data-bar-value="outside" data-bar-side="right" className="absolute top-1/2 z-20 -translate-y-1/2 whitespace-nowrap text-base font-black text-rose-100" style={comparisonBarValueStyle("right", rivalWidth)}>{format(rival)}</strong>{showReference && rivalReference !== null && <i title={`Referencia ${format(rivalReference)}`} aria-label={`Referencia ${format(rivalReference)}`} className="absolute bottom-[-2px] top-[-2px] z-10 border-l-2 border-dashed border-amber-200" style={{ left: `${rivalReferencePosition}%` }}><b className="absolute -top-3 -translate-x-1/2 text-[8px] not-italic text-amber-100">{format(rivalReference)}</b></i>}{rivalGoals !== undefined && <span title={`${label} rival · Amenazas ${format(rival)} · Referencia ${format(rivalReference)} · GC ${rivalGoals} · % gol recibido ${format(rival && rival > 0 ? rivalGoals / rival * 100 : null, "%")}`} aria-label={`GC ${rivalGoals}`} className="absolute top-0 z-20 -translate-x-1/2 rounded-full border border-rose-200 bg-rose-500 px-1 text-[8px] font-black text-white" style={{ left: `${comparisonBarPercentage(rivalGoals, max)}%` }}>GC {rivalGoals}</span>}</div>
    {showReference && <span className="col-start-3 text-right text-[8px] text-slate-500">RIV Δ <b className={differenceColor(rivalDiff, "rival")}>{format(rivalDiff)}</b></span>}
  </div>;
}

export function TeamComparison({ analysis, reference, mode, comparisonEnabled = true }: { analysis: DashboardAnalysis; reference: DashboardAnalysis; mode: DashboardValueMode; comparisonEnabled?: boolean }) {
  const comparisonMode = homogeneousComparisonMode(analysis.samples, reference.samples, mode);
  const pair = (own: TeamMetricKey, rival: TeamMetricKey) => ({ own: teamMetricValue(analysis, own, comparisonMode), rival: teamMetricValue(analysis, rival, comparisonMode), ownReference: comparisonEnabled ? teamMetricValue(reference, own, comparisonMode) : null, rivalReference: comparisonEnabled ? teamMetricValue(reference, rival, comparisonMode) : null });
  return <article className="space-y-4 rounded-3xl border border-slate-700 bg-slate-900 p-4">
    <div className="flex justify-between text-[9px] font-black"><span className="text-cyan-300">CDA</span><span className="text-slate-500">{comparisonMode === "TOTALS" ? "VALOR DE PARTIDO" : comparisonMode === "PER_MATCH" ? "POR PARTIDO" : "POR 40"}{comparisonEnabled ? " · MARCA = REFERENCIA" : ""}</span><span className="text-rose-300">RIVAL</span></div>
    <FacedMetricRow label="REMATES" {...pair("threatsFor", "threatsAgainst")} semantics="higher" showReference={comparisonEnabled} />
    <FacedMetricRow label="GOLES" {...pair("goalsFor", "goalsAgainst")} semantics="higher" showReference={comparisonEnabled} />
    <FacedMetricRow label="FALTAS" {...pair("foulsFor", "foulsAgainst")} semantics="neutral" showReference={comparisonEnabled} />
    <div className="grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-2">{PAIRED_METRIC_DEFINITIONS.map((definition) => { const value = teamPairedMetricValue(analysis, definition.id, mode); return <div key={definition.id} title={definition.tooltip} className="rounded-xl bg-slate-950 p-3"><span className="text-[9px] font-black text-slate-500">{definition.label}</span><strong className="mt-1 block text-xl">{format(value.left)}–{format(value.right)} <small className={value.difference !== null && value.difference >= 0 ? "text-emerald-300" : "text-rose-300"}>· {value.difference !== null && value.difference > 0 ? "+" : ""}{format(value.difference)}</small></strong><span className="text-[8px] text-slate-500">{definition.differenceLabel}</span></div>; })}</div>
  </article>;
}

const colors: Record<string, string> = { GOL: "bg-rose-500", PARADA: "bg-emerald-400", FUERA: "bg-amber-300", BLOQUEADO: "bg-slate-500" };

export function OutcomeDistribution({ side, stats, reference }: { side: ThreatSide; stats: ThreatOutcomeStats; reference?: ThreatOutcomeStats }) {
  const items = outcomeDistribution(stats);
  const referenceItems = new Map(reference ? outcomeDistribution(reference).map((item) => [item.outcome, item]) : []);
  return <article className="rounded-3xl border border-slate-700 bg-slate-900 p-4">
    <div className="flex items-end justify-between"><div><span className="text-[9px] font-black tracking-[.16em] text-slate-500">{side === "FOR" ? "REMATES" : "AMENAZAS"}</span><h3 className="text-lg font-black">{side === "FOR" ? "CDA" : "RECIBIDAS"}</h3></div><strong className="text-4xl">{stats.total}</strong></div>
    <div className="mt-4 flex h-4 overflow-hidden rounded-full bg-slate-950">{items.map((item) => <span key={item.outcome} className={colors[item.outcome]} style={{ width: `${item.percentage ?? 0}%` }} title={`${item.outcome} ${format(item.percentage, "%")}`} />)}</div>
    <div className="mt-3 grid grid-cols-3 gap-2">{items.map((item) => { const ref = referenceItems.get(item.outcome)?.percentage ?? null; const difference = item.percentage === null || ref === null ? null : item.percentage - ref; return <div key={item.outcome} className="rounded-xl bg-slate-950 p-2 text-center"><strong className="block text-xl">{item.count}</strong><span className="block text-[9px] font-black">{item.outcome} · {format(item.percentage, "%")}</span>{reference && <span className="text-[8px] text-amber-200">MEDIA {format(ref, "%")} · Δ {format(difference, " pp")}</span>}</div>; })}</div>
  </article>;
}
