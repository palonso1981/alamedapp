"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "../../../../components/app/AppHeader";
import { PitchThreatMap } from "../../../../components/dashboard/ThreatMaps";
import { PlayerAvatar } from "../../../../components/player/PlayerAvatar";
import { buildDashboardAnalysis } from "../../../../lib/dashboardAnalysis";
import { DashboardMatchRecord, DashboardPeriod } from "../../../../lib/dashboardAnalytics";
import { listMatchCatalog } from "../../../../lib/matchCatalog";
import { loadMatchSession } from "../../../../lib/matchPersistence";
import { useTeamStore } from "../../../../store/useTeamStore";
import { ThreatOutcome } from "../../../../types";

function readLocalRecords(): DashboardMatchRecord[] {
  return listMatchCatalog().flatMap((catalog) => {
    const session = loadMatchSession(catalog.matchId);
    return session ? [{ catalog, session }] : [];
  });
}

function number(value: number | null, digits = 1) {
  return value === null ? "N/D" : Number.isInteger(value) ? String(value) : value.toFixed(digits).replace(".", ",");
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-2xl border border-slate-700 bg-slate-900 p-3"><p className="text-[9px] font-black tracking-wider text-slate-500">{label}</p><strong className="mt-1 block text-2xl">{value}</strong></div>;
}

