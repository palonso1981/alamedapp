"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "../../components/app/AppHeader";
import { AdminEntityActions } from "../../components/admin/AdminEntityActions";
import { changeStoredMatchLifecycle } from "../../lib/adminMatchService";
import { listMatchCatalog, MatchCatalogEntry, visibleMatchCatalog } from "../../lib/matchCatalog";
import { currentSeason } from "../../lib/seasonDomain";
import { useTeamStore } from "../../store/useTeamStore";
import { CDA_TEAM_ID } from "../../types";

const STATUS_LABEL: Record<MatchCatalogEntry["status"], string> = { DRAFT: "PREPARAR", READY: "LISTO", LIVE: "EN CURSO", FINISHED: "FINALIZADO" };

export default function MatchesPage() {
  const [matches, setMatches] = useState<MatchCatalogEntry[]>([]);
  const workspace = useTeamStore((state) => state.teams[CDA_TEAM_ID]);
  const ensureTeam = useTeamStore((state) => state.ensureTeam);
  const [seasonId, setSeasonId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { ensureTeam(CDA_TEAM_ID); setMatches(listMatchCatalog()); }, [ensureTeam]);
  useEffect(() => { if (workspace && !seasonId) setSeasonId(currentSeason(workspace)?.seasonId ?? "ALL"); }, [seasonId, workspace]);
  const visible = useMemo(() => visibleMatchCatalog(matches, showArchived).filter((match) => seasonId === "ALL" ? true : seasonId === "LEGACY" ? !match.seasonId : match.seasonId === seasonId), [matches, seasonId, showArchived]);
  function lifecycle(matchId: string, action: "ARCHIVE" | "REACTIVATE" | "DELETE") {
    const result = changeStoredMatchLifecycle(matchId, action);
    setMessage(result.ok ? null : result.message);
    setMatches(listMatchCatalog());
  }
  return <div className="min-h-screen bg-slate-900 text-white"><AppHeader title="Partidos" actions={<Link href="/partidos/nuevo" className="min-h-10 rounded-lg bg-amber-400 px-4 py-2.5 font-black text-slate-950">+ PARTIDO</Link>} /><main className="mx-auto max-w-5xl p-4 sm:p-6"><div className="space-y-3">
    <div className="flex flex-wrap gap-2"><label className="flex min-h-14 flex-1 items-center justify-between rounded-2xl border border-slate-700 bg-slate-800 px-4 text-xs font-black text-slate-400">TEMPORADA<select value={seasonId} onChange={(event) => setSeasonId(event.target.value)} className="min-h-11 rounded-xl bg-slate-950 px-3 text-white"><option value="ALL">TODAS</option>{workspace?.seasons.filter((season) => !season.deletedAt).map((season) => <option key={season.seasonId} value={season.seasonId}>{season.label}{season.current ? " · ACTUAL" : ""}</option>)}<option value="LEGACY">LEGACY · SIN ASIGNAR</option></select></label><label className="flex min-h-14 items-center gap-2 rounded-2xl border border-slate-700 bg-slate-800 px-4 text-xs font-black text-slate-300"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="h-5 w-5" />Mostrar archivados</label></div>
    {visible.map((match) => { const href = match.status === "FINISHED" ? `/partido/${match.matchId}/revision` : match.status === "LIVE" ? `/partido/${match.matchId}/directo` : `/partido/${match.matchId}/prepartido`; const season = workspace?.seasons.find((item) => item.seasonId === match.seasonId); return <div key={match.matchId} className={`flex min-h-24 items-center gap-2 rounded-2xl border border-slate-700 bg-slate-800 p-3 ${match.archivedAt ? "opacity-65" : ""}`}><Link href={href} className="flex min-w-0 flex-1 items-center justify-between gap-4 rounded-xl p-1 hover:text-amber-300"><span><span className="block text-xs font-bold text-slate-400">{match.date}{match.time ? ` · ${match.time}` : ""} · {match.venue === "HOME" ? "LOCAL" : "VISITANTE"} · {season?.label ?? "SIN TEMPORADA"}{match.archivedAt ? " · ARCHIVADO" : ""}</span><span className="mt-1 block truncate text-xl font-black">{match.opponent}</span></span><span className={`rounded-xl px-3 py-2 text-xs font-black ${match.status === "LIVE" ? "bg-red-950 text-red-300" : match.status === "READY" ? "bg-emerald-950 text-emerald-300" : "bg-slate-950 text-slate-300"}`}>{STATUS_LABEL[match.status]} →</span></Link><AdminEntityActions label={`partido contra ${match.opponent}`} archived={Boolean(match.archivedAt)} impact={`Este partido contiene ${match.eventCount ?? 0} eventos. Al eliminarlo dejará de aparecer en el histórico, pero sus datos se conservarán como tombstone para no romper sincronización ni referencias.`} onArchive={() => lifecycle(match.matchId, "ARCHIVE")} onReactivate={() => lifecycle(match.matchId, "REACTIVATE")} onDelete={() => lifecycle(match.matchId, "DELETE")} /></div>; })}
    {message && <p role="alert" className="rounded-xl bg-red-950 p-3 text-red-200">{message}</p>}
    {visible.length === 0 && <div className="rounded-3xl border border-dashed border-slate-700 p-10 text-center"><p className="text-slate-400">No hay partidos en esta temporada.</p><Link href="/partidos/nuevo" className="mt-5 inline-grid min-h-12 place-items-center rounded-xl bg-amber-400 px-6 font-black text-slate-950">CREAR PARTIDO</Link></div>}
  </div></main></div>;
}
