"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppHeader } from "../app/AppHeader";
import { PlayerPhotoCard } from "../player/PlayerPhotoCard";
import { DashboardFilterBar } from "./DashboardFilterBar";
import { PitchThreatMap } from "./ThreatMaps";
import { buildPlayerScores, playerMetricValue } from "../../lib/dashboardV2";
import { ThreatOutcome } from "../../types";
import { useDashboardProfileData } from "./useDashboardProfileData";

const format = (value: number | null, suffix = "") => value === null ? "N/D" : `${Number.isInteger(value) ? value : value.toFixed(1).replace(".", ",")}${suffix}`;
function Kpi({ label, value }: { label: string; value: string | number }) { return <div className="rounded-2xl border border-slate-700 bg-slate-900 p-3"><span className="text-[9px] font-black text-slate-500">{label}</span><strong className="mt-1 block text-2xl">{value}</strong></div>; }

export function PlayerDashboardV2Page({ playerId }: { playerId: string }) {
  const path = `/dashboard/jugador/${encodeURIComponent(playerId)}`;
  const data = useDashboardProfileData(path);
  const [shotFilter, setShotFilter] = useState<"ALL" | Exclude<ThreatOutcome, "BLOQUEADO">>("ALL");
  const [compareId, setCompareId] = useState("");
  const player = data.analysis.players.find((candidate) => candidate.playerId === decodeURIComponent(playerId));
  const referencePlayer = data.reference.players.find((candidate) => candidate.playerId === decodeURIComponent(playerId));
  const comparison = compareId === "__REFERENCE__" ? referencePlayer : data.analysis.players.find((candidate) => candidate.playerId === compareId);
  const score = useMemo(() => buildPlayerScores(data.analysis.players).find((item) => item.playerId === player?.playerId), [data.analysis.players, player?.playerId]);
  const points = player?.ownShotPoints.filter((point) => shotFilter === "ALL" || point.outcome === shotFilter).map((point) => ({ ...point, matchId: "player", side: "FOR" as const })) ?? [];
  const average = (selector: (candidate: NonNullable<typeof player>) => number | null) => {
    const values = data.analysis.players.map((candidate) => selector(candidate)).filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const metric = (key: "goals" | "assists" | "threats" | "points") => player ? playerMetricValue(player, key, data.mode) : null;
  return <div className="min-h-screen overflow-x-hidden bg-slate-950 text-white"><AppHeader title="Jugador · Dashboard" clubId={data.fixture ? undefined : data.currentClubId}/><main className="mx-auto max-w-7xl space-y-5 p-3 pb-16 sm:p-5">
    <DashboardFilterBar clubName={data.workspace?.club.name ?? "Club"} clubs={data.clubs} onClub={data.setCurrentClub} scope={data.scope} teams={data.teams} seasons={data.seasons} matches={data.matches} rivals={data.rivals} players={data.analysis.players} goalkeepers={data.analysis.goalkeepers} referencePreset={data.referencePreset} mode={data.mode} onScope={data.setScope} onReferencePreset={data.setReferencePreset} onMode={data.setMode} onRefresh={data.refresh} fixture={data.fixture}/>
    <Link href={`/dashboard?${data.query}`} className="inline-flex min-h-10 items-center rounded-xl border border-slate-700 px-4 text-[10px] font-black">← DASHBOARD</Link>
    {!player ? <p className="rounded-3xl border border-dashed border-slate-700 p-10 text-center text-slate-500">Jugador sin datos en este scope.</p> : <>
      <header className="grid gap-4 rounded-3xl border border-slate-700 bg-gradient-to-r from-slate-900 to-sky-950 p-5 sm:grid-cols-[10rem_1fr] sm:items-center"><PlayerPhotoCard player={{ id: player.playerId, name: player.name, number: player.number, photoUrl: player.photoUrl }} className="h-48 w-40"/><div><span className="text-xs font-black text-cyan-300">#{player.number} · {player.position ?? "N/D"}</span><h1 className="text-3xl font-black">{player.name}</h1><p className="text-xs text-slate-400">{player.matches} partidos · {format(player.minutes, "'")} · muestra {score?.sampleSize ?? 0} jugadores</p><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Kpi label="GOLES" value={format(metric("goals"))}/><Kpi label="ASISTENCIAS" value={format(metric("assists"))}/><Kpi label="REMATES" value={format(metric("threats"))}/><Kpi label="PTS EN PISTA" value={format(metric("points"))}/></div></div></header>
      <section className="grid gap-3 lg:grid-cols-[1fr_18rem]"><div><h2 className="mb-3 font-black">EQUIPO CON ÉL EN PISTA</h2><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Kpi label="REMATES /40" value={format(player.onCourt.threatsFor40)}/><Kpi label="AMENAZAS /40" value={format(player.onCourt.threatsAgainst40)}/><Kpi label="GF–GC" value={`${player.onCourt.goalsFor}–${player.onCourt.goalsAgainst}`}/><Kpi label="+/-" value={player.onCourt.goalDifference > 0 ? `+${player.onCourt.goalDifference}` : player.onCourt.goalDifference}/></div><p className="mt-2 text-[10px] text-slate-500">Describe al equipo durante sus intervalos; no atribuye causalidad.</p></div><article className="rounded-3xl border border-amber-800 bg-amber-950/20 p-4"><span className="text-[9px] font-black text-amber-200">SCORE ALAM · EXPERIMENTAL</span><strong className="mt-2 block text-5xl">{format(score?.score ?? null)}</strong><p className="mt-2 text-[10px] text-slate-400">Producción {format(score?.production ?? null)} · En pista {format(score?.onCourt ?? null)} · Fiabilidad {format(score ? score.reliability * 100 : null, "%")}</p></article></section>
      <section className="rounded-3xl border border-slate-700 bg-slate-900 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-black">COMPARAR JUGADOR</h2><select value={compareId} onChange={(event) => setCompareId(event.target.value)} className="min-h-10 rounded-xl bg-slate-800 px-3 text-xs font-black"><option value="">Media plantilla</option><option value="__REFERENCE__">Mismo jugador · referencia global</option>{data.analysis.players.filter((candidate) => candidate.playerId !== player.playerId).map((candidate) => <option key={candidate.playerId} value={candidate.playerId}>{candidate.name}</option>)}</select></div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><Kpi label="GOLES · REF." value={`${format(metric("goals"))} · ${format(comparison ? playerMetricValue(comparison, "goals", data.mode) : average((item) => playerMetricValue(item, "goals", data.mode)))}`}/><Kpi label="ASIST. · REF." value={`${format(metric("assists"))} · ${format(comparison ? playerMetricValue(comparison, "assists", data.mode) : average((item) => playerMetricValue(item, "assists", data.mode)))}`}/><Kpi label="REMATES · REF." value={`${format(metric("threats"))} · ${format(comparison ? playerMetricValue(comparison, "threats", data.mode) : average((item) => playerMetricValue(item, "threats", data.mode)))}`}/><Kpi label="PTS · REF." value={`${format(metric("points"))} · ${format(comparison ? playerMetricValue(comparison, "points", data.mode) : average((item) => playerMetricValue(item, "points", data.mode)))}`}/></div></section>
      <div className="grid gap-4 lg:grid-cols-2"><MinuteTrend values={player.trend}/><div><div className="mb-2 flex gap-2 overflow-x-auto">{(["ALL", "GOL", "PARADA", "FUERA"] as const).map((item) => <button key={item} type="button" onClick={() => setShotFilter(item)} className={`min-h-10 shrink-0 rounded-xl px-3 text-[10px] font-black ${shotFilter === item ? "bg-cyan-300 text-slate-950" : "bg-slate-800"}`}>{item === "ALL" ? "TODOS" : item}</button>)}</div><PitchThreatMap points={points} side="FOR"/></div></div>
      <p className="rounded-2xl border border-slate-800 bg-slate-900 p-3 text-[10px] text-slate-500">Solo cuentan asistencias confirmadas. No existe coordenada del pase y no se inventa. PTS EN PISTA usa el parcial de cada partido durante sus minutos.</p>
    </>}
  </main></div>;
}

function MinuteTrend({ values }: { values: Array<{ matchId: string; opponent: string; minutes: number }> }) {
  const max = Math.max(1, ...values.map((value) => value.minutes));
  return <article className="rounded-3xl border border-slate-700 bg-slate-900 p-4"><h2 className="font-black">EVOLUCIÓN DE MINUTOS</h2><div className="mt-4 flex h-36 items-end gap-2 border-b border-slate-700">{values.map((value, index) => <div key={`${value.matchId}-${index}`} title={`${value.opponent}: ${value.minutes}'`} className="relative flex h-full flex-1 items-end"><span className="w-full rounded-t bg-cyan-400" style={{ height: `${Math.max(3, value.minutes / max * 100)}%` }}/><span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] font-black text-slate-950">{format(value.minutes)}</span></div>)}</div><p className="mt-2 text-[10px] text-slate-500">Tendencia descriptiva, sin juicio automático.</p></article>;
}
