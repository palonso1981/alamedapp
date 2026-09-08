"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { AppHeader } from "../../../../components/app/AppHeader";
import { availableTeams } from "../../../../lib/adminDomain";
import { SyncStatusBadge } from "../../../../components/match/SyncStatusBadge";
import { PlayerAvatar } from "../../../../components/player/PlayerAvatar";
import { StaffAvatar } from "../../../../components/player/StaffAvatar";
import { plannedMinutes, validatePreparation, validateStartingLineup } from "../../../../lib/preMatch";
import { canPlayGoalkeeper, playerSnapshot, staffSnapshot } from "../../../../lib/rosterDomain";
import { clubExtraPlayerCandidates, rosterWithExtraPlayers, seasonById } from "../../../../lib/seasonDomain";
import { usePreMatchStore } from "../../../../store/usePreMatchStore";
import { useTeamStore } from "../../../../store/useTeamStore";
import { CDA_CLUB_ID, CompetitionType } from "../../../../types";

export default function PreMatchPage() {
  const params = useParams<{ id: string }>(); const matchId = params.id; const router = useRouter();
  const session = usePreMatchStore((state) => state.matches[matchId]); const error = usePreMatchStore((state) => state.errors[matchId]);
  const load = usePreMatchStore((state) => state.load); const updateDetails = usePreMatchStore((state) => state.updateDetails); const toggleCalled = usePreMatchStore((state) => state.toggleCalled); const toggleStarter = usePreMatchStore((state) => state.toggleStarter); const selectGoalkeeper = usePreMatchStore((state) => state.selectGoalkeeper); const toggleStaff = usePreMatchStore((state) => state.toggleStaff); const setTarget = usePreMatchStore((state) => state.setTarget); const markReady = usePreMatchStore((state) => state.markReady); const start = usePreMatchStore((state) => state.start);
  const addExtraPlayer = usePreMatchStore((state) => state.addExtraPlayer);
  const preparation = session?.preparation;
  const matchClubId = preparation?.clubId ?? CDA_CLUB_ID;
  const workspace = useTeamStore((state) => state.teams[matchClubId]); const ensureRegistry = useTeamStore((state) => state.ensureRegistry); const ensureTeam = useTeamStore((state) => state.ensureTeam);
  const createPlayer = useTeamStore((state) => state.createPlayer);
  const addPlayerToSeason = useTeamStore((state) => state.addPlayerToSeason);
  const [lineupRequired, setLineupRequired] = useState(false);
  const [competitionType, setCompetitionType] = useState<CompetitionType>("LEAGUE");
  const [extraOpen, setExtraOpen] = useState(false);
  const [extraSearch, setExtraSearch] = useState("");
  const [extraPermanent, setExtraPermanent] = useState(false);
  const [showArchivedExtra, setShowArchivedExtra] = useState(false);
  useEffect(() => { ensureRegistry(); load(matchId); }, [ensureRegistry, load, matchId]);
  useEffect(() => ensureTeam(matchClubId), [ensureTeam, matchClubId]);
  const roster = useMemo(
    () => workspace ? rosterWithExtraPlayers(workspace, preparation?.seasonId, preparation?.extraPlayerIds) : undefined,
    [preparation?.extraPlayerIds, preparation?.seasonId, workspace],
  );
  const season = workspace ? seasonById(workspace, preparation?.seasonId) : undefined;
  useEffect(() => {
    if (preparation?.competitionType) setCompetitionType(preparation.competitionType);
  }, [preparation?.competitionType]);
  const activePlayers = useMemo(() => (roster?.players ?? []).filter((player) => player.active).sort((a, b) => a.number - b.number), [roster]);
  const activeStaff = useMemo(() => (roster?.staff ?? []).filter((member) => member.active), [roster]);
  const extraCandidates = useMemo(() => {
    if (!workspace) return [];
    const excluded = [...(preparation?.calledPlayerIds ?? []), ...(roster?.players.filter((player) => player.active).map((player) => player.playerId) ?? [])];
    return clubExtraPlayerCandidates(workspace, excluded, extraSearch, showArchivedExtra).slice(0, 8);
  }, [extraSearch, preparation?.calledPlayerIds, roster?.players, showArchivedExtra, workspace]);
  const playerAffiliations = useMemo(() => {
    if (!workspace) return new Map<string, string>();
    const teamNames = new Map(availableTeams(workspace, true).map((team) => [team.teamId, team.name]));
    return new Map(workspace.players.map((player) => {
      const names = Array.from(new Set(workspace.seasonPlayers.filter((membership) => membership.playerId === player.playerId && membership.active && !membership.deletedAt).map((membership) => teamNames.get(membership.teamId)).filter((name): name is string => Boolean(name))));
      return [player.playerId, names.join(" · ") || "Sin plantilla habitual"];
    }));
  }, [workspace]);
  const validation = session && roster ? validatePreparation(session, roster) : { valid: false, reasons: [] as string[] };
  const startValidation = session && roster ? validateStartingLineup(session, roster) : { valid: false, reasons: [] as string[] };
  const total = plannedMinutes(preparation);

  function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    updateDetails(matchId, {
      opponent: String(data.get("opponent") ?? ""),
      date: String(data.get("date") ?? ""),
      time: String(data.get("time") ?? ""),
      venue: String(data.get("venue")) === "AWAY" ? "AWAY" : "HOME",
      competitionType,
      competitionOtherDetail: String(data.get("competitionOtherDetail") ?? ""),
      competition: String(data.get("competition") ?? ""),
      opponentCategory: String(data.get("opponentCategory") ?? ""),
      matchday: String(data.get("matchday") ?? "") ? Number(data.get("matchday")) : undefined,
    });
  }

  function chooseExistingExtra(playerId: string) {
    if (!roster) return;
    addExtraPlayer(matchId, roster, playerId);
    setExtraOpen(false);
    setExtraSearch("");
  }

  function createExtra(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !preparation) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const playerId = createPlayer(matchClubId, {
      fullName: String(data.get("fullName") ?? ""),
      displayName: String(data.get("displayName") ?? ""),
      number: Number(data.get("number")),
      photoUrl: "",
      role: String(data.get("goalkeeper")) === "true" ? "GOALKEEPER" : "FIELD",
      canPlayGoalkeeper: String(data.get("goalkeeper")) === "true",
    }, null);
    if (!playerId) return;
    if (extraPermanent && preparation.seasonId) addPlayerToSeason(matchClubId, preparation.seasonId, playerId, Number(data.get("number")));
    const latestWorkspace = useTeamStore.getState().teams[matchClubId];
    const latestRoster = rosterWithExtraPlayers(latestWorkspace, preparation.seasonId, extraPermanent ? [] : [playerId]);
    if (extraPermanent) toggleCalled(matchId, latestRoster, playerId);
    else addExtraPlayer(matchId, latestRoster, playerId);
    setExtraOpen(false);
    setExtraSearch("");
  }

  if (!session || !preparation || !roster) return <div className="grid min-h-screen place-items-center bg-slate-900 text-white"><div className="text-center"><p>{error ?? "Cargando preparación…"}</p>{error && <Link href="/partidos" className="mt-4 inline-block rounded-xl bg-slate-700 px-4 py-3 font-bold">VOLVER</Link>}</div></div>;
  if (preparation.status === "LIVE" || preparation.status === "FINISHED") {
    const finished = preparation.status === "FINISHED";
    return <div className="min-h-screen bg-slate-900 text-white"><AppHeader title={preparation.opponent} actions={<SyncStatusBadge matchId={matchId} />} /><main className="mx-auto max-w-xl p-6 text-center"><div className="rounded-3xl border border-emerald-900 bg-slate-800 p-8"><p className="text-sm font-black text-emerald-300">{finished ? "PARTIDO FINALIZADO" : "PARTIDO EN CURSO"}</p><h2 className="mt-3 text-3xl font-black">{preparation.opponent}</h2><p className="mt-3 text-slate-400">La alineación inicial ya está congelada. Las correcciones deportivas se realizan desde la cronología.</p><Link href={`/partido/${matchId}/${finished ? "revision" : "directo"}`} className="mt-6 inline-grid min-h-14 w-full place-items-center rounded-xl bg-cyan-400 text-lg font-black text-slate-950">{finished ? "REVISAR PARTIDO →" : "ABRIR DIRECTO →"}</Link></div></main></div>;
  }

  return <div className="min-h-screen bg-slate-900 text-white"><AppHeader title={`Prepartido · ${preparation.opponent}`} actions={<SyncStatusBadge matchId={matchId} />} /><main className="mx-auto max-w-7xl space-y-5 p-3 sm:p-6">
    <section className="rounded-2xl border border-slate-700 bg-slate-800 p-4"><div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="text-xs font-bold text-slate-400">{preparation.date}{preparation.time ? ` · ${preparation.time}` : ""} · {preparation.venue === "HOME" ? "CDA LOCAL" : "CDA VISITANTE"}</p><h2 className="text-2xl font-black">{preparation.opponent}</h2><p className="text-sm text-slate-400">{season?.label ?? "LEGACY · SIN TEMPORADA"}{season?.category ? ` · ${season.category}` : ""} · {preparation.competition ?? preparation.competitionOtherDetail ?? "Sin competición"}{preparation.matchday ? ` · J${preparation.matchday}` : ""}{preparation.opponentCategory ? ` · Rival ${preparation.opponentCategory}` : ""}</p></div><span className={`rounded-xl px-4 py-2 text-center text-xs font-black ${preparation.status === "READY" ? "bg-emerald-950 text-emerald-300" : "bg-amber-950 text-amber-300"}`}>{preparation.status === "READY" ? "LISTO" : "PREPARACIÓN"}</span></div><details className="mt-3 border-t border-slate-700 pt-3"><summary className="cursor-pointer text-xs font-black text-cyan-300">EDITAR DATOS</summary><form onSubmit={saveDetails} className="mt-3 grid gap-2 sm:grid-cols-4"><input name="opponent" required defaultValue={preparation.opponent} aria-label="Rival" className="min-h-11 rounded-xl bg-slate-950 px-3 sm:col-span-2" /><input name="date" type="date" required defaultValue={preparation.date} aria-label="Fecha" className="min-h-11 rounded-xl bg-slate-950 px-3" /><input name="time" type="time" defaultValue={preparation.time} aria-label="Hora" className="min-h-11 rounded-xl bg-slate-950 px-3" /><select name="venue" defaultValue={preparation.venue} aria-label="Local o visitante" className="min-h-11 rounded-xl bg-slate-950 px-3"><option value="HOME">CDA local</option><option value="AWAY">CDA visitante</option></select><select name="competitionType" value={competitionType} onChange={(event) => setCompetitionType(event.target.value as CompetitionType)} aria-label="Tipo de competición" className="min-h-11 rounded-xl bg-slate-950 px-3"><option value="LEAGUE">Liga</option><option value="CUP">Copa</option><option value="FRIENDLY">Amistoso</option><option value="OTHER">Otros</option></select>{competitionType === "OTHER" && <input name="competitionOtherDetail" defaultValue={preparation.competitionOtherDetail} placeholder="Detalle del tipo" className="min-h-11 rounded-xl bg-slate-950 px-3" />}<input name="competition" defaultValue={preparation.competition} placeholder="Nombre competición" className="min-h-11 rounded-xl bg-slate-950 px-3" /><input name="opponentCategory" defaultValue={preparation.opponentCategory} placeholder="Categoría rival · opcional" className="min-h-11 rounded-xl bg-slate-950 px-3" /><input name="matchday" type="number" min="1" step="1" defaultValue={preparation.matchday} placeholder="Jornada" className="min-h-11 rounded-xl bg-slate-950 px-3" /><button type="submit" className="min-h-11 rounded-xl bg-cyan-400 px-4 font-black text-slate-950 sm:col-span-4">GUARDAR DATOS</button></form></details></section>
    {activePlayers.length === 0 && <section className="rounded-2xl border border-amber-800 bg-amber-950 p-5 text-amber-200">Crea primero jugadores activos en <Link href="/plantilla" className="font-black underline">Plantilla</Link>.</section>}
    <section id="convocatoria" className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
      <div className="flex items-center justify-between"><div><p className="text-xs font-black text-cyan-300">1 · CONVOCATORIA</p><h3 className="text-xl font-black">{preparation.calledPlayerIds.length} / 13</h3></div><span className="text-sm text-slate-400">Toca para convocar</span></div>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">{activePlayers.map((player) => { const selected = preparation.calledPlayerIds.includes(player.playerId); const extra = preparation.extraPlayerIds?.includes(player.playerId); return <button key={player.playerId} type="button" onClick={() => toggleCalled(matchId, roster, player.playerId)} className={`grid min-h-24 place-items-center rounded-xl border p-2 ${selected ? "border-cyan-300 bg-cyan-950" : "border-slate-700 bg-slate-900"}`}><PlayerAvatar player={playerSnapshot(player)} compact /><span className="mt-1 truncate text-xs font-black">{player.displayName}</span><span className="text-[10px] text-slate-400">#{player.number}{canPlayGoalkeeper(player) ? " · ◉" : ""}{extra ? " · EXTRA" : ""}</span></button>; })}</div>
      <button type="button" onClick={() => setExtraOpen((value) => !value)} className="mt-3 min-h-12 w-full rounded-xl border border-dashed border-cyan-700 bg-cyan-950/30 text-sm font-black text-cyan-200">+ AÑADIR JUGADOR EXTRA</button>
      {extraOpen && <div className="mt-3 rounded-2xl border border-cyan-900 bg-slate-950 p-4">
        <label className="text-xs font-black text-slate-300">BUSCAR JUGADOR DEL CLUB<input value={extraSearch} onChange={(event) => setExtraSearch(event.target.value)} placeholder="Nombre o dorsal" className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3" /><span className="mt-1 block text-[11px] font-normal text-slate-500">Busca primero para conservar el mismo playerId entre equipos y temporadas.</span></label><label className="mt-2 flex min-h-11 items-center gap-2 text-xs font-bold text-slate-400"><input type="checkbox" checked={showArchivedExtra} onChange={(event) => setShowArchivedExtra(event.target.checked)} className="h-5 w-5" />Mostrar jugadores archivados del club</label>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">{extraCandidates.map((player) => <button key={player.playerId} type="button" disabled={Boolean(player.archivedAt)} onClick={() => chooseExistingExtra(player.playerId)} className="flex min-h-14 items-center gap-3 rounded-xl bg-slate-800 p-2 text-left disabled:opacity-50"><PlayerAvatar player={playerSnapshot(player)} compact /><span><span className="block font-black">{player.displayName} · #{player.number}</span><span className="text-xs text-slate-500">{player.archivedAt ? "ARCHIVADO · reactiva en Jugadores del Club" : playerAffiliations.get(player.playerId)}</span></span></button>)}</div>
        <details className="mt-3 rounded-xl bg-slate-900 p-3"><summary className="min-h-11 cursor-pointer text-sm font-black text-amber-300">NO APARECE · CREAR JUGADOR</summary>
          <form onSubmit={createExtra} className="mt-3 grid gap-2 sm:grid-cols-2">
            <input name="fullName" required placeholder="Nombre completo" className="min-h-12 rounded-xl bg-slate-800 px-3" />
            <input name="displayName" required placeholder="Nombre corto" className="min-h-12 rounded-xl bg-slate-800 px-3" />
            <input name="number" type="number" min="0" max="99" required placeholder="Dorsal" className="min-h-12 rounded-xl bg-slate-800 px-3" />
            <select name="goalkeeper" className="min-h-12 rounded-xl bg-slate-800 px-3"><option value="false">Jugador de campo</option><option value="true">Puede ser portero</option></select>
            <label className="flex min-h-12 items-center gap-3 rounded-xl bg-slate-800 px-3 text-sm font-bold sm:col-span-2"><input type="checkbox" checked={extraPermanent} onChange={(event) => setExtraPermanent(event.target.checked)} className="h-5 w-5" />Añadir también a plantilla</label>
            <p className="text-xs text-slate-500 sm:col-span-2">{extraPermanent ? "Creará la membership equipo + temporada manteniendo el mismo playerId." : "Solo este partido: conservará snapshot histórico sin alterar la plantilla habitual."}</p>
            <button type="submit" className="min-h-12 rounded-xl bg-amber-400 font-black text-slate-950 sm:col-span-2">CREAR Y CONVOCAR</button>
          </form>
        </details>
      </div>}
    </section>
    <section id="quinteto-inicial" className={`rounded-2xl border bg-slate-800 p-4 ${lineupRequired && !startValidation.valid ? "border-amber-300 ring-4 ring-amber-400/20" : "border-slate-700"}`}><div className="flex items-center justify-between"><div><p className="text-xs font-black text-amber-300">2 · CINCO INICIALES · AL INICIAR</p><h3 className="text-xl font-black">{preparation.starterPlayerIds.length} / 5</h3></div><span className="text-sm text-slate-400">Banquillo: {preparation.calledPlayerIds.length - preparation.starterPlayerIds.length}</span></div>{lineupRequired && !startValidation.valid && <p className="mt-2 rounded-xl bg-amber-950 p-3 text-sm font-bold text-amber-200">Elige cinco y después marca quién ejercerá de portero inicial.</p>}<div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">{preparation.calledPlayerIds.map((playerId) => { const player = roster.players.find((item) => item.playerId === playerId); if (!player) return null; const starter = preparation.starterPlayerIds.includes(playerId); const goalkeeper = preparation.startingGoalkeeperId === playerId; return <div key={playerId} className={`relative rounded-xl border p-2 ${starter ? "border-amber-300 bg-amber-950" : "border-slate-700 bg-slate-900"}`}><button type="button" onClick={() => { toggleStarter(matchId, roster, playerId); setLineupRequired(true); }} className="grid min-h-20 w-full place-items-center"><PlayerAvatar player={playerSnapshot(player)} compact /><span className="mt-1 text-xs font-black">{player.displayName}</span></button>{starter && canPlayGoalkeeper(player) && <button type="button" aria-label={`Elegir a ${player.displayName} como portero inicial`} onClick={() => { selectGoalkeeper(matchId, roster, playerId); setLineupRequired(false); }} className={`mt-1 min-h-9 w-full rounded-lg text-xs font-black ${goalkeeper ? "bg-emerald-400 text-slate-950" : "bg-slate-700"}`}>{goalkeeper ? "◉ PORTERO" : "○ PORTERO"}</button>}</div>; })}</div></section>
    <section className="grid gap-5 lg:grid-cols-2"><div className="rounded-2xl border border-slate-700 bg-slate-800 p-4"><p className="text-xs font-black text-violet-300">3 · STAFF PRESENTE</p><div className="mt-3 grid grid-cols-3 gap-2">{activeStaff.map((member) => { const selected = preparation.selectedStaffIds.includes(member.staffId); return <button key={member.staffId} type="button" onClick={() => toggleStaff(matchId, roster, member.staffId)} className={`grid min-h-24 place-items-center rounded-xl border p-2 ${selected ? "border-violet-300 bg-violet-950" : "border-slate-700 bg-slate-900"}`}><StaffAvatar member={staffSnapshot(member)} compact /><span className="mt-1 truncate text-xs font-black">{member.displayName}</span></button>; })}{activeStaff.length === 0 && <Link href="/plantilla" className="col-span-full rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-400">Añadir staff</Link>}</div></div>
    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4"><div className="flex items-center justify-between"><p className="text-xs font-black text-slate-300">4 · MINUTOS · OPCIONAL</p>{total !== null && <span className="text-sm font-black text-cyan-300">Planificado: {total}′</span>}</div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{preparation.calledPlayerIds.map((playerId) => { const player = roster.players.find((item) => item.playerId === playerId); if (!player) return null; return <label key={playerId} className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-slate-900 px-3 text-sm font-bold"><span className="truncate">{player.displayName}</span><input aria-label={`Minutos objetivo de ${player.displayName}`} type="number" min="0" max="40" value={preparation.targetMinutes[playerId] ?? ""} onChange={(event) => setTarget(matchId, playerId, event.target.value === "" ? null : Number(event.target.value))} className="h-9 w-16 rounded-lg bg-slate-700 px-2 text-center" /></label>; })}</div></div></section>
    {error && <p role="alert" className="rounded-xl border border-red-800 bg-red-950 p-3 text-red-200">{error}</p>}
    <section className="sticky bottom-2 z-20 rounded-2xl border border-slate-600 bg-slate-950/95 p-3 shadow-2xl backdrop-blur"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div>{validation.valid ? <p className="font-black text-emerald-300">✓ Preparación guardable</p> : <p className="text-sm text-amber-300">{validation.reasons[0]}</p>}<p className="text-xs text-slate-500">El quinteto puede decidirse justo antes de iniciar.</p></div><div className="flex gap-2"><button type="button" onClick={() => markReady(matchId, roster)} disabled={!validation.valid} className="min-h-12 rounded-xl bg-slate-700 px-4 font-black disabled:opacity-30">GUARDAR LISTO</button><button type="button" onClick={() => { if (!startValidation.valid) { setLineupRequired(true); document.getElementById("quinteto-inicial")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; } if (start(matchId, roster)) router.push(`/partido/${matchId}/directo`); }} className="min-h-14 flex-1 rounded-xl bg-emerald-400 px-6 text-lg font-black text-slate-950 sm:flex-none">INICIAR PARTIDO →</button></div></div></section>
  </main></div>;
}
