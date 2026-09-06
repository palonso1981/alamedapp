"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppHeader } from "../../../../components/app/AppHeader";
import { DashboardFilterBar } from "../../../../components/dashboard/DashboardFilterBar";
import { GoalZoneGrid, KeeperBodySummary, SaveOutcomeSummary } from "../../../../components/dashboard/AnalysisVisuals";
import { GoalThreatMap } from "../../../../components/dashboard/ThreatMaps";
import { useDashboardProfileData } from "../../../../components/dashboard/useDashboardProfileData";
import { PlayerPhotoCard } from "../../../../components/player/PlayerPhotoCard";
import { ComparisonHeader } from "../../../../components/dashboard/ComparisonHeader";
import { EvolutionChart } from "../../../../components/dashboard/EvolutionChart";
import { MetricHelp } from "../../../../components/dashboard/MetricHelp";
import { buildDashboardV2 } from "../../../../lib/dashboardV2";
import { compareMetricValues, MetricId } from "../../../../lib/dashboardMetricDefinitions";
import { EventTracePanel, TraceablePoint } from "../../../../components/dashboard/EventTracePanel";
import { dashboardMapPointTitle } from "../../../../lib/dashboardTrace";

const format = (value: number | null, suffix = "") => value === null ? "N/D" : `${Number.isInteger(value) ? value : value.toFixed(1).replace(".", ",")}${suffix}`;
function Kpi({ label, value }: { label: string; value: string | number }) { return <div className="rounded-2xl border border-slate-700 bg-slate-900 p-3"><span className="text-[9px] font-black text-slate-500">{label}</span><strong className="mt-1 block text-2xl">{value}</strong></div>; }
function KeeperCompare({ label, metricId, left, right }: { label: string; metricId: MetricId; left: number | null; right: number | null }) {
  const winner = compareMetricValues(metricId, left, right);
  return <div className="grid grid-cols-[1fr_8rem_1fr] items-center gap-2 rounded-xl bg-slate-950 px-3 py-2"><strong className={`text-right ${winner === "LEFT" ? "text-emerald-300" : ""}`}>{format(left)}{winner === "LEFT" && " · mejor"}</strong><span className="flex items-center justify-center gap-1 text-center text-[9px] font-black text-slate-400">{label}<MetricHelp metricId={metricId}/></span><strong className={winner === "RIGHT" ? "text-emerald-300" : ""}>{format(right)}{winner === "RIGHT" && " · mejor"}</strong></div>;
}

