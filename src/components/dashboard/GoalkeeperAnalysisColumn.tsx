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
}

export function GoalkeeperAnalysisColumn({ keeper, records, detailHref, trend = [], onPoint, selectedBodyParts = [], selectedSaveOutcomes = [], onBodyPart, onSaveOutcome, mode = "TOTALS", samples = 1, secondaryStats, onTrendSelect }: GoalkeeperAnalysisColumnProps) {
  const count = (value: number) => normalizeDashboardCount(value, mode, samples, keeper.minutes);
  return <article className="space-y-3 rounded-3xl border border-slate-700 bg-slate-900 p-3">
    <header className="flex items-center gap-3">{keeper.playerId === "GLOBAL" ? <div className="grid h-24 w-20 shrink-0 place-items-center rounded-2xl border border-cyan-800 bg-cyan-950 text-3xl">🥅</div> : <PlayerPhotoCard player={{ id: keeper.playerId, name: keeper.name, number: keeper.number, photoUrl: keeper.photoUrl }} className="h-24 w-20 shrink-0"/>}<div><span className="text-[9px] font-black text-cyan-300">{keeper.playerId === "GLOBAL" ? "TODOS LOS PORTEROS" : `#${keeper.number} · PORTERO`}</span><h3 className="text-lg font-black">{keeper.name}</h3><strong className="mt-1 block text-3xl">{format(keeper.minutes, " min")}</strong><p className="text-[10px] text-slate-500">P-J excluido</p></div></header>
    <div className="grid grid-cols-3 gap-2"><Kpi label={mode === "TOTALS" ? "AMENAZAS" : mode === "PER_MATCH" ? "AME/PARTIDO" : "AMENAZAS/40"} value={format(count(keeper.threatsAgainst))}/><Kpi label="EXPOSICIÓN /40" value={format(keeper.threatsAgainst40)}/><Kpi label="% PARADA" value={format(keeper.savePercentage, "%")}/><Kpi label={mode === "TOTALS" ? "PARADAS" : mode === "PER_MATCH" ? "PARADAS/PARTIDO" : "PARADAS/40"} value={format(count(keeper.saves))}/><Kpi label={mode === "TOTALS" ? "GOLES RECIBIDOS" : mode === "PER_MATCH" ? "GC/PARTIDO" : "GC/40"} value={format(count(keeper.goalsAgainst))}/><Kpi label="GC/40" value={format(keeper.goalsAgainst40)}/></div>
    {secondaryStats && <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-800 bg-slate-950 p-2 sm:grid-cols-6">{[["REM", secondaryStats.shots], ["GOL", secondaryStats.goals], ["ASI", secondaryStats.assists], ["PÉR", secondaryStats.losses], ["FAL", secondaryStats.fouls], ["TAR", secondaryStats.cards]].map(([label, value]) => <span key={label} className="text-center text-[8px] font-black text-slate-500"><b className="block text-base text-white">{value}</b>{label}</span>)}</div>}
    <div className="rounded-2xl bg-slate-950 p-3"><h4 className="mb-2 text-[9px] font-black text-slate-500">TIPO DE PARADA · TOCA PARA FILTRAR</h4><SaveOutcomeSummary keeper={keeper} selected={selectedSaveOutcomes} onSelect={onSaveOutcome}/></div>
    <KeeperBodySummary keeper={keeper} selected={selectedBodyParts} onSelect={onBodyPart}/>
    <GoalThreatMap points={keeper.goalPoints} onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(records, point)}/>
    <PitchThreatMap points={keeper.originPoints} side="AGAINST" onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(records, point)}/>
    <EvolutionChart points={trend} reference={null} referenceLabel="MEDIA" onSelect={onTrendSelect ? (point) => onTrendSelect(point.id) : undefined}/>
    {detailHref && <Link href={detailHref} className="inline-flex min-h-10 items-center rounded-xl border border-cyan-800 px-4 text-[10px] font-black text-cyan-200">VER DETALLE</Link>}
  </article>;
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-slate-950 p-2"><span className="block text-[8px] font-black text-slate-500">{label}</span><strong className="text-lg">{value}</strong></div>;
}
