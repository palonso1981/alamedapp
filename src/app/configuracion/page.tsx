"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { AdminEntityActions } from "../../components/admin/AdminEntityActions";
import { AppHeader } from "../../components/app/AppHeader";
import { TeamSyncStatusBadge } from "../../components/team/TeamSyncStatusBadge";
import { availableTeams, calculateDeletionImpact, impactSummary, isSeasonVisible } from "../../lib/adminDomain";
import { listMatchCatalog } from "../../lib/matchCatalog";
import { useTeamStore } from "../../store/useTeamStore";
import { CDA_CLUB_ID } from "../../types";

function Help({ children }: { children: string }) {
  return <span className="mt-1 block text-[11px] font-normal leading-4 text-slate-500">{children}</span>;
}

export default function ConfigurationPage() {
  const workspace = useTeamStore((state) => state.teams[CDA_CLUB_ID]);
  const error = useTeamStore((state) => state.errors[CDA_CLUB_ID]);
  const ensureTeam = useTeamStore((state) => state.ensureTeam);
  const createRealTeam = useTeamStore((state) => state.createRealTeam);
  const updateRealTeam = useTeamStore((state) => state.updateRealTeam);
  const createSeason = useTeamStore((state) => state.createSeason);
  const setCurrentSeason = useTeamStore((state) => state.setCurrentSeason);
  const changeLifecycle = useTeamStore((state) => state.changeLifecycle);
  const [copyFrom, setCopyFrom] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);

  useEffect(() => ensureTeam(CDA_CLUB_ID), [ensureTeam]);
  const teams = useMemo(() => workspace ? availableTeams(workspace, showArchived) : [], [showArchived, workspace]);
  useEffect(() => {
    if (!selectedTeamId && teams.length > 0) setSelectedTeamId(teams.find((team) => !team.archivedAt)?.teamId ?? teams[0].teamId);
  }, [selectedTeamId, teams]);
  const matches = listMatchCatalog();

  function addTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const teamId = createRealTeam(CDA_CLUB_ID, { name: String(data.get("name") ?? ""), shortName: String(data.get("shortName") ?? "") });
    if (teamId) { setSelectedTeamId(teamId); form.reset(); }
  }

  function addSeason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const seasonId = createSeason(CDA_CLUB_ID, { teamId: selectedTeamId, label: String(data.get("label") ?? ""), startDate: String(data.get("startDate") ?? ""), endDate: String(data.get("endDate") ?? ""), copyFromSeasonId: copyFrom || undefined });
    if (seasonId) { form.reset(); setCopyFrom(""); }
  }

  if (!workspace) return <div className="grid min-h-screen place-items-center bg-slate-900 text-white">Cargando configuración…</div>;
  const seasons = workspace.seasons.filter((season) => isSeasonVisible(season, showArchived)).sort((a, b) => b.label.localeCompare(a.label));
  const teamSeasons = seasons.filter((season) => season.teamId === selectedTeamId);
  const copyCandidates = workspace.seasons.filter((season) => season.teamId === selectedTeamId && !season.deletedAt);

  return <div className="min-h-screen bg-slate-900 text-white">
    <AppHeader title="Configuración" actions={<TeamSyncStatusBadge teamId={CDA_CLUB_ID} />} />
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <section className="rounded-3xl border border-slate-700 bg-slate-800 p-5">
        <p className="text-xs font-black uppercase tracking-wider text-cyan-300">Club</p>
        <h1 className="mt-2 text-2xl font-black">{workspace.club.name}</h1>
        <p className="mt-1 text-sm text-slate-400">Identidad fija V1 · un club, varios equipos y temporadas.</p>
      </section>

      <section className="rounded-3xl border border-slate-700 bg-slate-800 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-xs font-black uppercase tracking-wider text-emerald-300">Equipos</p><h2 className="mt-1 text-xl font-black">Equipo deportivo ≠ club</h2></div>
          <label className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-bold"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="h-5 w-5" />Mostrar archivados</label>
        </div>
        <div className="mt-4 space-y-2">
          {teams.map((team) => {
            const impact = calculateDeletionImpact(workspace, "TEAM", team.teamId, matches);
            return <div key={team.teamId} className={`flex min-h-16 items-center justify-between gap-3 rounded-2xl border px-4 ${team.archivedAt ? "border-slate-700 bg-slate-950/60 opacity-70" : selectedTeamId === team.teamId ? "border-emerald-400 bg-emerald-950/30" : "border-slate-700 bg-slate-900"}`}>
              <button type="button" onClick={() => setSelectedTeamId(team.teamId)} className="min-w-0 flex-1 text-left"><span className="block truncate font-black">{team.name}</span><span className="text-xs text-slate-500">{team.shortName}{team.teamId === CDA_CLUB_ID ? " · compatibilidad legacy" : ""}{team.archivedAt ? " · ARCHIVADO" : ""}</span></button>
              {team.teamId !== CDA_CLUB_ID && <AdminEntityActions label={team.name} archived={Boolean(team.archivedAt)} impact={`${impactSummary(impact)}. Sus referencias históricas se conservarán mediante tombstone.`} onEdit={() => setEditingTeamId(team.teamId)} onArchive={() => changeLifecycle(CDA_CLUB_ID, "TEAM", team.teamId, "ARCHIVE")} onReactivate={() => changeLifecycle(CDA_CLUB_ID, "TEAM", team.teamId, "REACTIVATE")} onDelete={() => changeLifecycle(CDA_CLUB_ID, "TEAM", team.teamId, "DELETE")} />}
            </div>;
          })}
          {teams.length === 0 && <p className="rounded-2xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-400">Crea el primer equipo; no se inventa ninguno automáticamente.</p>}
        </div>
        <details className="mt-4 rounded-2xl bg-slate-950 p-4"><summary className="min-h-11 cursor-pointer text-sm font-black text-emerald-300">+ CREAR EQUIPO</summary>
          <form onSubmit={addTeam} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-slate-300">NOMBRE<input name="name" required placeholder="Senior A" className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3" /><Help>Nombre del equipo del club al que pertenece esta plantilla.</Help></label>
            <label className="text-xs font-bold text-slate-300">NOMBRE CORTO · OPCIONAL<input name="shortName" placeholder="SEN A" className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3" /><Help>Referencia breve para espacios compactos.</Help></label>
            <button type="submit" className="min-h-12 rounded-xl bg-emerald-400 font-black text-slate-950 sm:col-span-2">CREAR EQUIPO</button>
          </form>
        </details>
      </section>

      <section className="rounded-3xl border border-slate-700 bg-slate-800 p-5">
        <p className="text-xs font-black uppercase tracking-wider text-amber-300">Temporadas</p><h2 className="mt-1 text-xl font-black">{teams.find((team) => team.teamId === selectedTeamId)?.name ?? "Selecciona un equipo"}</h2>
        <div className="mt-4 space-y-2">
          {teamSeasons.map((season) => {
            const impact = calculateDeletionImpact(workspace, "SEASON", season.seasonId, matches);
            return <div key={season.seasonId} className={`flex min-h-16 items-center justify-between gap-3 rounded-2xl border px-4 ${season.archivedAt ? "border-slate-700 bg-slate-950/60 opacity-70" : season.current ? "border-amber-400 bg-amber-950/40" : "border-slate-700 bg-slate-900"}`}>
              <div><p className="font-black">{season.label}</p><p className="text-xs text-slate-500">{season.startDate || "Sin inicio"} → {season.endDate || "Sin fin"}{season.archivedAt ? " · ARCHIVADA" : ""}</p></div>
              <div className="flex items-center gap-2">{season.current && !season.archivedAt ? <span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-black text-slate-950">ACTUAL</span> : !season.archivedAt ? <button type="button" onClick={() => setCurrentSeason(CDA_CLUB_ID, season.seasonId)} className="min-h-11 rounded-xl bg-slate-700 px-3 text-xs font-black">HACER ACTUAL</button> : null}<AdminEntityActions label={`temporada ${season.label}`} archived={Boolean(season.archivedAt)} impact={`${impactSummary(impact)}. Plantillas, partidos y eventos históricos no se purgarán.`} onArchive={() => changeLifecycle(CDA_CLUB_ID, "SEASON", season.seasonId, "ARCHIVE")} onReactivate={() => changeLifecycle(CDA_CLUB_ID, "SEASON", season.seasonId, "REACTIVATE")} onDelete={() => changeLifecycle(CDA_CLUB_ID, "SEASON", season.seasonId, "DELETE")} /></div>
            </div>;
          })}
          {selectedTeamId && teamSeasons.length === 0 && <p className="rounded-2xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-400">Este equipo todavía no tiene temporadas.</p>}
        </div>
        {selectedTeamId && <details className="mt-4 rounded-2xl bg-slate-950 p-4"><summary className="min-h-11 cursor-pointer text-sm font-black text-amber-300">+ CREAR TEMPORADA</summary>
          <form onSubmit={addSeason} className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-bold text-slate-300">TEMPORADA<input name="label" required placeholder="2026-27" className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3" /><Help>Periodo deportivo al que pertenecerán plantilla y partidos.</Help></label>
            <label className="text-xs font-bold text-slate-300">INICIO · OPCIONAL<input name="startDate" type="date" className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3" /></label>
            <label className="text-xs font-bold text-slate-300">FIN · OPCIONAL<input name="endDate" type="date" className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3" /></label>
            {copyCandidates.length > 0 && <label className="text-xs font-bold text-slate-300 sm:col-span-3">COPIAR PLANTILLA · OPCIONAL<select value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3"><option value="">Empezar vacía</option>{copyCandidates.map((season) => <option key={season.seasonId} value={season.seasonId}>{season.label}</option>)}</select><Help>Copia membresías; mantiene las mismas identidades de persona.</Help></label>}
            <button type="submit" className="min-h-12 rounded-xl bg-amber-400 font-black text-slate-950 sm:col-span-3">CREAR TEMPORADA</button>
          </form>
        </details>}
      </section>
      {error && <p role="alert" className="rounded-xl bg-red-950 p-3 text-red-200">{error}</p>}
    </main>
    {editingTeamId && (() => { const team = workspace.teams.find((item) => item.teamId === editingTeamId); if (!team) return null; return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4"><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); updateRealTeam(CDA_CLUB_ID, team.teamId, { name: String(data.get("name") ?? ""), shortName: String(data.get("shortName") ?? "") }); setEditingTeamId(null); }} className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-5"><h2 className="text-xl font-black">Editar equipo</h2><label className="mt-4 block text-xs font-bold text-slate-300">NOMBRE<input name="name" defaultValue={team.name} required className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3" /></label><label className="mt-3 block text-xs font-bold text-slate-300">NOMBRE CORTO<input name="shortName" defaultValue={team.shortName} className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3" /></label><div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={() => setEditingTeamId(null)} className="min-h-12 rounded-xl bg-slate-700 font-black">CANCELAR</button><button type="submit" className="min-h-12 rounded-xl bg-cyan-400 font-black text-slate-950">GUARDAR</button></div></form></div>; })()}
  </div>;
}
