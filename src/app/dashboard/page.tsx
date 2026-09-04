"use client";

import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "../../components/app/AppHeader";
import {
  GoalThreatMap,
  PitchThreatMap,
} from "../../components/dashboard/ThreatMaps";
import {
  buildDashboardAnalytics,
  DASHBOARD_BODY_PARTS,
  DASHBOARD_PHASES,
  DASHBOARD_SAVE_OUTCOMES,
  DashboardMatchRecord,
  DashboardPeriod,
} from "../../lib/dashboardAnalytics";
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

const BODY_LABEL: Record<string, string> = {
  HEAD: "CABEZA",
  TORSO: "TRONCO",
  LEFT_ARM_HAND: "BRAZO/MANO IZQ.",
  RIGHT_ARM_HAND: "BRAZO/MANO DER.",
  LEFT_LEG_FOOT: "PIERNA/PIE IZQ.",
  RIGHT_LEG_FOOT: "PIERNA/PIE DER.",
};

const SAVE_LABEL: Record<string, string> = {
  CATCH: "BLOCAJE",
  REBOUND: "RECHACE",
  CLEARANCE: "DESPEJE",
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

function OutcomeBlock({ side, stats }: { side: ThreatSide; stats: ReturnType<typeof buildDashboardAnalytics>["threats"][ThreatSide] }) {
  const outcomes: Array<[ThreatOutcome, string]> = [
    ["GOL", "text-rose-300"],
    ["PARADA", "text-emerald-300"],
    ["FUERA", "text-amber-200"],
  ];
  if (stats.BLOQUEADO > 0) outcomes.push(["BLOQUEADO", "text-slate-300"]);
  return (
    <article className={`rounded-3xl border p-4 ${side === "FOR" ? "border-cyan-800 bg-cyan-950/25" : "border-rose-900 bg-rose-950/20"}`}>
      <div className="flex items-end justify-between">
        <div><p className="text-[10px] font-black tracking-[0.16em] text-slate-400">AMENAZAS</p><h3 className="text-xl font-black">{side === "FOR" ? "CDA →" : "← RIV"}</h3></div>
        <strong className="text-4xl">{stats.total}</strong>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {outcomes.map(([outcome, color]) => <div key={outcome} className="rounded-xl bg-slate-950/60 p-2 text-center"><strong className={`block text-xl ${color}`}>{stats[outcome]}</strong><span className="text-[9px] font-black text-slate-500">{outcome}</span></div>)}
      </div>
    </article>
  );
}

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

  const analytics = useMemo(
    () => buildDashboardAnalytics(records, {
      clubId: currentClubId,
      teamId,
      seasonId,
      matchId: matchId === "ALL" ? undefined : matchId,
      period: matchId === "ALL" ? "ALL" : period,
      includeArchived,
    }),
    [currentClubId, includeArchived, matchId, period, records, seasonId, teamId],
  );
  const hasTargets = analytics.players.some((player) => player.targetMinutes !== undefined);
  const maxPhase = Math.max(1, ...DASHBOARD_PHASES.flatMap((phase) => [analytics.phases[phase].FOR, analytics.phases[phase].AGAINST]));
  const pendingCount = analytics.quality.reduce((sum, match) => sum + match.pendingReview, 0);
  const manualCount = analytics.quality.reduce((sum, match) => sum + match.manualReviewEvents, 0);

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
        </section>

        {analytics.matches === 0 ? (
          <section className="rounded-3xl border border-dashed border-slate-700 p-10 text-center"><strong className="text-xl">Sin partidos locales para esta selección</strong><p className="mt-2 text-sm text-slate-500">El Dashboard funciona offline con partidos ya disponibles en este dispositivo.</p></section>
        ) : <>
          <section>
            <SectionTitle eyebrow="QUÉ HA PASADO">RESUMEN</SectionTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="PARTIDOS" value={analytics.matches} />
              <Metric label="V · E · D" value={`${analytics.wins} · ${analytics.draws} · ${analytics.losses}`} />
              <Metric label="GOLES CDA" value={analytics.goalsFor} accent="text-cyan-300" />
              <Metric label="GOLES RIV" value={analytics.goalsAgainst} accent="text-rose-300" />
              <Metric label="AMENAZAS CDA" value={analytics.threats.FOR.total} />
              <Metric label="AMENAZAS RIV" value={analytics.threats.AGAINST.total} />
            </div>
            {(pendingCount > 0 || manualCount > 0 || analytics.quality.some((match) => match.reviewStatus !== "VALIDATED")) && <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-full bg-amber-950 px-3 py-2 text-amber-200">{pendingCount > 0 ? `? ${pendingCount} pendientes` : "Datos no validados"}</span>{manualCount > 0 && <span className="rounded-full bg-violet-950 px-3 py-2 text-violet-200">{manualCount} añadidos en revisión</span>}</div>}
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {analytics.quality.map((match) => <div key={match.matchId} className="shrink-0 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[10px]"><strong className="block max-w-44 truncate text-white">{match.opponent}</strong><span className={match.status === "LIVE" ? "text-rose-300" : "text-emerald-300"}>{match.status === "LIVE" ? "EN CURSO" : "TERMINADO"}</span><span className="mx-1 text-slate-700">·</span><span className="text-slate-400">{match.reviewStatus === "VALIDATED" ? "VALIDADO" : match.reviewStatus === "IN_REVIEW" ? "EN REVISIÓN" : "PENDIENTE DE REVISIÓN"}</span><span className="mx-1 text-slate-700">·</span><span className={match.hasCompleteEvents ? "text-cyan-300" : "text-amber-300"}>{match.hasCompleteEvents ? "EVENTOS COMPLETOS" : "DATOS PARCIALES"}</span>{match.pendingReview > 0 && <span className="ml-2 text-amber-300">? {match.pendingReview}</span>}</div>)}
            </div>
          </section>

          <section>
            <SectionTitle eyebrow="REPLAY">MINUTOS Y JUGADORES</SectionTitle>
            <div className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-900">
              <div className={`grid ${hasTargets ? "grid-cols-[3rem_1fr_repeat(6,minmax(3rem,auto))]" : "grid-cols-[3rem_1fr_repeat(5,minmax(3rem,auto))]"} gap-2 border-b border-slate-700 px-3 py-2 text-[9px] font-black text-slate-500`}><span>#</span><span>JUGADOR</span><span>PJ</span><span>MIN</span><span>G</span><span>A</span><span>AMEN.</span>{hasTargets && <span>OBJ/±</span>}</div>
              {analytics.players.map((player) => <div key={player.playerId} className={`grid ${hasTargets ? "grid-cols-[3rem_1fr_repeat(6,minmax(3rem,auto))]" : "grid-cols-[3rem_1fr_repeat(5,minmax(3rem,auto))]"} items-center gap-2 border-b border-slate-800 px-3 py-3 text-sm last:border-0`}><strong className="text-cyan-300">{player.number}</strong><strong className="truncate">{player.name}</strong><span>{player.matches}</span><strong>{player.minutes}&apos;</strong><span>{player.goals}</span><span>{player.assists}</span><span>{player.threats}</span>{hasTargets && <span className="text-xs text-slate-400">{player.targetMinutes === undefined ? "—" : `${player.targetMinutes}'/${player.minutes - player.targetMinutes >= 0 ? "+" : ""}${player.minutes - player.targetMinutes}`}</span>}</div>)}
            </div>
          </section>

          <section>
            <SectionTitle eyebrow="RESULTADO DE CADA EVENTO">AMENAZAS</SectionTitle>
            <div className="grid gap-3 md:grid-cols-2"><OutcomeBlock side="FOR" stats={analytics.threats.FOR} /><OutcomeBlock side="AGAINST" stats={analytics.threats.AGAINST} /></div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="SEGUNDA JUGADA" value={analytics.secondPlay.threats} /><Metric label="GOLES 2ª JUGADA" value={analytics.secondPlay.goals} /><Metric label="RECHACE + CONTINÚA" value={analytics.secondPlay.reboundsWithThreat} /><Metric label="RECHACE SIN CONT." value={analytics.secondPlay.reboundsWithoutThreat} /></div>
          </section>

          <section>
            <SectionTitle eyebrow="FASE EFECTIVA">FASES</SectionTitle>
            <div className="space-y-2 rounded-3xl border border-slate-700 bg-slate-900 p-4">
              {DASHBOARD_PHASES.filter((phase) => analytics.phases[phase].FOR + analytics.phases[phase].AGAINST > 0).map((phase) => <div key={phase} className="grid grid-cols-[7rem_1fr_2rem] items-center gap-3 sm:grid-cols-[11rem_1fr_3rem]"><span className="truncate text-[10px] font-black text-slate-400">{PHASE_LABEL[phase]}</span><div className="flex h-5 overflow-hidden rounded-full bg-slate-950"><span className="bg-cyan-400" style={{ width: `${analytics.phases[phase].FOR / maxPhase * 50}%` }} /><span className="bg-rose-400" style={{ width: `${analytics.phases[phase].AGAINST / maxPhase * 50}%` }} /></div><strong className="text-xs">{analytics.phases[phase].FOR}/{analytics.phases[phase].AGAINST}</strong></div>)}
            </div>
          </section>

          <section>
            <SectionTitle eyebrow="ROL FUNCIONAL EN EL INSTANTE">PORTEROS</SectionTitle>
            <div className="grid gap-3 lg:grid-cols-2">
              {analytics.goalkeepers.map((keeper) => <article key={keeper.playerId} className="rounded-3xl border border-slate-700 bg-slate-900 p-4"><div className="flex items-center justify-between"><div><span className="text-xs font-black text-cyan-300">#{keeper.number}</span><h3 className="text-xl font-black">{keeper.name}</h3></div><strong className="text-3xl">{keeper.savePercentage === null ? "N/D" : `${keeper.savePercentage.toFixed(0)}%`}</strong></div><p className="mt-1 text-[10px] text-slate-500">% parada = PARADAS / (PARADAS + GOLES). FUERA no entra.</p><div className="mt-4 grid grid-cols-4 gap-2 text-center"><div><strong className="block text-xl">{keeper.minutes}&apos;</strong><span className="text-[9px] text-slate-500">PORTERO</span></div><div><strong className="block text-xl">{keeper.threatsAgainst}</strong><span className="text-[9px] text-slate-500">AMEN.</span></div><div><strong className="block text-xl text-emerald-300">{keeper.saves}</strong><span className="text-[9px] text-slate-500">PARADAS</span></div><div><strong className="block text-xl text-rose-300">{keeper.goalsAgainst}</strong><span className="text-[9px] text-slate-500">GOLES</span></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div><p className="mb-2 text-[9px] font-black text-slate-500">INTERVENCIÓN</p>{DASHBOARD_BODY_PARTS.map((part) => <div key={part} className="flex justify-between border-t border-slate-800 py-1 text-xs"><span className="text-slate-400">{BODY_LABEL[part]}</span><strong>{keeper.bodyParts[part]}</strong></div>)}</div><div><p className="mb-2 text-[9px] font-black text-slate-500">DESENLACE</p>{DASHBOARD_SAVE_OUTCOMES.map((outcome) => <div key={outcome} className="flex justify-between border-t border-slate-800 py-1 text-xs"><span className="text-slate-400">{SAVE_LABEL[outcome]}</span><strong>{keeper.saveOutcomes[outcome]}</strong></div>)}</div></div></article>)}
              {analytics.goalkeepers.length === 0 && <p className="rounded-3xl border border-dashed border-slate-700 p-6 text-slate-500">N/D · Sin rol funcional reconstruible en este alcance.</p>}
            </div>
          </section>

          <section>
            <SectionTitle eyebrow="COORDENADAS RAW">MAPAS</SectionTitle>
            <div className="grid gap-3 lg:grid-cols-2"><PitchThreatMap points={analytics.pitchPoints} side="FOR" /><PitchThreatMap points={analytics.pitchPoints} side="AGAINST" /><GoalThreatMap points={analytics.goalPoints} /></div>
          </section>

          <section>
            <SectionTitle eyebrow="EVENTOS">DISCIPLINA</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2"><article className="rounded-3xl border border-cyan-900 bg-slate-900 p-4"><h3 className="font-black text-cyan-300">CDA</h3><div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="FALTAS" value={analytics.discipline.for.fouls} /><Metric label="AMARILLAS" value={analytics.discipline.for.yellowCards} /><Metric label="ROJAS" value={analytics.discipline.for.redCards} /></div></article><article className="rounded-3xl border border-rose-900 bg-slate-900 p-4"><h3 className="font-black text-rose-300">RIV</h3><div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="FALTAS" value={analytics.discipline.against.fouls} /><Metric label="AMARILLAS" value={analytics.discipline.against.yellowCards} /><Metric label="ROJAS" value={analytics.discipline.against.redCards} /></div></article></div>
          </section>

          {(analytics.missing.phase + analytics.missing.goalTarget + analytics.missing.goalkeeper + analytics.missing.bodyPart > 0) && <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 text-xs text-slate-400"><strong className="text-white">CALIDAD DEL DATO · EVENTOS ACTUALES</strong><p className="mt-2">Ausencias: fase {analytics.missing.phase} · destino {analytics.missing.goalTarget} · portero {analytics.missing.goalkeeper} · parte corporal {analytics.missing.bodyPart}. Se muestran como N/D; no se infiere información inexistente.</p></section>}
        </>}
      </main>
    </div>
  );
}
