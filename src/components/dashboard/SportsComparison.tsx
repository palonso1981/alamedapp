import { DashboardAnalysis } from "../../lib/dashboardAnalysis";
import { DashboardValueMode, outcomeDistribution, TeamMetricKey, teamMetricValue } from "../../lib/dashboardV2";
import { ThreatOutcomeStats } from "../../lib/dashboardAnalytics";
import { ThreatSide } from "../../types";

const format = (value: number | null, suffix = "") => value === null ? "N/D" : `${Number.isInteger(value) ? value : value.toFixed(1).replace(".", ",")}${suffix}`;

export function FacedMetricRow({ label, own, rival, ownReference, rivalReference, semantics = "neutral" }: { label: string; own: number | null; rival: number | null; ownReference: number | null; rivalReference: number | null; semantics?: "higher" | "lower" | "neutral" }) {
  const max = Math.max(1, own ?? 0, rival ?? 0, ownReference ?? 0, rivalReference ?? 0);
  const ownDiff = own === null || ownReference === null ? null : own - ownReference;
  const rivalDiff = rival === null || rivalReference === null ? null : rival - rivalReference;
  const differenceColor = (difference: number | null, side: "own" | "rival") => {
    if (difference === null || semantics === "neutral") return "text-slate-400";
    const beneficial = semantics === "higher" ? difference > 0 : difference < 0;
    return side === "own" && beneficial ? "text-emerald-300" : side === "own" ? "text-rose-300" : "text-slate-400";
  };
  return <div className="grid grid-cols-[3rem_minmax(4rem,1fr)_6rem_minmax(4rem,1fr)_3rem] items-center gap-2">
    <strong className="text-right text-sm text-cyan-200">{format(own)}</strong>
    <div className="relative h-7 rounded-l-full bg-slate-950"><span className="absolute right-0 top-1 h-5 rounded-l-full bg-cyan-400" style={{ width: `${(own ?? 0) / max * 100}%` }} />{ownReference !== null && <i title={`Referencia ${format(ownReference)}`} aria-label={`Referencia ${format(ownReference)}`} className="absolute bottom-[-2px] top-[-2px] z-10 border-l-2 border-dashed border-amber-200" style={{ right: `${ownReference / max * 100}%` }}><b className="absolute -top-3 -translate-x-1/2 text-[8px] not-italic text-amber-100">{format(ownReference)}</b></i>}</div>
    <div className="text-center"><strong className="block text-[10px]">{label}</strong><span className="text-[8px] text-slate-500">ACTUAL · ◇ MEDIA</span><span className={`block text-[8px] ${differenceColor(ownDiff, "own")}`}>CDA Δ {format(ownDiff)}</span></div>
    <div className="relative h-7 rounded-r-full bg-slate-950"><span className="absolute left-0 top-1 h-5 rounded-r-full bg-rose-400" style={{ width: `${(rival ?? 0) / max * 100}%` }} />{rivalReference !== null && <i title={`Referencia ${format(rivalReference)}`} aria-label={`Referencia ${format(rivalReference)}`} className="absolute bottom-[-2px] top-[-2px] z-10 border-l-2 border-dashed border-amber-200" style={{ left: `${rivalReference / max * 100}%` }}><b className="absolute -top-3 -translate-x-1/2 text-[8px] not-italic text-amber-100">{format(rivalReference)}</b></i>}</div>
    <strong className="text-sm text-rose-200">{format(rival)}</strong>
    <span className="col-start-4 col-span-2 text-[8px] text-slate-500">RIV Δ <b className={differenceColor(rivalDiff, "rival")}>{format(rivalDiff)}</b></span>
  </div>;
}

export function TeamComparison({ analysis, reference, mode }: { analysis: DashboardAnalysis; reference: DashboardAnalysis; mode: DashboardValueMode }) {
  const comparisonMode = mode === "TOTALS" ? "PER_MATCH" : mode;
  const pair = (own: TeamMetricKey, rival: TeamMetricKey) => ({ own: teamMetricValue(analysis, own, comparisonMode), rival: teamMetricValue(analysis, rival, comparisonMode), ownReference: teamMetricValue(reference, own, comparisonMode), rivalReference: teamMetricValue(reference, rival, comparisonMode) });
  return <article className="space-y-4 rounded-3xl border border-slate-700 bg-slate-900 p-4">
    <div className="flex justify-between text-[9px] font-black"><span className="text-cyan-300">CDA</span><span className="text-slate-500">{comparisonMode === "PER_MATCH" ? "POR PARTIDO" : "POR 40"} · MARCA = REFERENCIA</span><span className="text-rose-300">RIVAL</span></div>
    <FacedMetricRow label="REMATES" {...pair("threatsFor", "threatsAgainst")} semantics="higher" />
    <FacedMetricRow label="GOLES" {...pair("goalsFor", "goalsAgainst")} semantics="higher" />
    <FacedMetricRow label="FALTAS" {...pair("foulsFor", "foulsAgainst")} semantics="neutral" />
  </article>;
}

const colors: Record<string, string> = { GOL: "bg-rose-500", PARADA: "bg-emerald-400", FUERA: "bg-amber-300", BLOQUEADO: "bg-slate-500" };

export function OutcomeDistribution({ side, stats, reference }: { side: ThreatSide; stats: ThreatOutcomeStats; reference: ThreatOutcomeStats }) {
  const items = outcomeDistribution(stats);
  const referenceItems = new Map(outcomeDistribution(reference).map((item) => [item.outcome, item]));
  return <article className="rounded-3xl border border-slate-700 bg-slate-900 p-4">
    <div className="flex items-end justify-between"><div><span className="text-[9px] font-black tracking-[.16em] text-slate-500">{side === "FOR" ? "REMATES" : "AMENAZAS"}</span><h3 className="text-lg font-black">{side === "FOR" ? "CDA" : "RECIBIDAS"}</h3></div><strong className="text-4xl">{stats.total}</strong></div>
    <div className="mt-4 flex h-4 overflow-hidden rounded-full bg-slate-950">{items.map((item) => <span key={item.outcome} className={colors[item.outcome]} style={{ width: `${item.percentage ?? 0}%` }} title={`${item.outcome} ${format(item.percentage, "%")}`} />)}</div>
    <div className="mt-3 grid grid-cols-3 gap-2">{items.map((item) => { const ref = referenceItems.get(item.outcome)?.percentage ?? null; const difference = item.percentage === null || ref === null ? null : item.percentage - ref; return <div key={item.outcome} className="rounded-xl bg-slate-950 p-2 text-center"><strong className="block text-xl">{item.count}</strong><span className="block text-[9px] font-black">{item.outcome} · {format(item.percentage, "%")}</span><span className="text-[8px] text-amber-200">MEDIA {format(ref, "%")} · Δ {format(difference, " pp")}</span></div>; })}</div>
  </article>;
}
