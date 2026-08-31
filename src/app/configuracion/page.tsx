"use client";

import { FormEvent, useEffect, useState } from "react";

import { AppHeader } from "../../components/app/AppHeader";
import { TeamSyncStatusBadge } from "../../components/team/TeamSyncStatusBadge";
import { useTeamStore } from "../../store/useTeamStore";
import { CDA_TEAM_ID } from "../../types";

export default function ConfigurationPage() {
  const workspace = useTeamStore((state) => state.teams[CDA_TEAM_ID]);
  const error = useTeamStore((state) => state.errors[CDA_TEAM_ID]);
  const ensureTeam = useTeamStore((state) => state.ensureTeam);
  const updateTeam = useTeamStore((state) => state.updateTeam);
  const createSeason = useTeamStore((state) => state.createSeason);
  const setCurrentSeason = useTeamStore((state) => state.setCurrentSeason);
  const [copyFrom, setCopyFrom] = useState("");

  useEffect(() => ensureTeam(CDA_TEAM_ID), [ensureTeam]);

  function saveTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    updateTeam(CDA_TEAM_ID, {
      name: String(data.get("name") ?? ""),
      shortName: String(data.get("shortName") ?? ""),
      category: String(data.get("category") ?? ""),
    });
  }

  function addSeason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const seasonId = createSeason(CDA_TEAM_ID, {
      label: String(data.get("label") ?? ""),
      startDate: String(data.get("startDate") ?? ""),
      endDate: String(data.get("endDate") ?? ""),
      copyFromSeasonId: copyFrom || undefined,
      copyLegacyRoster: String(data.get("copyLegacyRoster")) === "true",
    });
    if (seasonId) {
      form.reset();
      setCopyFrom("");
    }
  }

  if (!workspace) {
    return <div className="grid min-h-screen place-items-center bg-slate-900 text-white">Cargando equipo…</div>;
  }

  const seasons = [...workspace.seasons].sort((a, b) => b.label.localeCompare(a.label));
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <AppHeader title="Configuración" actions={<TeamSyncStatusBadge teamId={CDA_TEAM_ID} />} />
      <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
        <form onSubmit={saveTeam} className="rounded-3xl border border-slate-700 bg-slate-800 p-5">
          <p className="text-xs font-black uppercase tracking-wider text-cyan-300">Equipo</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-bold text-slate-400">Nombre<input name="name" required defaultValue={workspace.team.name} className="mt-1 min-h-12 w-full rounded-xl bg-slate-950 px-3 text-white" /></label>
            <label className="text-xs font-bold text-slate-400">Nombre corto<input name="shortName" required defaultValue={workspace.team.shortName} className="mt-1 min-h-12 w-full rounded-xl bg-slate-950 px-3 text-white" /></label>
            <label className="text-xs font-bold text-slate-400">Categoría<input name="category" defaultValue={workspace.team.category} className="mt-1 min-h-12 w-full rounded-xl bg-slate-950 px-3 text-white" /></label>
          </div>
          <button type="submit" className="mt-4 min-h-12 rounded-xl bg-cyan-400 px-5 font-black text-slate-950">GUARDAR EQUIPO</button>
        </form>

        <section className="rounded-3xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-xs font-black uppercase tracking-wider text-amber-300">Temporadas</p><h2 className="mt-1 text-2xl font-black">{seasons.length} configuradas</h2></div>
            <span className="rounded-full bg-slate-950 px-3 py-2 text-xs font-bold text-slate-400">IDs estables · plantilla no duplicada</span>
          </div>
          <div className="mt-4 space-y-2">
            {seasons.map((season) => (
              <div key={season.seasonId} className={`flex min-h-16 items-center justify-between gap-3 rounded-2xl border px-4 ${season.current ? "border-amber-400 bg-amber-950/50" : "border-slate-700 bg-slate-900"}`}>
                <div><p className="font-black">{season.label}</p><p className="text-xs text-slate-500">{season.startDate || "Sin inicio"} → {season.endDate || "Sin fin"}</p></div>
                {season.current ? <span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-black text-slate-950">ACTUAL</span> : <button type="button" onClick={() => setCurrentSeason(CDA_TEAM_ID, season.seasonId)} className="min-h-11 rounded-xl bg-slate-700 px-4 text-xs font-black">HACER ACTUAL</button>}
              </div>
            ))}
            {seasons.length === 0 && <p className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-slate-400">No hay temporada actual. Créala sin asumir ningún nombre.</p>}
          </div>

          <form onSubmit={addSeason} className="mt-5 rounded-2xl bg-slate-950 p-4">
            <p className="text-sm font-black">CREAR TEMPORADA</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-bold text-slate-400">Nombre<input name="label" required placeholder="2026-27" className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-white" /></label>
              <label className="text-xs font-bold text-slate-400">Inicio opcional<input name="startDate" type="date" className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-white" /></label>
              <label className="text-xs font-bold text-slate-400">Fin opcional<input name="endDate" type="date" className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-white" /></label>
            </div>
            {seasons.length > 0 ? (
              <label className="mt-3 block text-xs font-bold text-slate-400">Copiar plantilla de<select value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-white"><option value="">Empezar vacía</option>{seasons.map((season) => <option key={season.seasonId} value={season.seasonId}>{season.label}</option>)}</select></label>
            ) : workspace.players.length + workspace.staff.length > 0 ? (
              <label className="mt-3 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl bg-slate-800 px-3 text-sm font-bold"><input name="copyLegacyRoster" type="checkbox" value="true" className="h-5 w-5" />Copiar la plantilla legacy actual</label>
            ) : null}
            <button type="submit" className="mt-3 min-h-12 w-full rounded-xl bg-amber-400 font-black text-slate-950">CREAR TEMPORADA</button>
          </form>
        </section>
        {error && <p role="alert" className="rounded-xl bg-red-950 p-3 text-red-200">{error}</p>}
      </main>
    </div>
  );
}
