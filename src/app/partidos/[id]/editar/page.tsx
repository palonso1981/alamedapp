"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { AppHeader } from "../../../../components/app/AppHeader";
import { SyncStatusBadge } from "../../../../components/match/SyncStatusBadge";
import { updateStoredMatchMetadata } from "../../../../lib/matchMetadata";
import { browserMatchRepository } from "../../../../lib/sync/localMatchRepository";
import { useTeamStore } from "../../../../store/useTeamStore";
import { CDA_CLUB_ID, CompetitionType, MatchSession } from "../../../../types";

type CompetitionChoice = CompetitionType | "UNSPECIFIED";

export default function EditMatchPage() {
  const { id: matchId } = useParams<{ id: string }>();
  const router = useRouter();
  const ensureRegistry = useTeamStore((state) => state.ensureRegistry);
  const ensureTeam = useTeamStore((state) => state.ensureTeam);
  const workspaces = useTeamStore((state) => state.teams);
  const [session, setSession] = useState<MatchSession | null>(null);
  const [competitionType, setCompetitionType] = useState<CompetitionChoice>("UNSPECIFIED");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureRegistry();
    const loaded = browserMatchRepository.load(matchId);
    setSession(loaded);
    setCompetitionType(loaded?.preparation?.competitionType ?? "UNSPECIFIED");
  }, [ensureRegistry, matchId]);
  const clubId = session?.preparation ? session.preparation.clubId ?? CDA_CLUB_ID : undefined;
  useEffect(() => { if (clubId) ensureTeam(clubId); }, [clubId, ensureTeam]);
  const workspace = clubId ? workspaces[clubId] : undefined;
  const preparation = session?.preparation;
  const team = useMemo(() => {
    if (!workspace || !preparation) return undefined;
    return workspace.teams.find((item) => item.teamId === preparation.teamId)
      ?? (workspace.teamId === preparation.teamId ? workspace.team : undefined);
  }, [preparation, workspace]);
  const seasons = useMemo(() => workspace?.seasons.filter((season) =>
    season.teamId === preparation?.teamId && !season.deletedAt,
  ).sort((a, b) => b.label.localeCompare(a.label)) ?? [], [preparation?.teamId, workspace]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !preparation) return;
    const data = new FormData(event.currentTarget);
    const result = updateStoredMatchMetadata(matchId, workspace, {
      seasonId: String(data.get("seasonId") ?? "") || undefined,
      opponent: String(data.get("opponent") ?? ""),
      venue: String(data.get("venue")) === "AWAY" ? "AWAY" : "HOME",
      date: String(data.get("date") ?? ""),
      time: String(data.get("time") ?? ""),
      competitionType: competitionType === "UNSPECIFIED" ? null : competitionType,
      competitionOtherDetail: String(data.get("competitionOtherDetail") ?? ""),
      competition: String(data.get("competition") ?? ""),
      matchday: String(data.get("matchday") ?? "") ? Number(data.get("matchday")) : null,
      opponentCategory: String(data.get("opponentCategory") ?? ""),
    });
    if (!result.ok) { setError(result.message); return; }
    router.push("/partidos");
  }

  if (!session || !preparation) return <div className="grid min-h-screen place-items-center bg-slate-900 p-6 text-center text-white"><div><p>{session ? "El partido no tiene preparación asociada." : "El partido no existe en este dispositivo."}</p><Link href="/partidos" className="mt-4 inline-grid min-h-12 place-items-center rounded-xl bg-slate-700 px-5 font-black">VOLVER A PARTIDOS</Link></div></div>;
  if (!workspace) return <div className="grid min-h-screen place-items-center bg-slate-900 text-white">Cargando club…</div>;

  return <div className="min-h-screen bg-slate-900 text-white">
    <AppHeader title="Editar partido" actions={<SyncStatusBadge matchId={matchId} />} />
    <main className="mx-auto max-w-2xl p-4 sm:p-7">
      <form onSubmit={submit} className="space-y-5 rounded-3xl border border-slate-700 bg-slate-800 p-5 sm:p-7">
        <div><p className="text-xs font-black uppercase tracking-wider text-cyan-300">Mismo partido · {preparation.status}</p><h1 className="mt-1 text-2xl font-black">{preparation.opponent}</h1><p className="mt-1 text-xs text-slate-400">{team?.name ?? "Equipo"} · {session.events.length} eventos intactos</p></div>
        <label className="block text-sm font-bold text-slate-300">Temporada<select name="seasonId" required={Boolean(preparation.seasonId)} defaultValue={preparation.seasonId ?? ""} className="mt-1 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-950 px-3"><option value="">Sin asignar · legacy</option>{seasons.map((season) => <option key={season.seasonId} value={season.seasonId}>{season.label}{season.category ? ` · ${season.category}` : ""}{season.archivedAt ? " · archivada" : ""}</option>)}</select><span className="mt-1 block text-[11px] font-normal text-slate-500">Solo temporadas del equipo original. El equipo y el identificador del partido no cambian.</span></label>
        <label className="block text-sm font-bold text-slate-300">Rival<input name="opponent" required autoFocus defaultValue={preparation.opponent} className="mt-1 min-h-14 w-full rounded-xl border border-slate-600 bg-slate-950 px-4 text-lg font-bold" /></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm font-bold text-slate-300">Fecha<input name="date" type="date" required defaultValue={preparation.date} className="mt-1 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-950 px-3" /></label><label className="text-sm font-bold text-slate-300">Hora<input name="time" type="time" defaultValue={preparation.time} className="mt-1 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-950 px-3" /></label></div>
        <fieldset><legend className="text-sm font-bold text-slate-300">Sede CDA</legend><div className="mt-1 grid grid-cols-2 gap-2"><label className="grid min-h-12 cursor-pointer place-items-center rounded-xl bg-slate-950 has-[:checked]:bg-cyan-400 has-[:checked]:text-slate-950"><input type="radio" name="venue" value="HOME" defaultChecked={preparation.venue === "HOME"} className="sr-only" />LOCAL</label><label className="grid min-h-12 cursor-pointer place-items-center rounded-xl bg-slate-950 has-[:checked]:bg-cyan-400 has-[:checked]:text-slate-950"><input type="radio" name="venue" value="AWAY" defaultChecked={preparation.venue === "AWAY"} className="sr-only" />VISITANTE</label></div></fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold text-slate-400">Tipo<select aria-label="Tipo de competición" value={competitionType} onChange={(event) => setCompetitionType(event.target.value as CompetitionChoice)} className="mt-1 min-h-12 w-full rounded-xl bg-slate-950 px-3 text-white"><option value="UNSPECIFIED">Sin clasificar</option><option value="LEAGUE">Liga</option><option value="CUP">Copa</option><option value="FRIENDLY">Amistoso</option><option value="OTHER">Otra</option></select></label>
          {competitionType === "OTHER" && <label className="text-xs font-bold text-slate-400">Detalle<input name="competitionOtherDetail" defaultValue={preparation.competitionOtherDetail} className="mt-1 min-h-12 w-full rounded-xl bg-slate-950 px-3" /></label>}
          <label className="text-xs font-bold text-slate-400">Competición<input name="competition" defaultValue={preparation.competition} placeholder="Preferente Futsal" className="mt-1 min-h-12 w-full rounded-xl bg-slate-950 px-3" /></label>
          <label className="text-xs font-bold text-slate-400">Jornada · opcional<input name="matchday" type="number" min="1" step="1" inputMode="numeric" defaultValue={preparation.matchday} className="mt-1 min-h-12 w-full rounded-xl bg-slate-950 px-3" /></label>
          <label className="text-xs font-bold text-slate-400 sm:col-span-2">Categoría rival · opcional<input name="opponentCategory" defaultValue={preparation.opponentCategory} placeholder="Juvenil Preferente" className="mt-1 min-h-12 w-full rounded-xl bg-slate-950 px-3" /></label>
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-950 p-3 text-sm text-red-200">{error}</p>}
        <div className="grid grid-cols-2 gap-3"><Link href="/partidos" className="grid min-h-12 place-items-center rounded-xl bg-slate-700 font-black">CANCELAR</Link><button type="submit" className="min-h-12 rounded-xl bg-cyan-400 px-3 font-black text-slate-950">GUARDAR CAMBIOS</button></div>
        <p className="text-center text-[11px] text-slate-500">Marcador, cronología, coordenadas y horas de captura no se editan aquí.</p>
      </form>
    </main>
  </div>;
}