export default function GoalkeeperDashboardPage({ params }: { params: { goalkeeperId: string } }) {
  const goalkeeperId = decodeURIComponent(params.goalkeeperId);
  const data = useDashboardProfileData(`/dashboard/portero/${encodeURIComponent(goalkeeperId)}`, "GOALKEEPERS");
  const [compareId, setCompareId] = useState("");
  const [selectedPoint, setSelectedPoint] = useState<TraceablePoint | null>(null);
  const [trendMetric, setTrendMetric] = useState<"minutes" | "threatsAgainst" | "threatsAgainst40" | "goalsAgainst" | "saves" | "savePercentage" | "catch" | "clearance" | "rebound">("savePercentage");
  const keeper = data.analysis.goalkeepers.find((candidate) => candidate.playerId === goalkeeperId);
  const comparison = data.analysis.goalkeepers.find((candidate) => candidate.playerId === compareId);
  const trend = useMemo(() => [...data.records].sort((a, b) => a.catalog.date.localeCompare(b.catalog.date)).map((record) => {
    const single = buildDashboardV2([record], { ...data.scope, matchIds: [record.catalog.matchId] });
    const item = single.goalkeepers.find((candidate) => candidate.playerId === goalkeeperId);
    const documented = item ? Object.values(item.saveOutcomes).reduce((sum, value) => sum + value, 0) : 0;
    const value = !item ? null : trendMetric === "catch" ? documented ? item.saveOutcomes.CATCH / documented * 100 : null : trendMetric === "clearance" ? documented ? item.saveOutcomes.CLEARANCE / documented * 100 : null : trendMetric === "rebound" ? documented ? item.saveOutcomes.REBOUND / documented * 100 : null : item[trendMetric];
    return { id: record.catalog.matchId, label: record.catalog.opponent, detail: `${record.catalog.date} · ${record.catalog.venue === "HOME" ? "Local" : "Visitante"}`, value };
  }).filter((item) => item.value !== null), [data.records, data.scope, goalkeeperId, trendMetric]);
  return <div className="min-h-screen overflow-x-clip bg-slate-950 text-white"><div className="sticky top-0 z-40"><AppHeader title="Portero · Dashboard" clubId={data.fixture ? undefined : data.currentClubId}/></div><main className="mx-auto max-w-7xl space-y-5 p-3 pb-16 sm:p-5">
    <DashboardFilterBar clubName={data.workspace?.club.name ?? "Club"} clubs={data.clubs} onClub={data.setCurrentClub} scope={data.scope} teams={data.teams} seasons={data.seasons} matches={data.matches} rivals={data.rivals} players={data.analysis.players} goalkeepers={data.analysis.goalkeepers} referencePreset={data.referencePreset} mode={data.mode} onScope={data.setScope} onReferencePreset={data.setReferencePreset} onMode={data.setMode} onRefresh={data.refresh} fixture={data.fixture}/>
    <Link href={`/dashboard?${data.query}`} className="inline-flex min-h-10 items-center rounded-xl border border-slate-700 px-4 text-[10px] font-black">← DASHBOARD</Link>
    <ComparisonHeader left={keeper?.name.toUpperCase() ?? "PORTERO"} right={comparison?.name.toUpperCase() ?? "SELECCIONA PORTERO B"} scope={data.scope}/>
    {!keeper ? <p className="rounded-3xl border border-dashed border-slate-700 p-10 text-center text-slate-500">Portero sin minutos normales en este scope. Los intervalos P-J permanecen separados.</p> : <>
      <header className="grid gap-4 rounded-3xl border border-slate-700 bg-gradient-to-r from-slate-900 to-sky-950 p-5 sm:grid-cols-[10rem_1fr] sm:items-center"><PlayerPhotoCard player={{ id: keeper.playerId, name: keeper.name, number: keeper.number, photoUrl: keeper.photoUrl }} className="h-48 w-40"/><div><span className="text-xs font-black text-cyan-300">#{keeper.number} · PORTERO FUNCIONAL</span><h1 className="text-3xl font-black">{keeper.name}</h1><p className="text-xs text-slate-400">{format(keeper.minutes, "'")} como portero normal · P-J excluido</p><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Kpi label="AMENAZAS" value={keeper.threatsAgainst}/><Kpi label="AMENAZAS /40" value={format(keeper.threatsAgainst40)}/><Kpi label="PARADAS" value={keeper.saves}/><Kpi label="% PARADA" value={format(keeper.savePercentage, "%")}/></div></div></header>
      <section className="rounded-3xl border border-slate-700 bg-slate-900 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-black">COMPARAR PORTEROS</h2><select value={compareId} onChange={(event) => setCompareId(event.target.value)} className="min-h-10 rounded-xl bg-slate-800 px-3 text-xs font-black"><option value="">Seleccionar portero B</option>{data.analysis.goalkeepers.filter((candidate) => candidate.playerId !== keeper.playerId).map((candidate) => <option key={candidate.playerId} value={candidate.playerId}>{candidate.name}</option>)}</select></div>{comparison && <div className="mt-3 space-y-1"><KeeperCompare label="AMENAZAS /40" metricId="THREATS_AGAINST_40" left={keeper.threatsAgainst40} right={comparison.threatsAgainst40}/><KeeperCompare label="% PARADA" metricId="SAVE_PERCENTAGE" left={keeper.savePercentage} right={comparison.savePercentage}/></div>}<p className="mt-2 text-[10px] text-slate-500">Mismo scope y denominadores; comparación descriptiva, sin score de portero.</p></section>
      <section className="grid gap-3 lg:grid-cols-2"><GoalThreatMap points={keeper.goalPoints} onSelect={setSelectedPoint} pointTitle={(point) => dashboardMapPointTitle(data.analysis.records, point)}/><GoalZoneGrid zones={data.analysis.goalZones}/><KeeperBodySummary keeper={keeper}/><article className="rounded-3xl border border-slate-700 bg-slate-900 p-4"><h2 className="mb-3 font-black">DESENLACES DE PARADA</h2><SaveOutcomeSummary keeper={keeper}/>{Object.values(keeper.saveOutcomes).reduce((sum, value) => sum + value, 0) < keeper.saves && <p className="mt-3 text-[10px] text-amber-300">Hay paradas sin desenlace documentado; no se inventan porcentajes.</p>}</article></section>
      <section><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-black">EVOLUCIÓN</h2><div className="flex items-center gap-2"><MetricHelp metricId="SAVE_PERCENTAGE"/><select aria-label="Métrica de evolución del portero" value={trendMetric} onChange={(event) => setTrendMetric(event.target.value as typeof trendMetric)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black"><option value="minutes">MINUTOS</option><option value="threatsAgainst">AMENAZAS</option><option value="threatsAgainst40">AMENAZAS /40</option><option value="goalsAgainst">GOLES RECIBIDOS</option><option value="saves">PARADAS</option><option value="savePercentage">% PARADA</option><option value="catch">% BLOCAJE</option><option value="clearance">% DESPEJE</option><option value="rebound">% RECHACE</option></select></div></div><EvolutionChart points={trend} reference={null} referenceLabel="MEDIA"/></section>
    </>}
  </main>{selectedPoint && <EventTracePanel records={data.analysis.records} point={selectedPoint} onClose={() => setSelectedPoint(null)}/>}</div>;
}
