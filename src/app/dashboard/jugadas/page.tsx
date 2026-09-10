"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AppHeader } from "../../../components/app/AppHeader";
import { VideoStatusLink, videoResolutionLabel } from "../../../components/video/VideoStatusLink";
import { buildDashboardFixture, DASHBOARD_FIXTURE_CLUB_ID, DASHBOARD_FIXTURE_SEASON_ID, DASHBOARD_FIXTURE_TEAM_ID } from "../../../lib/dashboardFixture";
import { DashboardMatchRecord } from "../../../lib/dashboardAnalytics";
import { emptyDashboardScope, scopeFromSearchParams } from "../../../lib/dashboardV2";
import { eventDescription } from "../../../lib/eventPresentation";
import { listMatchCatalog } from "../../../lib/matchCatalog";
import { revisionEventHref } from "../../../lib/dashboardNavigation";
import { loadMatchSession } from "../../../lib/matchPersistence";
import { buildVideoReviewRows, buildWhatsAppVideoText, VideoReviewKind } from "../../../lib/videoReview";
import { useTeamStore } from "../../../store/useTeamStore";

function localRecords(): DashboardMatchRecord[] {
  return listMatchCatalog().flatMap((catalog) => { const session = loadMatchSession(catalog.matchId); return session ? [{ catalog, session }] : []; });
}

const KIND_LABEL: Record<VideoReviewKind, string> = { ALL: "TODAS", GOALS: "GOLES CDA", SAVES: "PARADAS", LOSSES: "PÉRDIDAS" };