function MinuteTrend({ values }: { values: Array<{ opponent: string; minutes: number }> }) {
  const max = Math.max(1, ...values.map((value) => value.minutes));
  return <article className="rounded-3xl border border-slate-700 bg-slate-900 p-4"><h2 className="font-black">EVOLUCIÓN DE MINUTOS</h2><div className="mt-4 flex h-36 items-end gap-2 border-b border-slate-700">{values.map((value, index) => <div key={`${value.opponent}-${index}`} className="group relative flex h-full flex-1 items-end"><span className="w-full rounded-t bg-cyan-400" style={{ height: `${Math.max(3, value.minutes / max * 100)}%` }} /><span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-black text-slate-950">{number(value.minutes)}</span><span className="absolute -bottom-6 left-1/2 w-16 -translate-x-1/2 truncate text-center text-[8px] text-slate-500">{value.opponent}</span></div>)}</div><p className="mt-8 text-[10px] text-slate-500">Participación partido a partido; no implica valoración deportiva.</p></article>;
}

export default function PlayerDashboardPage({ params, searchParams }: { params: { playerId: string }; searchParams: { team?: string; season?: string; match?: string; period?: string } }) {
  const ensureRegistry = useTeamStore((state) => state.ensureRegistry);
  const ensureTeam = useTeamStore((state) => state.ensureTeam);
  const registryReady = useTeamStore((state) => state.registryReady);
  const currentClubId = useTeamStore((state) => state.currentClubId);
  const workspace = useTeamStore((state) => state.teams[state.currentClubId]);
  const [records, setRecords] = useState<DashboardMatchRecord[]>([]);
  const [shotFilter, setShotFilter] = useState<"ALL" | Exclude<ThreatOutcome, "BLOQUEADO">>("ALL");

  useEffect(() => ensureRegistry(), [ensureRegistry]);
  useEffect(() => {
    if (!registryReady) return;
    ensureTeam(currentClubId);
    setRecords(readLocalRecords());
  }, [currentClubId, ensureTeam, registryReady]);

  const teamId = searchParams.team ?? workspace?.teams.find((team) => team.active && !team.archivedAt && !team.deletedAt)?.teamId ?? "";
  const seasonId = searchParams.season ?? workspace?.seasons.find((season) => season.teamId === teamId && season.current && season.active)?.seasonId ?? "";
  const period: DashboardPeriod = searchParams.period === "1" ? 1 : searchParams.period === "2" ? 2 : "ALL";
  const matchId = searchParams.match && searchParams.match !== "ALL" ? searchParams.match : undefined;
  const analysis = useMemo(() => buildDashboardAnalysis(records, { clubId: currentClubId, teamId, seasonId, matchId, period }), [currentClubId, matchId, period, records, seasonId, teamId]);
  const player = analysis.players.find((candidate) => candidate.playerId === decodeURIComponent(params.playerId));
  const teamName = workspace?.teams.find((team) => team.teamId === teamId)?.name ?? "Equipo";
  const seasonName = workspace?.seasons.find((season) => season.seasonId === seasonId)?.label ?? "Temporada";
  const points = player?.ownShotPoints.filter((point) => shotFilter === "ALL" || point.outcome === shotFilter).map((point) => ({ ...point, matchId: "player", side: "FOR" as const })) ?? [];

  return <div className="min-h-screen overflow-x-hidden bg-slate-950 text-white">
    <AppHeader title="Ficha de jugador" clubId={currentClubId} />
    <main className="mx-auto max-w-6xl space-y-5 p-3 pb-16 sm:p-6">
      <Link href="/dashboard" className="inline-flex min-h-11 items-center rounded-xl border border-slate-700 px-4 text-xs font-black">← DASHBOARD</Link>
      {!player ? <section className="rounded-3xl border border-dashed border-slate-700 p-10 text-center"><strong>Jugador sin datos en este alcance</strong><p className="mt-2 text-sm text-slate-500">N/D · revisa equipo, temporada o partido.</p></section> : <>
        <header className="flex flex-wrap items-center gap-4 rounded-3xl border border-slate-700 bg-gradient-to-br from-slate-900 to-sky-950 p-5">
          <PlayerAvatar player={{ id: player.playerId, name: player.name, number: player.number, photoUrl: player.photoUrl, position: player.position, dominantFoot: player.dominantFoot }} />
          <div className="min-w-0 flex-1"><span className="text-xs font-black text-cyan-300">#{player.number} · {player.position ?? "N/D"}</span><h1 className="truncate text-3xl font-black">{player.name}</h1><p className="text-xs text-slate-400">{teamName} · {seasonName} · Pierna {player.dominantFoot ?? "N/D"}</p></div>
          <div className="text-right"><strong className="block text-4xl">{number(player.minutes)}&apos;</strong><span className="text-[10px] text-slate-500">{player.matches} PJ · {number(player.participationPercentage)}% DISP.</span>{player.lowSample && <span className="mt-1 block rounded-full bg-amber-950 px-2 py-1 text-[9px] font-black text-amber-200">MUESTRA BAJA</span>}</div>
        </header>
        <section><h2 className="mb-3 font-black">ACCIONES PROPIAS</h2><div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"><Kpi label="MINUTOS" value={number(player.minutes)} /><Kpi label="G" value={player.goals} /><Kpi label="A CONFIRMADAS" value={player.assists} /><Kpi label="AMENAZAS" value={player.ownThreats} /><Kpi label="AMENAZAS /40" value={number(player.ownThreats40)} /><Kpi label="FALTAS C/R" value={`${player.foulsCommitted}/${player.foulsReceived}`} /><Kpi label="CRÍTICAS C/R" value={`${player.criticalFoulsCommitted}/${player.criticalFoulsReceived}`} /></div></section>
        <section><h2 className="mb-3 font-black">EQUIPO CON ÉL EN PISTA</h2><div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"><Kpi label="AMEN. FOR" value={player.onCourt.threatsFor} /><Kpi label="AMEN. AGAINST" value={player.onCourt.threatsAgainst} /><Kpi label="FOR/40" value={number(player.onCourt.threatsFor40)} /><Kpi label="AGAINST/40" value={number(player.onCourt.threatsAgainst40)} /><Kpi label="PARCIAL" value={`${player.onCourt.goalsFor}–${player.onCourt.goalsAgainst}`} /><Kpi label="+/-" value={player.onCourt.goalDifference > 0 ? `+${player.onCourt.goalDifference}` : player.onCourt.goalDifference} /><Kpi label="GF/40 · GC/40" value={`${number(player.onCourt.goalsFor40)} · ${number(player.onCourt.goalsAgainst40)}`} /></div><p className="mt-2 text-[10px] text-slate-500">Describe el comportamiento colectivo durante sus intervalos, sin afirmar causalidad.</p></section>
        <div className="grid gap-4 lg:grid-cols-2"><MinuteTrend values={player.trend} /><div><div className="mb-2 flex flex-wrap gap-2">{(["ALL", "GOL", "PARADA", "FUERA"] as const).map((item) => <button key={item} type="button" onClick={() => setShotFilter(item)} className={`min-h-10 rounded-xl px-3 text-xs font-black ${shotFilter === item ? "bg-cyan-300 text-slate-950" : "bg-slate-800"}`}>{item === "ALL" ? "TODOS LOS TIROS" : item}</button>)}</div><PitchThreatMap points={points} side="FOR" /></div></div>
        <p className="rounded-2xl border border-slate-800 bg-slate-900 p-3 text-[10px] text-slate-500">Las asistencias confirmadas pueden contarse. No existe coordenada del pase de asistencia; el origen del tiro no se reutiliza ni se inventa como origen del pase.</p>
      </>}
    </main>
  </div>;
}
