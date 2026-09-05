"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "../../components/app/AppHeader";
import {
  GoalThreatMap,
  PitchThreatMap,
} from "../../components/dashboard/ThreatMaps";
import {
  GoalZoneGrid,
  KeeperBodySummary,
  PitchZoneGrid,
  SaveOutcomeSummary,
} from "../../components/dashboard/AnalysisVisuals";
import {
  DASHBOARD_PHASES,
  DashboardAnalytics,
  DashboardMatchRecord,
  DashboardPeriod,
} from "../../lib/dashboardAnalytics";
import {
  buildDashboardAnalysis,
  compareAnalysisMetric,
  ResultFilter,
  VenueFilter,
} from "../../lib/dashboardAnalysis";
import {
  listMatchCatalog,
  matchCatalogClubId,
  visibleMatchCatalog,
} from "../../lib/matchCatalog";
import { loadMatchSession } from "../../lib/matchPersistence";
import { useTeamStore } from "../../store/useTeamStore";
import { ThreatOutcome, ThreatSide } from "../../types";

const PHASE_LABEL: Record<string, string> = {
  POSITIONAL: "POSICIONAL",
  TRANSITION: "TRANSICIÓN",
  SET_PIECE_CORNER: "ABP · CÓRNER",
  SET_PIECE_FREE_KICK: "ABP · FALTA",
  SET_PIECE_KICK_IN: "ABP · BANDA",
  FLYING_GOALKEEPER: "P-J",
  PENALTY: "PENALTI",
  DOUBLE_PENALTY: "DOBLE PENALTI",
  UNSPECIFIED: "SIN FASE",
};

function readLocalRecords(): DashboardMatchRecord[] {
  return listMatchCatalog().flatMap((catalog) => {
    const session = loadMatchSession(catalog.matchId);
    return session ? [{ catalog, session }] : [];
  });
}

function SectionTitle({ eyebrow, children }: { eyebrow?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      {eyebrow && <p className="text-[10px] font-black tracking-[0.18em] text-cyan-300">{eyebrow}</p>}
      <h2 className="text-xl font-black sm:text-2xl">{children}</h2>
    </div>
  );
}

function Metric({ label, value, accent = "text-white" }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-700 bg-slate-900 p-3 sm:p-4">
      <p className="truncate text-[10px] font-black tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-black sm:text-3xl ${accent}`}>{value}</p>
    </div>
  );
}

function OutcomeBlock({ side, stats }: { side: ThreatSide; stats: DashboardAnalytics["threats"][ThreatSide] }) {
  const outcomes: Array<[ThreatOutcome, string]> = [
    ["GOL", "text-rose-300"],
    ["PARADA", "text-emerald-300"],
    ["FUERA", "text-amber-200"],
  ];
  if (stats.BLOQUEADO > 0) outcomes.push(["BLOQUEADO", "text-slate-300"]);
  return (
    <article className={`rounded-3xl border p-4 ${side === "FOR" ? "border-cyan-800 bg-cyan-950/25" : "border-rose-900 bg-rose-950/20"}`}>
      <div className="flex items-end justify-between">
        <div><p className="text-[10px] font-black tracking-[0.16em] text-slate-400">{side === "FOR" ? "REMATES" : "AMENAZAS"}</p><h3 className="text-xl font-black">{side === "FOR" ? "CDA" : "RECIBIDAS"}</h3></div>
        <strong className="text-4xl">{stats.total}</strong>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {outcomes.map(([outcome, color]) => <div key={outcome} className="rounded-xl bg-slate-950/60 p-2 text-center"><strong className={`block text-xl ${color}`}>{stats[outcome]}</strong><span className="text-[9px] font-black text-slate-500">{outcome}</span></div>)}
      </div>
    </article>
  );
}

function number(value: number | null, digits = 1) {
  return value === null ? "N/D" : Number.isInteger(value) ? String(value) : value.toFixed(digits).replace(".", ",");
}

function signed(value: number | null) {
  if (value === null) return "N/D";
  return `${value > 0 ? "+" : ""}${number(value)}`;
}

function difference(first: number | null, second: number | null) {
  return first === null || second === null ? null : first - second;
}

