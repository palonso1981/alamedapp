"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppHeader } from "../../components/app/AppHeader";
import { PlayerAvatar } from "../../components/player/PlayerAvatar";
import { StaffAvatar } from "../../components/player/StaffAvatar";
import { TeamSyncStatusBadge } from "../../components/team/TeamSyncStatusBadge";
import { playerSnapshot, staffRoleLabel, staffSnapshot } from "../../lib/rosterDomain";
import { useTeamStore } from "../../store/useTeamStore";
import { CDA_TEAM_ID, MasterPlayer, MasterPlayerRole, MasterStaffMember, MasterStaffRole } from "../../types";

type Editor = { kind: "PLAYER"; value?: MasterPlayer } | { kind: "STAFF"; value?: MasterStaffMember } | null;
const STAFF_ROLES: Array<{ value: MasterStaffRole; label: string }> = [
  { value: "HEAD_COACH", label: "Entrenador" }, { value: "ASSISTANT_COACH", label: "Segundo" },
  { value: "DELEGATE", label: "Delegado" }, { value: "FITNESS_COACH", label: "Preparador" },
  { value: "OTHER", label: "Otro" },
];

export default function RosterPage() {
  const roster = useTeamStore((state) => state.teams[CDA_TEAM_ID]);
  const error = useTeamStore((state) => state.errors[CDA_TEAM_ID]);
  const ensureTeam = useTeamStore((state) => state.ensureTeam);
  const createPlayer = useTeamStore((state) => state.createPlayer);
  const updatePlayer = useTeamStore((state) => state.updatePlayer);
  const createStaff = useTeamStore((state) => state.createStaff);
  const updateStaff = useTeamStore((state) => state.updateStaff);
  const clearError = useTeamStore((state) => state.clearError);
  const [tab, setTab] = useState<"PLAYERS" | "STAFF">("PLAYERS");
  const [showInactive, setShowInactive] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);

  useEffect(() => ensureTeam(CDA_TEAM_ID), [ensureTeam]);
  const players = useMemo(() => (roster?.players ?? []).filter((player) => showInactive || player.active).sort((a, b) => a.number - b.number), [roster, showInactive]);
  const staff = useMemo(() => (roster?.staff ?? []).filter((member) => showInactive || member.active).sort((a, b) => a.displayName.localeCompare(b.displayName)), [roster, showInactive]);

  function submitPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const input = { fullName: String(data.get("fullName") ?? ""), displayName: String(data.get("displayName") ?? ""), number: Number(data.get("number")), photoUrl: String(data.get("photoUrl") ?? ""), role: String(data.get("role")) as MasterPlayerRole };
    if (editor?.kind === "PLAYER" && editor.value) updatePlayer(CDA_TEAM_ID, editor.value.playerId, input); else createPlayer(CDA_TEAM_ID, input);
    if (!useTeamStore.getState().errors[CDA_TEAM_ID]) setEditor(null);
  }

  function submitStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const input = { fullName: String(data.get("fullName") ?? ""), displayName: String(data.get("displayName") ?? ""), role: String(data.get("role")) as MasterStaffRole, customRole: String(data.get("customRole") ?? ""), photoUrl: String(data.get("photoUrl") ?? "") };
    if (editor?.kind === "STAFF" && editor.value) updateStaff(CDA_TEAM_ID, editor.value.staffId, input); else createStaff(CDA_TEAM_ID, input);
    if (!useTeamStore.getState().errors[CDA_TEAM_ID]) setEditor(null);
  }

  return <div className="min-h-screen bg-slate-900 text-white">
    <AppHeader title="Plantilla" actions={<TeamSyncStatusBadge teamId={CDA_TEAM_ID} />} />
    <main className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-xl bg-slate-800 p-1">
          <button type="button" onClick={() => setTab("PLAYERS")} className={`min-h-11 rounded-lg px-5 font-black ${tab === "PLAYERS" ? "bg-cyan-400 text-slate-950" : "text-slate-300"}`}>JUGADORES · {roster?.players.filter((item) => item.active).length ?? 0}</button>
          <button type="button" onClick={() => setTab("STAFF")} className={`min-h-11 rounded-lg px-5 font-black ${tab === "STAFF" ? "bg-violet-400 text-slate-950" : "text-slate-300"}`}>STAFF · {roster?.staff.filter((item) => item.active).length ?? 0}</button>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowInactive((value) => !value)} className={`min-h-11 rounded-xl px-4 text-sm font-bold ${showInactive ? "bg-slate-600" : "bg-slate-800 text-slate-300"}`}>{showInactive ? "OCULTAR INACTIVOS" : "VER INACTIVOS"}</button>
          <button type="button" onClick={() => { clearError(CDA_TEAM_ID); setEditor({ kind: tab === "PLAYERS" ? "PLAYER" : "STAFF" }); }} className="min-h-12 rounded-xl bg-cyan-400 px-5 font-black text-slate-950">+ {tab === "PLAYERS" ? "JUGADOR" : "STAFF"}</button>
        </div>
      </div>
      {error && <div role="alert" className="mt-4 rounded-xl border border-red-800 bg-red-950 p-3 text-red-200">{error}</div>}
      {tab === "PLAYERS" ? <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {players.map((player) => <button key={player.playerId} type="button" onClick={() => setEditor({ kind: "PLAYER", value: player })} className={`flex min-h-28 items-center gap-3 rounded-2xl border p-3 text-left ${player.active ? "border-slate-700 bg-slate-800" : "border-slate-800 bg-slate-950 opacity-55"}`}>
          <PlayerAvatar player={playerSnapshot(player)} /><span className="min-w-0"><span className="block text-xl font-black">#{player.number}</span><span className="block truncate font-bold">{player.displayName}</span><span className="block truncate text-xs text-slate-400">{player.role === "GOALKEEPER" ? "◉ PORTERO" : "JUGADOR"}</span></span>
        </button>)}
        {players.length === 0 && <p className="col-span-full rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">Añade el primer jugador de la plantilla.</p>}
      </section> : <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {staff.map((member) => <button key={member.staffId} type="button" onClick={() => setEditor({ kind: "STAFF", value: member })} className={`flex min-h-24 items-center gap-3 rounded-2xl border p-3 text-left ${member.active ? "border-violet-900 bg-slate-800" : "border-slate-800 bg-slate-950 opacity-55"}`}><StaffAvatar member={staffSnapshot(member)} /><span className="min-w-0"><span className="block truncate font-black">{member.displayName}</span><span className="block truncate text-xs text-violet-300">{staffRoleLabel(member)}</span></span></button>)}
      </section>}
    </main>
    {editor && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4" onMouseDown={() => setEditor(null)}><form onSubmit={editor.kind === "PLAYER" ? submitPlayer : submitStaff} onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
      <div className="flex items-center justify-between"><h2 className="text-xl font-black">{editor.value ? "EDITAR" : "NUEVO"} {editor.kind === "PLAYER" ? "JUGADOR" : "STAFF"}</h2><button type="button" onClick={() => setEditor(null)} className="min-h-11 min-w-11 rounded-full bg-slate-800 text-xl">×</button></div>
      <label className="block text-sm font-bold text-slate-300">Nombre completo<input name="fullName" required defaultValue={editor.value?.fullName} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white" /></label>
      <label className="block text-sm font-bold text-slate-300">Nombre corto<input name="displayName" required defaultValue={editor.value?.displayName} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white" /></label>
      {editor.kind === "PLAYER" ? <div className="grid grid-cols-2 gap-3"><label className="text-sm font-bold text-slate-300">Dorsal<input name="number" required type="number" min="0" max="99" defaultValue={editor.value?.number ?? ""} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white" /></label><label className="text-sm font-bold text-slate-300">Rol<select name="role" defaultValue={editor.value?.role ?? "FIELD"} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white"><option value="FIELD">Campo</option><option value="GOALKEEPER">Portero</option></select></label></div> : <><label className="block text-sm font-bold text-slate-300">Rol<select name="role" defaultValue={editor.value?.role ?? "HEAD_COACH"} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white">{STAFF_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label><label className="block text-sm font-bold text-slate-300">Rol libre (solo Otro)<input name="customRole" defaultValue={editor.value?.customRole} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white" /></label></>}
      <label className="block text-sm font-bold text-slate-300">URL de foto (opcional)<input name="photoUrl" type="url" defaultValue={editor.value?.photoUrl} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white" /></label>
      <div className="flex gap-2">{editor.value && <button type="button" onClick={() => { if (editor.kind === "PLAYER") updatePlayer(CDA_TEAM_ID, editor.value!.playerId, { active: !editor.value!.active }); else updateStaff(CDA_TEAM_ID, editor.value!.staffId, { active: !editor.value!.active }); setEditor(null); }} className="min-h-12 flex-1 rounded-xl bg-slate-700 px-3 font-black">{editor.value.active ? "INACTIVAR" : "ACTIVAR"}</button>}<button type="submit" className="min-h-12 flex-[2] rounded-xl bg-cyan-400 px-5 font-black text-slate-950">GUARDAR</button></div>
    </form></div>}
  </div>;
}