function VideoReviewContent() {
  const searchParams = useSearchParams();
  const fixture = searchParams.get("fixture") === "1";
  const currentClubId = useTeamStore((state) => state.currentClubId);
  const [records, setRecords] = useState<DashboardMatchRecord[]>([]);
  const [kind, setKind] = useState<VideoReviewKind>("ALL");
  const [actorId, setActorId] = useState("");
  const [copied, setCopied] = useState(false);
  const [fallbackText, setFallbackText] = useState("");
  useEffect(() => setRecords(fixture ? buildDashboardFixture() : localRecords()), [fixture]);
  const first = records[0]?.catalog;
  const fallback = useMemo(() => emptyDashboardScope(
    fixture ? DASHBOARD_FIXTURE_CLUB_ID : first?.clubId ?? currentClubId,
    fixture ? DASHBOARD_FIXTURE_TEAM_ID : first?.teamId ?? "",
    fixture ? DASHBOARD_FIXTURE_SEASON_ID : first?.seasonId ?? "",
  ), [currentClubId, first?.clubId, first?.seasonId, first?.teamId, fixture]);
  const scope = useMemo(() => scopeFromSearchParams(new URLSearchParams(searchParams.toString()), "a", fallback), [fallback, searchParams]);
  const rows = useMemo(() => buildVideoReviewRows(records, scope, kind, actorId || undefined), [actorId, kind, records, scope]);
  const actors = useMemo(() => {
    const map = new Map<string, string>();
    for (const record of records) for (const player of record.session.players) map.set(player.id, `#${player.number} ${player.name}`);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [records]);
  const query = searchParams.toString();
  const title = `${KIND_LABEL[kind]}${actorId ? ` · ${actors.find(([id]) => id === actorId)?.[1] ?? actorId}` : ""}`;
  async function copyLinks() {
    const text = buildWhatsAppVideoText(title, rows);
    try { await navigator.clipboard.writeText(text); setCopied(true); setFallbackText(""); }
    catch { setFallbackText(text); setCopied(false); }
  }
  return <div className="min-h-screen overflow-x-clip bg-slate-950 text-white"><AppHeader title="Revisión de jugadas" clubId={fixture ? undefined : scope.clubId}/><main className="mx-auto max-w-6xl space-y-4 p-3 pb-16 sm:p-5">
    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black tracking-widest text-red-300">ÍNDICE DE VÍDEO · MISMO SCOPE DEL DASHBOARD</p><h2 className="mt-1 text-2xl font-black">Localiza, abre y comparte jugadas</h2><p className="mt-1 text-xs text-slate-400">Los enlaces se calculan al instante; ningún evento almacena una URL de vídeo.</p></div><Link href={`/dashboard?${query}`} className="inline-grid min-h-11 place-items-center rounded-xl bg-slate-800 px-4 text-xs font-black">← DASHBOARD</Link></div></section>
    <section className="grid gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-3 sm:grid-cols-[1fr_14rem_auto]">
      <div className="flex gap-2 overflow-x-auto">{(Object.keys(KIND_LABEL) as VideoReviewKind[]).map((value) => <button key={value} type="button" onClick={() => { setKind(value); setActorId(""); }} className={`min-h-11 shrink-0 rounded-xl px-4 text-xs font-black ${kind === value ? "bg-cyan-300 text-slate-950" : "bg-slate-800 text-slate-400"}`}>{KIND_LABEL[value]}</button>)}</div>
      <select aria-label="Filtrar persona" value={actorId} onChange={(event) => setActorId(event.target.value)} disabled={kind === "ALL"} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black disabled:opacity-40"><option value="">TODAS LAS PERSONAS</option>{actors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <button type="button" onClick={copyLinks} disabled={rows.length === 0} className="min-h-11 rounded-xl bg-emerald-400 px-4 text-xs font-black text-slate-950 disabled:opacity-35">{copied ? "✓ COPIADO" : "COPIAR PARA WHATSAPP"}</button>
      {fallbackText && <label className="text-[10px] font-black text-amber-300 sm:col-span-3">COPIA MANUAL<textarea readOnly value={fallbackText} onFocus={(event) => event.currentTarget.select()} className="mt-1 h-36 w-full rounded-xl bg-slate-950 p-3 text-xs text-white"/></label>}
    </section>
    <p className="text-xs text-slate-500">{rows.length} jugadas · {rows.filter((row) => row.resolution.status === "RESOLVED").length} con enlace</p>
    <div className="space-y-2">{rows.map(({ record, event, resolution }) => <article key={`${record.catalog.matchId}:${event.id}`} className="grid gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-3 sm:grid-cols-[8rem_1fr_auto] sm:items-center"><div><p className="text-[10px] font-black text-cyan-300">{record.catalog.date}</p><p className="truncate text-xs font-bold">{record.catalog.opponent}</p></div><div className="min-w-0"><p className="text-[10px] font-black text-slate-500">P{event.period} · min {event.minute} · order {event.order}</p><p className="truncate text-sm font-bold">{eventDescription(event, record.session.players)}</p><p className="mt-0.5 text-[9px] text-slate-500">{resolution.status === "RESOLVED" ? `${resolution.quality.replaceAll("_", " ")} · abre −${resolution.leadSeconds}s` : videoResolutionLabel(resolution.status)}</p></div><div className="flex items-center gap-2"><VideoStatusLink session={record.session} eventId={event.id}/><Link href={revisionEventHref(record.catalog.matchId, event.id, `/dashboard/jugadas?${query}`, fixture)} className="inline-grid min-h-10 place-items-center rounded-xl bg-slate-800 px-3 text-[10px] font-black">VER EVENTO</Link>{fixture ? <span className="inline-grid min-h-10 place-items-center rounded-xl bg-slate-800 px-3 text-[10px] font-black text-slate-500">FIXTURE</span> : <Link href={`/partidos/${record.catalog.matchId}/video`} className="inline-grid min-h-10 place-items-center rounded-xl bg-slate-800 px-3 text-[10px] font-black">AJUSTAR</Link>}</div></article>)}</div>
    {rows.length === 0 && <section className="rounded-3xl border border-dashed border-slate-700 p-10 text-center text-slate-400">No hay jugadas para esta intersección de filtros.</section>}
  </main></div>;
}

export default function VideoReviewPage() {
  return <Suspense fallback={<div className="min-h-screen bg-slate-950 p-10 text-center text-slate-500">Preparando jugadas…</div>}><VideoReviewContent /></Suspense>;
}
