import Link from "next/link";
import { GoalkeeperAnalysis } from "../../lib/dashboardAnalysis";
import { DashboardMatchRecord } from "../../lib/dashboardAnalytics";
import { dashboardMapPointTitle } from "../../lib/dashboardTrace";
import { PlayerPhotoCard } from "../player/PlayerPhotoCard";
import { KeeperBodySummary, SaveOutcomeSummary } from "./AnalysisVisuals";
import { TraceablePoint } from "./EventTracePanel";
import { EvolutionChart } from "./EvolutionChart";
import { GoalThreatMap, PitchThreatMap } from "./ThreatMaps";

const format = (value: number | null, suffix = "") => value === null ? "N/D" : `${Number.isInteger(value) ? value : value.toFixed(1).replace(".", ",")}${suffix}`;

export interface GoalkeeperAnalysisColumnProps {
  keeper: GoalkeeperAnalysis;
  records: DashboardMatchRecord[];
  detailHref?: string;
  trend?: Array<{ id: string; label: string; detail: string; value: number | null }>;
  onPoint: (point: TraceablePoint) => void;
}

export function GoalkeeperAnalysisColumn({ keeper, records, detailHref, trend = [], onPoint }: GoalkeeperAnalysisColumnProps) {
  return <article className="space-y-3 rounded-3xl border border-slate-700 bg-slate-900 p-3">
    <header className="flex items-center gap-3"><PlayerPhotoCard player={{ id: keeper.playerId, name: keeper.name, number: keeper.number, photoUrl: keeper.photoUrl }} className="h-24 w-20 shrink-0"/><div><span className="text-[9px] font-black text-cyan-300">#{keeper.number} · PORTERO NORMAL</span><h3 className="text-lg font-black">{keeper.name}</h3><p className="text-[10px] text-slate-500">{format(keeper.minutes, " min")} · P-J excluido</p></div></header>
    <div className="grid grid-cols-3 gap-2"><Kpi label="AME/40" value={format(keeper.threatsAgainst40)}/><Kpi label="% PARADA" value={format(keeper.savePercentage, "%")}/><Kpi label="GC" value={keeper.goalsAgainst}/><Kpi label="% CLAVE" value={format(keeper.keyMinutesPercentage, "%")}/><Kpi label="% ORO" value={format(keeper.goldMinutesPercentage, "%")}/><Kpi label="PARADAS" value={keeper.saves}/></div>
    <PitchThreatMap points={keeper.originPoints} side="AGAINST" onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(records, point)}/>
    <GoalThreatMap points={keeper.goalPoints} onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(records, point)}/>
    <KeeperBodySummary keeper={keeper}/>
    <div className="rounded-2xl bg-slate-950 p-3"><h4 className="mb-2 text-[9px] font-black text-slate-500">DESENLACES</h4><SaveOutcomeSummary keeper={keeper}/></div>
    <EvolutionChart points={trend} reference={null} referenceLabel="MEDIA"/>
    {detailHref && <Link href={detailHref} className="inline-flex min-h-10 items-center rounded-xl border border-cyan-800 px-4 text-[10px] font-black text-cyan-200">VER DETALLE</Link>}
  </article>;
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-slate-950 p-2"><span className="block text-[8px] font-black text-slate-500">{label}</span><strong className="text-lg">{value}</strong></div>;
}
