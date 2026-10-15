import Link from "next/link";
import { GoalkeeperAnalysis } from "../../lib/dashboardAnalysis";
import { KeeperBodyPart, SaveOutcome } from "../../types";
import { DashboardMatchRecord } from "../../lib/dashboardAnalytics";
import { DashboardValueMode, normalizeDashboardCount } from "../../lib/dashboardV2";
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
  selectedBodyParts?: KeeperBodyPart[];
  selectedSaveOutcomes?: SaveOutcome[];
  onBodyPart?: (part: KeeperBodyPart) => void;
  onSaveOutcome?: (outcome: SaveOutcome) => void;
  mode?: DashboardValueMode;
  samples?: number;
  secondaryStats?: { shots: number; goals: number; assists: number; losses: number; fouls: number; cards: number };
  onTrendSelect?: (matchId: string) => void;
  showEvolution?: boolean;
}

export function GoalkeeperAnalysisColumn({ keeper, records, detailHref, trend = [], onPoint, selectedBodyParts = [], selectedSaveOutcomes = [], onBodyPart, onSaveOutcome, mode = "TOTALS", samples = 1, secondaryStats, onTrendSelect, showEvolution = true }: GoalkeeperAnalysisColumnProps) {
  const count = (value: number) => normalizeDashboardCount(value, mode, samples, keeper.minutes);
  const global = keeper.playerId === "GLOBAL";
  return <article data-goalkeeper-global={global || undefined} className={`${global ? "space-y-2 p-2.5" : "space-y-3 p-3"} rounded-3xl border border-slate-700 bg-slate-900`}>
    {global ? <header className="flex min-h-12 flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-2xl bg-slate-950 px-3 py-2"><span className="text-[9px] font-black text-cyan-300">TODOS LOS PORTEROS</span><h3 className="text-lg font-black">GLOBAL</h3><strong className="text-2xl">{format(keeper.minutes, " min")}</strong><p className="ml-auto text-[10px] text-slate-500">P-J excluido</p></header> : <header className="flex items-center gap-3"><PlayerPhotoCard player={{ id: keeper.playerId, name: keeper.name, number: keeper.number, photoUrl: keeper.photoUrl }} className="h-24 w-20 shrink-0"/><div><span className="text-[9px] font-black text-cyan-300">#{keeper.number} · PORTERO</span><h3 className="text-lg font-black">{keeper.name}</h3><strong className="mt-1 block text-3xl">{format(keeper.minutes, " min")}</strong><p className="text-[10px] text-slate-500">P-J excluido</p></div></header>}
    <div className="grid grid-cols-3 gap-1.5"><Kpi compact={global} label={mode === "TOTALS" ? "AMENAZAS" : mode === "PER_MATCH" ? "AME/PARTIDO" : "AMENAZAS/40"} value={format(count(keeper.threatsAgainst))}/><Kpi compact={global} label="EXPOSICIÓN /40" value={format(keeper.threatsAgainst40)}/><Kpi compact={global} label="% PARADA" value={format(keeper.savePercentage, "%")}/><Kpi compact={global} label={mode === "TOTALS" ? "PARADAS" : mode === "PER_MATCH" ? "PARADAS/PARTIDO" : "PARADAS/40"} value={format(count(keeper.saves))}/><Kpi compact={global} label={mode === "TOTALS" ? "GOLES RECIBIDOS" : mode === "PER_MATCH" ? "GC/PARTIDO" : "GC/40"} value={format(count(keeper.goalsAgainst))}/><Kpi compact={global} label="GC/40" value={format(keeper.goalsAgainst40)}/></div>
    {secondaryStats && <div className="grid grid-cols-6 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1.5">{[["REM", secondaryStats.shots], ["GOL", secondaryStats.goals], ["ASI", secondaryStats.assists], ["PÉR", secondaryStats.losses], ["FAL", secondaryStats.fouls], ["TAR", secondaryStats.cards]].map(([label, value]) => <span key={label} className="text-center text-[8px] font-black text-slate-500"><b className="block text-sm text-white">{value}</b>{label}</span>)}</div>}
    <div className={`rounded-2xl bg-slate-950 ${global ? "p-2" : "p-3"}`}><h4 className={`${global ? "mb-1" : "mb-2"} text-[9px] font-black text-slate-500`}>TIPO DE PARADA · TOCA PARA FILTRAR</h4><SaveOutcomeSummary keeper={keeper} selected={selectedSaveOutcomes} onSelect={onSaveOutcome} compact={global}/></div>
    <KeeperBodySummary keeper={keeper} selected={selectedBodyParts} onSelect={onBodyPart}/>
    <GoalThreatMap points={keeper.goalPoints} onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(records, point)}/>
    <PitchThreatMap points={keeper.originPoints} side="AGAINST" onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(records, point)}/>
    {showEvolution && <EvolutionChart points={trend} reference={null} referenceLabel="MEDIA" onSelect={onTrendSelect ? (point) => onTrendSelect(point.id) : undefined}/>}
    {detailHref && <Link href={detailHref} className="inline-flex min-h-10 items-center rounded-xl border border-cyan-800 px-4 text-[10px] font-black text-cyan-200">VER DETALLE</Link>}
  </article>;
}

function Kpi({ label, value, compact = false }: { label: string; value: string | number; compact?: boolean }) {
  return <div className={`rounded-xl bg-slate-950 ${compact ? "px-2 py-1.5" : "p-2"}`}><span className="block text-[8px] font-black text-slate-500">{label}</span><strong className={compact ? "text-base" : "text-lg"}>{value}</strong></div>;
}