function ComparisonMetric({ label, comparison, referenceLabel = "MEDIA" }: { label: string; comparison: ReturnType<typeof compareAnalysisMetric>; referenceLabel?: string }) {
  return <article className="rounded-2xl border border-slate-700 bg-slate-900 p-3"><p className="text-[9px] font-black tracking-wider text-slate-500">{label}</p><strong className="mt-1 block text-3xl">{number(comparison.value)}</strong><div className="mt-2 flex justify-between text-[10px]"><span className="text-slate-500">{referenceLabel} {number(comparison.reference)}</span><strong className="text-cyan-300">Δ {signed(comparison.difference)}</strong></div></article>;
}

function Trend({ values, reference, label }: { values: number[]; reference: number | null; label: string }) {
  const max = Math.max(1, reference ?? 0, ...values);
  return <article className="rounded-2xl border border-slate-800 bg-slate-900 p-3"><div className="flex justify-between text-[9px] font-black text-slate-500"><span>{label}</span><span>MEDIA {number(reference)}</span></div><div className="mt-3 flex h-20 items-end gap-1 border-b border-slate-700">{values.map((value, index) => <span key={index} title={`${value}`} className="relative flex-1 rounded-t bg-cyan-400/75" style={{ height: `${Math.max(3, value / max * 100)}%` }}>{reference !== null && <i className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-amber-300" style={{ bottom: `${reference / max * 100}%` }} />}</span>)}</div></article>;
}

const AREAS = ["RESUMEN", "EQUIPO", "JUGADORES", "PORTEROS", "MAPAS / ZONAS"] as const;
type DashboardArea = typeof AREAS[number];
type ReferenceMode = "SEASON" | "HOME" | "AWAY" | "WIN" | "DRAW" | "LOSS" | "OTHER_PERIOD";

export default function DashboardPage() {
  const ensureRegistry = useTeamStore((state) => state.ensureRegistry);
  const ensureTeam = useTeamStore((state) => state.ensureTeam);
  const registryReady = useTeamStore((state) => state.registryReady);
  const currentClubId = useTeamStore((state) => state.currentClubId);
  const workspace = useTeamStore((state) => state.teams[state.currentClubId]);
  const [records, setRecords] = useState<DashboardMatchRecord[]>([]);
  const [teamId, setTeamId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [matchId, setMatchId] = useState("ALL");
  const [period, setPeriod] = useState<DashboardPeriod>("ALL");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [venue, setVenue] = useState<VenueFilter>("ALL");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("ALL");
  const [area, setArea] = useState<DashboardArea>("RESUMEN");
  const [playerView, setPlayerView] = useState<"GENERAL" | "EN_PISTA" | "POR_40" | "DISCIPLINA">("GENERAL");
  const [positionFilter, setPositionFilter] = useState("ALL");
  const [sortPlayer, setSortPlayer] = useState<"MINUTES" | "GOALS" | "THREATS" | "PLUS_MINUS">("MINUTES");
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>("SEASON");
  const [keeperAId, setKeeperAId] = useState("");
  const [keeperBId, setKeeperBId] = useState("");

  useEffect(() => ensureRegistry(), [ensureRegistry]);
  useEffect(() => {
    if (!registryReady) return;
    ensureTeam(currentClubId);
    setRecords(readLocalRecords());
    setTeamId("");
    setSeasonId("");
    setMatchId("ALL");
    setPeriod("ALL");
  }, [currentClubId, ensureTeam, registryReady]);

  const teams = useMemo(
    () => workspace?.teams.filter((team) => team.active && !team.archivedAt && !team.deletedAt) ?? [],
    [workspace],
  );

  useEffect(() => {
    if (!teams.length) return setTeamId("");
    if (!teams.some((team) => team.teamId === teamId)) setTeamId(teams[0].teamId);
  }, [teamId, teams]);

  const seasons = useMemo(
    () => workspace?.seasons.filter((season) => season.teamId === teamId && season.active && !season.archivedAt && !season.deletedAt) ?? [],
    [teamId, workspace],
  );

  useEffect(() => {
    if (!seasons.length) return setSeasonId("");
    if (!seasons.some((season) => season.seasonId === seasonId)) {
      setSeasonId(seasons.find((season) => season.current)?.seasonId ?? seasons[0].seasonId);
    }
  }, [seasonId, seasons]);

  const availableMatches = useMemo(
    () => visibleMatchCatalog(records.map((record) => record.catalog), includeArchived).filter(
      (match) => matchCatalogClubId(match) === currentClubId && match.teamId === teamId && match.seasonId === seasonId,
    ),
    [currentClubId, includeArchived, records, seasonId, teamId],
  );

  useEffect(() => {
    if (matchId !== "ALL" && !availableMatches.some((match) => match.matchId === matchId)) {
      setMatchId("ALL");
      setPeriod("ALL");
    }
  }, [availableMatches, matchId]);

  useEffect(() => {
    if (referenceMode === "OTHER_PERIOD" && period === "ALL") setReferenceMode("SEASON");
  }, [period, referenceMode]);

  const analysis = useMemo(
    () => buildDashboardAnalysis(records, {
      clubId: currentClubId,
      teamId,
      seasonId,
      matchId: matchId === "ALL" ? undefined : matchId,
      period: matchId === "ALL" ? "ALL" : period,
      includeArchived,
      venue,
      result: resultFilter,
    }),
    [currentClubId, includeArchived, matchId, period, records, resultFilter, seasonId, teamId, venue],
  );
  const analytics = analysis.analytics;
  const reference = useMemo(() => buildDashboardAnalysis(records, {
    clubId: currentClubId,
    teamId,
    seasonId,
    matchId: referenceMode === "OTHER_PERIOD" && matchId !== "ALL" ? matchId : undefined,
    period: referenceMode === "OTHER_PERIOD" && (period === 1 || period === 2) ? (period === 1 ? 2 : 1) : matchId === "ALL" ? "ALL" : period,
    includeArchived,
    venue: referenceMode === "HOME" ? "HOME" : referenceMode === "AWAY" ? "AWAY" : "ALL",
    result: referenceMode === "WIN" ? "WIN" : referenceMode === "DRAW" ? "DRAW" : referenceMode === "LOSS" ? "LOSS" : "ALL",
  }), [currentClubId, includeArchived, matchId, period, records, referenceMode, seasonId, teamId]);
  const comparisons = {
    threatsFor: compareAnalysisMetric(analysis, reference, "threatsFor"),
    threatsAgainst: compareAnalysisMetric(analysis, reference, "threatsAgainst"),
    goalsFor: compareAnalysisMetric(analysis, reference, "goalsFor"),
    goalsAgainst: compareAnalysisMetric(analysis, reference, "goalsAgainst"),
  };
  const maxPhase = Math.max(1, ...DASHBOARD_PHASES.flatMap((phase) => [analytics.phases[phase].FOR, analytics.phases[phase].AGAINST]));
  const pendingCount = analytics.quality.reduce((sum, match) => sum + match.pendingReview, 0);
  const manualCount = analytics.quality.reduce((sum, match) => sum + match.manualReviewEvents, 0);
  const positions = Array.from(new Set(analysis.players.map((player) => player.position).filter(Boolean))) as string[];
  const visiblePlayers = analysis.players.filter((player) => positionFilter === "ALL" || player.position === positionFilter).sort((a, b) => {
    if (sortPlayer === "GOALS") return b.goals - a.goals || b.minutes - a.minutes;
    if (sortPlayer === "THREATS") return b.ownThreats - a.ownThreats || b.minutes - a.minutes;
    if (sortPlayer === "PLUS_MINUS") return b.onCourt.goalDifference - a.onCourt.goalDifference || b.minutes - a.minutes;
    return b.minutes - a.minutes;
  });
  const referenceLabel = referenceMode === "OTHER_PERIOD" ? (period === 1 ? "P2" : "P1") : `MEDIA ${referenceMode === "SEASON" ? (period === "ALL" ? "TEMP." : `P${period}`) : referenceMode}`;
  const keeperA = analysis.goalkeepers.find((keeper) => keeper.playerId === keeperAId) ?? analysis.goalkeepers[0];
  const keeperB = analysis.goalkeepers.find((keeper) => keeper.playerId === keeperBId) ?? analysis.goalkeepers[1];

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-950 text-white">
      <AppHeader title="Dashboard" clubId={currentClubId} />
      <main className="mx-auto max-w-7xl space-y-8 p-3 pb-16 sm:p-5 lg:p-7">
        <section className="rounded-3xl border border-slate-700 bg-slate-900/80 p-3 sm:p-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.3fr_auto]">
            <label className="rounded-2xl bg-slate-950 p-3 text-[10px] font-black tracking-wider text-slate-500">EQUIPO
              <select aria-label="Equipo" value={teamId} onChange={(event) => { setTeamId(event.target.value); setMatchId("ALL"); setPeriod("ALL"); }} className="mt-1 block min-h-11 w-full bg-transparent text-sm font-black text-white outline-none">
                {teams.length === 0 && <option value="">SIN EQUIPOS</option>}
                {teams.map((team) => <option key={team.teamId} value={team.teamId}>{team.name}</option>)}
              </select>
            </label>
            <label className="rounded-2xl bg-slate-950 p-3 text-[10px] font-black tracking-wider text-slate-500">TEMPORADA
              <select aria-label="Temporada" value={seasonId} onChange={(event) => { setSeasonId(event.target.value); setMatchId("ALL"); setPeriod("ALL"); }} className="mt-1 block min-h-11 w-full bg-transparent text-sm font-black text-white outline-none">
                {seasons.length === 0 && <option value="">SIN TEMPORADAS</option>}
                {seasons.map((season) => <option key={season.seasonId} value={season.seasonId}>{season.label}{season.current ? " · ACTUAL" : ""}</option>)}
              </select>
            </label>
            <label className="rounded-2xl bg-slate-950 p-3 text-[10px] font-black tracking-wider text-slate-500">ALCANCE
              <select aria-label="Partido" value={matchId} onChange={(event) => { setMatchId(event.target.value); setPeriod("ALL"); }} className="mt-1 block min-h-11 w-full bg-transparent text-sm font-black text-white outline-none">
                <option value="ALL">TEMPORADA COMPLETA</option>
                {availableMatches.map((match) => <option key={match.matchId} value={match.matchId}>{match.date} · {match.opponent}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => setRecords(readLocalRecords())} className="min-h-14 rounded-2xl border border-slate-700 px-4 text-xs font-black hover:border-cyan-400">↻ ACTUALIZAR</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {matchId !== "ALL" && (["ALL", 1, 2] as DashboardPeriod[]).map((item) => <button key={item} type="button" onClick={() => setPeriod(item)} className={`min-h-10 rounded-xl px-4 text-xs font-black ${period === item ? "bg-cyan-300 text-slate-950" : "bg-slate-800 text-slate-300"}`}>{item === "ALL" ? "PARTIDO" : `P${item}`}</button>)}
            <label className="ml-auto flex min-h-10 items-center gap-2 rounded-xl bg-slate-800 px-3 text-xs font-bold text-slate-400"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} className="h-4 w-4" />Incluir archivados</label>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:flex">
            <select aria-label="Local o visitante" value={venue} onChange={(event) => setVenue(event.target.value as VenueFilter)} className="min-h-10 rounded-xl bg-slate-800 px-3 text-xs font-black"><option value="ALL">TODAS LAS SEDES</option><option value="HOME">LOCAL</option><option value="AWAY">VISITANTE</option></select>
            <select aria-label="Resultado" value={resultFilter} onChange={(event) => setResultFilter(event.target.value as ResultFilter)} className="min-h-10 rounded-xl bg-slate-800 px-3 text-xs font-black"><option value="ALL">TODOS LOS RESULTADOS</option><option value="WIN">VICTORIAS</option><option value="DRAW">EMPATES</option><option value="LOSS">DERROTAS</option></select>
            {matchId !== "ALL" && <select aria-label="Referencia" value={referenceMode} onChange={(event) => setReferenceMode(event.target.value as ReferenceMode)} className="col-span-2 min-h-10 rounded-xl bg-slate-800 px-3 text-xs font-black"><option value="SEASON">COMPARAR · MEDIA {period === "ALL" ? "TEMPORADA" : `P${period}`}</option><option value="HOME">COMPARAR · MEDIA LOCAL</option><option value="AWAY">COMPARAR · MEDIA VISITANTE</option><option value="WIN">COMPARAR · MEDIA VICTORIAS</option><option value="DRAW">COMPARAR · MEDIA EMPATES</option><option value="LOSS">COMPARAR · MEDIA DERROTAS</option>{(period === 1 || period === 2) && <option value="OTHER_PERIOD">COMPARAR · P{period === 1 ? 2 : 1} MISMO PARTIDO</option>}</select>}
          </div>
        </section>

        <nav aria-label="Áreas del Dashboard" className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 p-2">
          {AREAS.map((item) => <button key={item} type="button" onClick={() => setArea(item)} className={`min-h-11 shrink-0 rounded-xl px-4 text-xs font-black ${area === item ? "bg-cyan-300 text-slate-950" : "text-slate-400 hover:bg-slate-800"}`}>{item}</button>)}
        </nav>

        {analytics.matches === 0 ? (
          <section className="rounded-3xl border border-dashed border-slate-700 p-10 text-center"><strong className="text-xl">Sin partidos locales para esta selección</strong><p className="mt-2 text-sm text-slate-500">El Dashboard funciona offline con partidos ya disponibles en este dispositivo.</p></section>
        ) : <>
          {area === "RESUMEN" && <section>
            <SectionTitle eyebrow="QUÉ HA PASADO">RESUMEN</SectionTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="PARTIDOS" value={analytics.matches} />
              <Metric label="V · E · D" value={`${analytics.wins} · ${analytics.draws} · ${analytics.losses}`} />
              <Metric label="GOLES CDA" value={analytics.goalsFor} accent="text-cyan-300" />
              <Metric label="GOLES RIV" value={analytics.goalsAgainst} accent="text-rose-300" />
              <Metric label="REMATES" value={analytics.threats.FOR.total} />
              <Metric label="AMENAZAS" value={analytics.threats.AGAINST.total} />
            </div>
            {(pendingCount > 0 || manualCount > 0 || analytics.quality.some((match) => match.reviewStatus !== "VALIDATED")) && <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-full bg-amber-950 px-3 py-2 text-amber-200">{pendingCount > 0 ? `? ${pendingCount} pendientes` : "Datos no validados"}</span>{manualCount > 0 && <span className="rounded-full bg-violet-950 px-3 py-2 text-violet-200">{manualCount} añadidos en revisión</span>}</div>}
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {analytics.quality.map((match) => <div key={match.matchId} className="shrink-0 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[10px]"><strong className="block max-w-44 truncate text-white">{match.opponent}</strong><span className={match.status === "LIVE" ? "text-rose-300" : "text-emerald-300"}>{match.status === "LIVE" ? "EN CURSO" : "TERMINADO"}</span><span className="mx-1 text-slate-700">·</span><span className="text-slate-400">{match.reviewStatus === "VALIDATED" ? "VALIDADO" : match.reviewStatus === "IN_REVIEW" ? "EN REVISIÓN" : "PENDIENTE DE REVISIÓN"}</span><span className="mx-1 text-slate-700">·</span><span className={match.hasCompleteEvents ? "text-cyan-300" : "text-amber-300"}>{match.hasCompleteEvents ? "EVENTOS COMPLETOS" : "DATOS PARCIALES"}</span>{match.pendingReview > 0 && <span className="ml-2 text-amber-300">? {match.pendingReview}</span>}</div>)}
            </div>
            {matchId !== "ALL" && <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><ComparisonMetric label="REMATES" comparison={comparisons.threatsFor} referenceLabel={referenceLabel} /><ComparisonMetric label="AMENAZAS" comparison={comparisons.threatsAgainst} referenceLabel={referenceLabel} /><ComparisonMetric label="GF" comparison={comparisons.goalsFor} referenceLabel={referenceLabel} /><ComparisonMetric label="GC" comparison={comparisons.goalsAgainst} referenceLabel={referenceLabel} /></div>}
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><Trend label="REMATES" values={analysis.trends.map((point) => point.threatsFor)} reference={reference.samples ? reference.analytics.threats.FOR.total / reference.samples : null} /><Trend label="AMENAZAS" values={analysis.trends.map((point) => point.threatsAgainst)} reference={reference.samples ? reference.analytics.threats.AGAINST.total / reference.samples : null} /><Trend label="GF" values={analysis.trends.map((point) => point.goalsFor)} reference={reference.samples ? reference.analytics.goalsFor / reference.samples : null} /><Trend label="GC" values={analysis.trends.map((point) => point.goalsAgainst)} reference={reference.samples ? reference.analytics.goalsAgainst / reference.samples : null} /></div>
          </section>}

          {area === "JUGADORES" && <section>
            <SectionTitle eyebrow="ACCIONES PROPIAS ≠ EQUIPO EN PISTA">JUGADORES</SectionTitle>
            <div className="mb-3 grid gap-2 sm:grid-cols-3">
              <select aria-label="Vista de jugadores" value={playerView} onChange={(event) => setPlayerView(event.target.value as typeof playerView)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black"><option value="GENERAL">GENERAL</option><option value="EN_PISTA">EQUIPO CON ÉL EN PISTA</option><option value="POR_40">RATIOS /40</option><option value="DISCIPLINA">DISCIPLINA</option></select>
              <select aria-label="Posición" value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black"><option value="ALL">TODAS LAS POSICIONES</option>{positions.map((position) => <option key={position} value={position}>{position}</option>)}</select>
              <select aria-label="Ordenar jugadores" value={sortPlayer} onChange={(event) => setSortPlayer(event.target.value as typeof sortPlayer)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black"><option value="MINUTES">ORDEN · MINUTOS</option><option value="GOALS">ORDEN · GOLES</option><option value="THREATS">ORDEN · REMATES</option><option value="PLUS_MINUS">ORDEN · +/-</option></select>
            </div>
            <div className="overflow-x-auto rounded-3xl border border-slate-700 bg-slate-900">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-[4rem_minmax(11rem,1fr)_repeat(7,minmax(4rem,auto))] gap-2 border-b border-slate-700 px-3 py-2 text-[9px] font-black text-slate-500"><span>#</span><span>JUGADOR</span>{playerView === "GENERAL" && <><span>PJ</span><span>MIN</span><span>%</span><span>G</span><span>ASIST.</span><span>REM.</span><span>OBJ/±</span></>}{playerView === "EN_PISTA" && <><span>REMATES</span><span>AMENAZAS</span><span>GF</span><span>GC</span><span>PARCIAL</span><span>+/-</span><span>MIN</span></>}{playerView === "POR_40" && <><span>REM./40</span><span>AMEN./40</span><span>Δ ACC.</span><span>GF/40</span><span>GC/40</span><span>Δ GOL</span><span>MIN</span></>}{playerView === "DISCIPLINA" && <><span>FC</span><span>FR</span><span>FC CRÍT.</span><span>FR CRÍT.</span><span>TA</span><span>TR</span><span>MIN</span></>}</div>
                {visiblePlayers.map((player) => <Link key={player.playerId} href={`/dashboard/jugador/${encodeURIComponent(player.playerId)}?team=${encodeURIComponent(teamId)}&season=${encodeURIComponent(seasonId)}&match=${encodeURIComponent(matchId)}&period=${period}`} className="grid min-h-14 grid-cols-[4rem_minmax(11rem,1fr)_repeat(7,minmax(4rem,auto))] items-center gap-2 border-b border-slate-800 px-3 py-2 text-sm last:border-0 hover:bg-slate-800/70"><strong className="text-cyan-300">#{player.number}</strong><span className="min-w-0"><strong className="block truncate">{player.name}</strong><small className="text-[9px] text-slate-500">{player.position ?? "N/D"}{player.lowSample ? " · MUESTRA BAJA" : ""}</small></span>{playerView === "GENERAL" && <><span>{player.matches}</span><strong>{number(player.minutes)}&apos;</strong><span>{player.participationPercentage === null ? "N/D" : `${number(player.participationPercentage)}%`}</span><span>{player.goals}</span><span>{player.assists}</span><span>{player.ownThreats}</span><span className="text-xs text-slate-400">{player.targetMinutes === undefined ? "—" : `${player.targetMinutes}'/${signed(player.minutes - player.targetMinutes)}`}</span></>}{playerView === "EN_PISTA" && <><span>{player.onCourt.threatsFor}</span><span>{player.onCourt.threatsAgainst}</span><span>{player.onCourt.goalsFor}</span><span>{player.onCourt.goalsAgainst}</span><strong>{player.onCourt.goalsFor}–{player.onCourt.goalsAgainst}</strong><strong>{signed(player.onCourt.goalDifference)}</strong><span>{number(player.minutes)}&apos;</span></>}{playerView === "POR_40" && <><span>{number(player.onCourt.threatsFor40)}</span><span>{number(player.onCourt.threatsAgainst40)}</span><span>{signed(player.onCourt.threatDifference40)}</span><span>{number(player.onCourt.goalsFor40)}</span><span>{number(player.onCourt.goalsAgainst40)}</span><span>{signed(player.onCourt.goalDifference40)}</span><span>{number(player.minutes)}&apos;</span></>}{playerView === "DISCIPLINA" && <><span>{player.foulsCommitted}</span><span>{player.foulsReceived}</span><span>{player.criticalFoulsCommitted}</span><span>{player.criticalFoulsReceived}</span><span>{player.yellowCards}</span><span>{player.redCards}</span><span>{number(player.minutes)}&apos;</span></>}</Link>)}
              </div>
            </div>
            <p className="mt-2 text-[10px] text-slate-500">Los datos “en pista” describen al equipo durante sus minutos; no atribuyen causalidad individual.</p>
          </section>}

          {area === "EQUIPO" && <section>
            <SectionTitle eyebrow={`MINUTOS OBSERVADOS · ${analysis.rates.observedMinutes}`}>EQUIPO · BRUTO Y /40</SectionTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"><Metric label="REMATES" value={analytics.threats.FOR.total} /><Metric label="REMATES /40" value={number(analysis.rates.threatsFor40)} /><Metric label="AMENAZAS" value={analytics.threats.AGAINST.total} /><Metric label="AMENAZAS /40" value={number(analysis.rates.threatsAgainst40)} /><Metric label="GF · /40" value={`${analytics.goalsFor} · ${number(analysis.rates.goalsFor40)}`} /><Metric label="GC · /40" value={`${analytics.goalsAgainst} · ${number(analysis.rates.goalsAgainst40)}`} /><Metric label="FC · /40" value={`${analytics.discipline.for.fouls} · ${number(analysis.rates.foulsFor40)}`} /><Metric label="FR · /40" value={`${analytics.discipline.against.fouls} · ${number(analysis.rates.foulsAgainst40)}`} /><Metric label="FC CRÍTICAS" value={analysis.criticalFouls.for} /><Metric label="FR CRÍTICAS" value={analysis.criticalFouls.against} /></div>
          </section>}

          {area === "EQUIPO" && <section>
            <SectionTitle eyebrow="RESULTADO DE CADA EVENTO">REMATES / AMENAZAS</SectionTitle>
            <div className="grid gap-3 md:grid-cols-2"><OutcomeBlock side="FOR" stats={analytics.threats.FOR} /><OutcomeBlock side="AGAINST" stats={analytics.threats.AGAINST} /></div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="SEGUNDA JUGADA" value={analytics.secondPlay.threats} /><Metric label="GOLES 2ª JUGADA" value={analytics.secondPlay.goals} /><Metric label="RECHACE + CONTINÚA" value={analytics.secondPlay.reboundsWithThreat} /><Metric label="RECHACE SIN CONT." value={analytics.secondPlay.reboundsWithoutThreat} /></div>
          </section>}

          {area === "EQUIPO" && <section>
            <SectionTitle eyebrow="FASE EFECTIVA">FASES</SectionTitle>
            <div className="space-y-2 rounded-3xl border border-slate-700 bg-slate-900 p-4">
              {DASHBOARD_PHASES.filter((phase) => analytics.phases[phase].FOR + analytics.phases[phase].AGAINST > 0).map((phase) => <div key={phase} className="grid grid-cols-[7rem_1fr_2rem] items-center gap-3 sm:grid-cols-[11rem_1fr_3rem]"><span className="truncate text-[10px] font-black text-slate-400">{PHASE_LABEL[phase]}</span><div className="flex h-5 overflow-hidden rounded-full bg-slate-950"><span className="bg-cyan-400" style={{ width: `${analytics.phases[phase].FOR / maxPhase * 50}%` }} /><span className="bg-rose-400" style={{ width: `${analytics.phases[phase].AGAINST / maxPhase * 50}%` }} /></div><strong className="text-xs">{analytics.phases[phase].FOR}/{analytics.phases[phase].AGAINST}</strong></div>)}
            </div>
          </section>}

          {area === "PORTEROS" && <section>
            <SectionTitle eyebrow="ROL FUNCIONAL EN EL INSTANTE">PORTEROS</SectionTitle>
            {analysis.goalkeepers.length > 1 && <div className="mb-3 grid grid-cols-2 gap-2"><select aria-label="Portero A" value={keeperA?.playerId ?? ""} onChange={(event) => setKeeperAId(event.target.value)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black">{analysis.goalkeepers.map((keeper) => <option key={keeper.playerId} value={keeper.playerId}>A · #{keeper.number} {keeper.name}</option>)}</select><select aria-label="Portero B" value={keeperB?.playerId ?? ""} onChange={(event) => setKeeperBId(event.target.value)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black">{analysis.goalkeepers.map((keeper) => <option key={keeper.playerId} value={keeper.playerId}>B · #{keeper.number} {keeper.name}</option>)}</select></div>}
            <div className="grid gap-3 lg:grid-cols-2">
              {[keeperA, keeperB].filter((keeper, index, all) => keeper && all.findIndex((item) => item?.playerId === keeper.playerId) === index).map((keeper) => keeper && <article key={keeper.playerId} className="rounded-3xl border border-slate-700 bg-slate-900 p-4"><div className="flex items-center justify-between"><div><span className="text-xs font-black text-cyan-300">#{keeper.number}</span><h3 className="text-xl font-black">{keeper.name}</h3></div><strong className="text-3xl">{keeper.savePercentage === null ? "N/D" : `${keeper.savePercentage.toFixed(0)}%`}</strong></div><p className="mt-1 text-[10px] text-slate-500">% parada = PARADAS / (PARADAS + GOLES). FUERA no entra.</p><div className="mt-4 grid grid-cols-3 gap-2 text-center sm:grid-cols-6"><div><strong className="block text-xl">{number(keeper.minutes)}&apos;</strong><span className="text-[9px] text-slate-500">PORTERO</span></div><div><strong className="block text-xl">{keeper.threatsAgainst}</strong><span className="text-[9px] text-slate-500">AMEN.</span></div><div><strong className="block text-xl">{number(keeper.threatsAgainst40)}</strong><span className="text-[9px] text-slate-500">AMEN./40</span></div><div><strong className="block text-xl">{keeper.interiorThreats}</strong><span className="text-[9px] text-slate-500">INTERIOR</span></div><div><strong className="block text-xl text-emerald-300">{keeper.saves}</strong><span className="text-[9px] text-slate-500">PARADAS</span></div><div><strong className="block text-xl text-rose-300">{keeper.goalsAgainst} · {number(keeper.goalsAgainst40)}</strong><span className="text-[9px] text-slate-500">GC · /40</span></div></div><div className="mt-4"><SaveOutcomeSummary keeper={keeper} /></div></article>)}
              {analysis.goalkeepers.length === 0 && <p className="rounded-3xl border border-dashed border-slate-700 p-6 text-slate-500">N/D · Sin rol funcional reconstruible en este alcance.</p>}
            </div>
            {keeperA && <div className="mt-3 grid gap-3 lg:grid-cols-2"><GoalThreatMap points={keeperA.goalPoints} /><KeeperBodySummary keeper={keeperA} /></div>}
            {keeperA && keeperB && <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-900 p-3 text-xs"><strong>COMPARACIÓN A − B</strong><div className="mt-2 grid grid-cols-3 gap-2 text-center"><span>Amenazas /40<br/><b>{signed(difference(keeperA.threatsAgainst40, keeperB.threatsAgainst40))}</b></span><span>GC /40<br/><b>{signed(difference(keeperA.goalsAgainst40, keeperB.goalsAgainst40))}</b></span><span>% parada<br/><b>{signed(difference(keeperA.savePercentage, keeperB.savePercentage))}</b></span></div><p className="mt-2 text-[10px] text-slate-500">Diferencias absolutas; no generan un ranking de “mejor portero”.</p></div>}
          </section>}

          {area === "MAPAS / ZONAS" && <section>
            <SectionTitle eyebrow="COORDENADAS RAW">MAPAS</SectionTitle>
            <div className="grid gap-3 lg:grid-cols-2"><PitchThreatMap points={analytics.pitchPoints} side="FOR" /><PitchThreatMap points={analytics.pitchPoints} side="AGAINST" /><PitchZoneGrid zones={analysis.pitchZones} /><GoalThreatMap points={analytics.goalPoints} /><GoalZoneGrid zones={analysis.goalZones} /></div>
          </section>}

          {area === "EQUIPO" && <section>
            <SectionTitle eyebrow="EVENTOS">DISCIPLINA</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2"><article className="rounded-3xl border border-cyan-900 bg-slate-900 p-4"><h3 className="font-black text-cyan-300">CDA</h3><div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="FALTAS" value={analytics.discipline.for.fouls} /><Metric label="AMARILLAS" value={analytics.discipline.for.yellowCards} /><Metric label="ROJAS" value={analytics.discipline.for.redCards} /></div></article><article className="rounded-3xl border border-rose-900 bg-slate-900 p-4"><h3 className="font-black text-rose-300">RIV</h3><div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="FALTAS" value={analytics.discipline.against.fouls} /><Metric label="AMARILLAS" value={analytics.discipline.against.yellowCards} /><Metric label="ROJAS" value={analytics.discipline.against.redCards} /></div></article></div>
          </section>}

          {(analytics.missing.phase + analytics.missing.goalTarget + analytics.missing.goalkeeper + analytics.missing.bodyPart > 0) && <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 text-xs text-slate-400"><strong className="text-white">CALIDAD DEL DATO · EVENTOS ACTUALES</strong><p className="mt-2">Ausencias: fase {analytics.missing.phase} · destino {analytics.missing.goalTarget} · portero {analytics.missing.goalkeeper} · parte corporal {analytics.missing.bodyPart}. Se muestran como N/D; no se infiere información inexistente.</p></section>}
        </>}
      </main>
    </div>
  );
}
