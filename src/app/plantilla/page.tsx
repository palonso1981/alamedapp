"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppHeader } from "../../components/app/AppHeader";
import { AdminEntityActions } from "../../components/admin/AdminEntityActions";
import { PlayerAvatar } from "../../components/player/PlayerAvatar";
import { PlayerPhotoUploader } from "../../components/player/PlayerPhotoUploader";
import { StaffAvatar } from "../../components/player/StaffAvatar";
import { TeamSyncStatusBadge } from "../../components/team/TeamSyncStatusBadge";
import { availableTeams, calculateDeletionImpact, impactSummary } from "../../lib/adminDomain";
import { listMatchCatalog } from "../../lib/matchCatalog";
import { playerSnapshot, staffRoleLabel, staffSnapshot } from "../../lib/rosterDomain";
import { currentSeason, rosterForSeason } from "../../lib/seasonDomain";
import { formatFutsalPosition } from "../../lib/positionFormat";
import { useTeamStore } from "../../store/useTeamStore";
import { DominantFoot, FutsalPosition, MasterPlayer, MasterPlayerRole, MasterStaffMember, MasterStaffRole } from "../../types";

type Editor = { kind: "PLAYER"; value?: MasterPlayer } | { kind: "STAFF"; value?: MasterStaffMember } | null;
const STAFF_ROLES: Array<{ value: MasterStaffRole; label: string }> = [
  { value: "HEAD_COACH", label: "Entrenador" }, { value: "ASSISTANT_COACH", label: "Segundo" },
  { value: "DELEGATE", label: "Delegado" }, { value: "FITNESS_COACH", label: "Preparador" },
  { value: "OTHER", label: "Otro" },
];

export default function RosterPage() {
  const currentClubId = useTeamStore((state) => state.currentClubId);
  const workspace = useTeamStore((state) => state.teams[state.currentClubId]);
  const error = useTeamStore((state) => state.errors[state.currentClubId]);
  const ensureRegistry = useTeamStore((state) => state.ensureRegistry);
  const ensureTeam = useTeamStore((state) => state.ensureTeam);
  const createPlayer = useTeamStore((state) => state.createPlayer);
  const addPlayerToSeason = useTeamStore((state) => state.addPlayerToSeason);
  const updatePlayer = useTeamStore((state) => state.updatePlayer);
  const setPlayerManagedPhoto = useTeamStore((state) => state.setPlayerManagedPhoto);
  const createStaff = useTeamStore((state) => state.createStaff);
  const updateStaff = useTeamStore((state) => state.updateStaff);
  const clearError = useTeamStore((state) => state.clearError);
  const changeLifecycle = useTeamStore((state) => state.changeLifecycle);
  const [tab, setTab] = useState<"PLAYERS" | "STAFF">("PLAYERS");
  const [showInactive, setShowInactive] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [seasonId, setSeasonId] = useState("");
  const [realTeamId, setRealTeamId] = useState("");
  const [scope, setScope] = useState<"ROSTER" | "CLUB">("ROSTER");
  const [playerPosition, setPlayerPosition] = useState<FutsalPosition | "">("");
  const [additionalGoalkeeper, setAdditionalGoalkeeper] = useState(false);
  const [clubPlayerPicker, setClubPlayerPicker] = useState(false);
  const [clubPlayerQuery, setClubPlayerQuery] = useState("");

  useEffect(() => ensureRegistry(), [ensureRegistry]);
  useEffect(() => ensureTeam(currentClubId), [currentClubId, ensureTeam]);
  useEffect(() => { setRealTeamId(""); setSeasonId(""); setEditor(null); }, [currentClubId]);
  useEffect(() => {
    if (editor?.kind !== "PLAYER") return;
    const position = editor.value?.primaryPosition ?? "";
    setPlayerPosition(position);
    setAdditionalGoalkeeper(
      position === "GOALKEEPER"
        ? false
        : editor.value?.canPlayGoalkeeper ?? editor.value?.role === "GOALKEEPER",
    );
  }, [editor]);
  useEffect(() => {
    if (!workspace || seasonId) return;
    const teams = availableTeams(workspace);
    const teamId = realTeamId || teams[0]?.teamId || "";
    if (!realTeamId && teamId) setRealTeamId(teamId);
    setSeasonId(currentSeason(workspace, teamId)?.seasonId ?? workspace.seasons.find((season) => season.teamId === teamId && !season.deletedAt && !season.archivedAt)?.seasonId ?? "");
  }, [realTeamId, seasonId, workspace]);
  const roster = useMemo(
    () => workspace ? rosterForSeason(workspace, seasonId || undefined) : undefined,
    [seasonId, workspace],
  );
  const selectedSeason = workspace?.seasons.find((season) => season.seasonId === seasonId);
  const teamOptions = workspace ? availableTeams(workspace) : [];
  const seasonOptions = workspace?.seasons.filter((season) => season.teamId === realTeamId && season.active && !season.deletedAt && !season.archivedAt) ?? [];
  const matchImpacts = listMatchCatalog();
  const players = useMemo(() => {
    const source = scope === "CLUB" ? workspace?.players ?? [] : roster?.players ?? [];
    return source.filter((player) => !player.deletedAt && (showInactive || (scope === "CLUB" ? !player.archivedAt && player.active : player.active))).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [roster, scope, showInactive, workspace]);
  const staff = useMemo(() => {
    const source = scope === "CLUB" ? workspace?.staff ?? [] : roster?.staff ?? [];
    return source.filter((member) => !member.deletedAt && (showInactive || (scope === "CLUB" ? !member.archivedAt && member.active : member.active))).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [roster, scope, showInactive, workspace]);
  const affiliations = useMemo(() => {
    const map = new Map<string, string>();
    if (!workspace) return map;
    for (const player of workspace.players) {
      const labels = workspace.seasonPlayers.filter((membership) => membership.playerId === player.playerId && membership.active && !membership.archivedAt && !membership.deletedAt).flatMap((membership) => {
        const season = workspace.seasons.find((item) => item.seasonId === membership.seasonId && !item.archivedAt && !item.deletedAt);
        const team = workspace.teams.find((item) => item.teamId === membership.teamId && !item.archivedAt && !item.deletedAt);
        return season && team ? [`${team.name} · ${season.label}`] : [];
      });
      map.set(player.playerId, labels.length ? Array.from(new Set(labels)).join(" · ") : "Sin plantilla activa");
    }
    return map;
  }, [workspace]);

  const linkedPlayerIds = useMemo(() => new Set(workspace?.seasonPlayers.filter((membership) => membership.seasonId === seasonId && membership.active && !membership.archivedAt && !membership.deletedAt).map((membership) => membership.playerId) ?? []), [seasonId, workspace]);
  const clubPlayerCandidates = useMemo(() => {
    const query = clubPlayerQuery.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return (workspace?.players ?? []).filter((player) => player.active && !player.archivedAt && !player.deletedAt).filter((player) => `${player.fullName} ${player.displayName} ${player.number} ${formatFutsalPosition(player.primaryPosition)}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(query));
  }, [clubPlayerQuery, workspace]);
  const editingPlayer = editor?.kind === "PLAYER" && editor.value
    ? workspace?.players.find((player) => player.playerId === editor.value!.playerId) ?? editor.value
    : undefined;

  function submitPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const primaryPosition = String(data.get("primaryPosition") ?? "");
    const canPlayGoalkeeper = primaryPosition === "GOALKEEPER"
      ? false
      : String(data.get("canPlayGoalkeeper")) === "true";
    const dominantFoot = String(data.get("dominantFoot") ?? "");
    const goalkeeperCapable = primaryPosition === "GOALKEEPER" || canPlayGoalkeeper;
    const input = { fullName: String(data.get("fullName") ?? ""), displayName: String(data.get("displayName") ?? ""), number: Number(data.get("number")), photoUrl: String(data.get("photoUrl") ?? ""), role: (goalkeeperCapable ? "GOALKEEPER" : "FIELD") as MasterPlayerRole, canPlayGoalkeeper, dateOfBirth: String(data.get("dateOfBirth") ?? ""), primaryPosition: primaryPosition ? primaryPosition as FutsalPosition : undefined, dominantFoot: dominantFoot ? dominantFoot as Exclude<DominantFoot, "UNKNOWN"> : undefined };
    const membershipSeason = scope === "ROSTER" ? seasonId || undefined : null;
    if (editor?.kind === "PLAYER" && editor.value) updatePlayer(currentClubId, editor.value.playerId, input, membershipSeason); else createPlayer(currentClubId, input, scope === "CLUB" ? null : membershipSeason);
    if (!useTeamStore.getState().errors[currentClubId]) setEditor(null);
  }

  function submitStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const input = { fullName: String(data.get("fullName") ?? ""), displayName: String(data.get("displayName") ?? ""), role: String(data.get("role")) as MasterStaffRole, customRole: String(data.get("customRole") ?? ""), photoUrl: String(data.get("photoUrl") ?? "") };
    const membershipSeason = scope === "ROSTER" ? seasonId || undefined : null;
    if (editor?.kind === "STAFF" && editor.value) updateStaff(currentClubId, editor.value.staffId, input, membershipSeason); else createStaff(currentClubId, input, membershipSeason);
    if (!useTeamStore.getState().errors[currentClubId]) setEditor(null);
  }

  return <div className="min-h-screen bg-slate-900 text-white">
    <AppHeader title={scope === "CLUB" ? `Jugadores del club · ${workspace?.club.name ?? ""}` : `Plantilla · ${selectedSeason?.label ?? "Sin temporada"}`} actions={<TeamSyncStatusBadge teamId={currentClubId} />} />
    <main className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="mb-4 flex rounded-xl bg-slate-800 p-1"><button type="button" onClick={() => { setScope("ROSTER"); setEditor(null); }} className={`min-h-11 flex-1 rounded-lg px-4 text-sm font-black ${scope === "ROSTER" ? "bg-amber-400 text-slate-950" : "text-slate-300"}`}>PLANTILLA EQUIPO</button><button type="button" onClick={() => { setScope("CLUB"); setEditor(null); }} className={`min-h-11 flex-1 rounded-lg px-4 text-sm font-black ${scope === "CLUB" ? "bg-cyan-400 text-slate-950" : "text-slate-300"}`}>JUGADORES DEL CLUB</button></div>
      {scope === "CLUB" && <p className="mb-4 rounded-2xl border border-cyan-900 bg-cyan-950/20 p-3 text-sm text-slate-300">Registro único de personas. Un jugador puede participar en varios equipos sin duplicarse.</p>}
      {scope === "ROSTER" && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-700 bg-slate-800 p-3">
        <label className="text-xs font-black text-slate-400">EQUIPO<select value={realTeamId} onChange={(event) => { const next = event.target.value; setRealTeamId(next); setSeasonId(currentSeason(workspace!, next)?.seasonId ?? workspace!.seasons.find((season) => season.teamId === next && !season.archivedAt && !season.deletedAt)?.seasonId ?? ""); setEditor(null); }} className="ml-3 min-h-11 rounded-xl bg-slate-950 px-3 text-white">{teamOptions.map((team) => <option key={team.teamId} value={team.teamId}>{team.name}</option>)}</select></label>
        <label className="text-xs font-black text-slate-400">TEMPORADA<select value={seasonId} onChange={(event) => { setSeasonId(event.target.value); setEditor(null); }} className="ml-3 min-h-11 rounded-xl bg-slate-950 px-3 text-white"><option value="">LEGACY · SIN ASIGNAR</option>{seasonOptions.map((season) => <option key={season.seasonId} value={season.seasonId}>{season.label}{season.current ? " · ACTUAL" : ""}</option>)}</select></label>
        {!selectedSeason && <Link href="/configuracion" className="min-h-11 rounded-xl bg-amber-400 px-4 py-3 text-xs font-black text-slate-950">CONFIGURAR TEMPORADA →</Link>}
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-xl bg-slate-800 p-1">
          <button type="button" onClick={() => setTab("PLAYERS")} className={`min-h-11 rounded-lg px-5 font-black ${tab === "PLAYERS" ? "bg-cyan-400 text-slate-950" : "text-slate-300"}`}>JUGADORES · {players.filter((item) => item.active && !item.archivedAt).length}</button>
          <button type="button" onClick={() => setTab("STAFF")} className={`min-h-11 rounded-lg px-5 font-black ${tab === "STAFF" ? "bg-violet-400 text-slate-950" : "text-slate-300"}`}>STAFF · {staff.filter((item) => item.active && !item.archivedAt).length}</button>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowInactive((value) => !value)} className={`min-h-11 rounded-xl px-4 text-sm font-bold ${showInactive ? "bg-slate-600" : "bg-slate-800 text-slate-300"}`}>{showInactive ? "OCULTAR ARCHIVADOS" : "MOSTRAR ARCHIVADOS"}</button>
          {scope === "ROSTER" && tab === "PLAYERS" && seasonId && <button type="button" onClick={() => setClubPlayerPicker(true)} className="min-h-12 rounded-xl border border-cyan-500 bg-cyan-950 px-4 text-xs font-black text-cyan-100">AÑADIR DEL CLUB</button>}
          <button type="button" onClick={() => { clearError(currentClubId); setEditor({ kind: tab === "PLAYERS" ? "PLAYER" : "STAFF" }); }} className="min-h-12 rounded-xl bg-cyan-400 px-5 font-black text-slate-950">+ {tab === "PLAYERS" ? "NUEVO" : "STAFF"}</button>
        </div>
      </div>
      {error && <div role="alert" className="mt-4 rounded-xl border border-red-800 bg-red-950 p-3 text-red-200">{error}</div>}
      {tab === "PLAYERS" ? <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {players.map((player) => <button key={player.playerId} type="button" onClick={() => setEditor({ kind: "PLAYER", value: player })} className={`flex min-h-28 items-center gap-3 rounded-2xl border p-3 text-left ${player.active ? "border-slate-700 bg-slate-800" : "border-slate-800 bg-slate-950 opacity-55"}`}>
          <PlayerAvatar player={playerSnapshot(player)} /><span className="min-w-0"><span className="block text-xl font-black">#{player.number}</span><span className="block truncate font-bold">{player.displayName}</span><span className="block truncate text-xs text-slate-400">{scope === "CLUB" ? affiliations.get(player.playerId) : formatFutsalPosition(player.primaryPosition)}{scope !== "CLUB" && (player.canPlayGoalkeeper ?? player.role === "GOALKEEPER") ? " · ◉" : ""}</span></span>
        </button>)}
        {players.length === 0 && <p className="col-span-full rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">Añade el primer jugador de la plantilla.</p>}
      </section> : <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {staff.map((member) => <button key={member.staffId} type="button" onClick={() => setEditor({ kind: "STAFF", value: member })} className={`flex min-h-24 items-center gap-3 rounded-2xl border p-3 text-left ${member.active ? "border-violet-900 bg-slate-800" : "border-slate-800 bg-slate-950 opacity-55"}`}><StaffAvatar member={staffSnapshot(member)} /><span className="min-w-0"><span className="block truncate font-black">{member.displayName}</span><span className="block truncate text-xs text-violet-300">{staffRoleLabel(member)}</span></span></button>)}
      </section>}
    </main>
    {clubPlayerPicker && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4" onMouseDown={() => setClubPlayerPicker(false)}><section onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-4"><header className="flex items-center justify-between"><div><h2 className="font-black">AÑADIR JUGADOR DEL CLUB</h2><p className="text-xs text-slate-500">Conserva su identidad e historial.</p></div><button type="button" onClick={() => setClubPlayerPicker(false)} className="min-h-11 min-w-11 rounded-full bg-slate-800 text-xl">×</button></header><input autoFocus value={clubPlayerQuery} onChange={(event) => setClubPlayerQuery(event.target.value)} placeholder="Nombre, dorsal o posición…" className="mt-4 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-4"/><div className="mt-3 max-h-80 space-y-2 overflow-y-auto">{clubPlayerCandidates.map((player) => { const linked = linkedPlayerIds.has(player.playerId); return <button type="button" key={player.playerId} disabled={linked} onClick={() => { addPlayerToSeason(currentClubId, seasonId, player.playerId, player.number); setClubPlayerPicker(false); setClubPlayerQuery(""); }} className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-slate-800 p-2 text-left disabled:opacity-45"><PlayerAvatar player={playerSnapshot(player)}/><span className="min-w-0 flex-1"><strong className="block truncate">#{player.number} · {player.displayName}</strong><small className="text-slate-400">{formatFutsalPosition(player.primaryPosition)}</small></span>{linked && <span className="text-[9px] font-black text-amber-300">YA EN EL EQUIPO</span>}</button>; })}{clubPlayerCandidates.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No hay jugadores activos del club con esa búsqueda.</p>}</div><button type="button" onClick={() => { setClubPlayerPicker(false); clearError(currentClubId); setEditor({ kind: "PLAYER" }); }} className="mt-3 min-h-11 w-full rounded-xl border border-slate-700 text-xs font-black">CREAR NUEVO JUGADOR</button></section></div>}
    {editor && <div className="fixed inset-0 z-50 grid place-items-start overflow-y-auto bg-slate-950/80 p-4 sm:place-items-center" onMouseDown={() => setEditor(null)}><form onSubmit={editor.kind === "PLAYER" ? submitPlayer : submitStaff} onMouseDown={(event) => event.stopPropagation()} className="my-4 w-full max-w-md space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:my-0">
      <div className="flex items-center justify-between"><h2 className="text-xl font-black">{editor.value ? "EDITAR" : "NUEVO"} {editor.kind === "PLAYER" ? "JUGADOR" : "STAFF"}</h2><button type="button" onClick={() => setEditor(null)} className="min-h-11 min-w-11 rounded-full bg-slate-800 text-xl">×</button></div>
      <label className="block text-sm font-bold text-slate-300">Nombre completo<input name="fullName" required defaultValue={editor.value?.fullName} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white" /><span className="mt-1 block text-[11px] font-normal text-slate-500">Identidad estable de la persona dentro del club.</span></label>
      <label className="block text-sm font-bold text-slate-300">Nombre corto<input name="displayName" required defaultValue={editor.value?.displayName} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white" /><span className="mt-1 block text-[11px] font-normal text-slate-500">Nombre visible en pista y controles compactos.</span></label>
      {editor.kind === "PLAYER" ? <>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-bold text-slate-300">Dorsal<input name="number" required type="number" min="0" max="99" defaultValue={editor.value?.number ?? ""} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white" /></label>
          <label className="text-sm font-bold text-slate-300">Nacimiento<input name="dateOfBirth" type="date" defaultValue={editor.value?.dateOfBirth ?? ""} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white" /></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-bold text-slate-300">Posición<select name="primaryPosition" value={playerPosition} onChange={(event) => setPlayerPosition(event.target.value as FutsalPosition | "")} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white"><option value="">Sin definir</option><option value="GOALKEEPER">Portero</option><option value="FIXO">Cierre</option><option value="WINGER">Ala</option><option value="PIVOT">Pívot</option><option value="UNIVERSAL">Universal</option></select></label>
          <label className="text-sm font-bold text-slate-300">Pierna<select name="dominantFoot" defaultValue={editor.value?.dominantFoot ?? ""} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white"><option value="">Sin definir</option><option value="RIGHT">Derecha</option><option value="LEFT">Izquierda</option><option value="BOTH">Ambas</option></select></label>
        </div>
        {playerPosition === "GOALKEEPER" ? <>
          <input type="hidden" name="canPlayGoalkeeper" value="false" />
          <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/40 p-3 text-sm font-bold text-emerald-200">◉ Apto como portero por su posición natural.</div>
        </> : <label className="block text-sm font-bold text-slate-300">También puede actuar de portero<select name="canPlayGoalkeeper" value={String(additionalGoalkeeper)} onChange={(event) => setAdditionalGoalkeeper(event.target.value === "true")} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white"><option value="false">No</option><option value="true">Sí</option></select><span className="mt-1 block text-[11px] font-normal text-slate-500">Márcalo solo si este jugador de campo puede ocupar la función de portero.</span></label>}
      </> : <><label className="block text-sm font-bold text-slate-300">Rol<select name="role" defaultValue={editor.value?.role ?? "HEAD_COACH"} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white">{STAFF_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label><label className="block text-sm font-bold text-slate-300">Rol libre (solo Otro)<input name="customRole" defaultValue={editor.value?.customRole} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white" /></label></>}
      {editor.kind === "PLAYER" && editingPlayer && <PlayerPhotoUploader clubId={currentClubId} player={editingPlayer} onPersist={(photo) => setPlayerManagedPhoto(currentClubId, editingPlayer.playerId, photo)} />}
      {editor.kind === "PLAYER" && !editor.value && <p className="rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-slate-400">Guarda primero el jugador para poder subir su foto.</p>}
      <label className="block text-sm font-bold text-slate-300">{editor.kind === "PLAYER" ? "URL de fotografía · legacy" : "URL de fotografía · temporal"}<input name="photoUrl" type="url" defaultValue={editor.value?.photoUrl} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white" /><span className="mt-1 block text-[11px] font-normal text-slate-500">{editor.kind === "PLAYER" ? "Se conserva como fallback. Una foto subida desde APP ALAM tiene prioridad." : "Mecanismo técnico provisional para staff."}</span></label>
      <div className="flex items-center gap-2">
        {editor.value && scope === "CLUB" && (() => {
          const entityType = editor.kind === "PLAYER" ? "PLAYER" as const : "STAFF" as const;
          const entityId = editor.kind === "PLAYER" ? editor.value.playerId : editor.value.staffId;
          const impact = calculateDeletionImpact(workspace!, entityType, entityId, matchImpacts);
          return <AdminEntityActions label={editor.value.displayName} archived={Boolean(editor.value.archivedAt || !editor.value.active)} impact={`${impactSummary(impact)}. Las participaciones históricas y snapshots se conservarán.`} onArchive={() => { changeLifecycle(currentClubId, entityType, entityId, "ARCHIVE"); setEditor(null); }} onReactivate={() => { changeLifecycle(currentClubId, entityType, entityId, "REACTIVATE"); setEditor(null); }} onDelete={() => { changeLifecycle(currentClubId, entityType, entityId, "DELETE"); setEditor(null); }} />;
        })()}
        {editor.value && scope === "ROSTER" && seasonId && <button type="button" onClick={() => { if (editor.kind === "PLAYER") updatePlayer(currentClubId, editor.value!.playerId, { active: !editor.value!.active }, seasonId); else updateStaff(currentClubId, editor.value!.staffId, { active: !editor.value!.active }, seasonId); setEditor(null); }} className="min-h-12 rounded-xl bg-slate-700 px-3 text-xs font-black">{editor.value.active ? "RETIRAR DE PLANTILLA" : "REACTIVAR EN PLANTILLA"}</button>}
        <button type="submit" className="min-h-12 flex-1 rounded-xl bg-cyan-400 px-5 font-black text-slate-950">GUARDAR</button>
      </div>
    </form></div>}
  </div>;
}
