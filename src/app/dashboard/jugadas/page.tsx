"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useAccess } from "../../../components/access/AccessProvider";
import { AppHeader } from "../../../components/app/AppHeader";
import { VideoStatusLink, videoResolutionLabel } from "../../../components/video/VideoStatusLink";
import { buildDashboardFixture, DASHBOARD_FIXTURE_CLUB_ID, DASHBOARD_FIXTURE_SEASON_ID, DASHBOARD_FIXTURE_TEAM_ID } from "../../../lib/dashboardFixture";
import { DashboardMatchRecord } from "../../../lib/dashboardAnalytics";
import { emptyDashboardScope, scopeFromSearchParams } from "../../../lib/dashboardV2";
import { eventDescription } from "../../../lib/eventPresentation";
import { withCurrentPlayerIdentity } from "../../../lib/dashboardIdentity";
import { listMatchCatalog } from "../../../lib/matchCatalog";
import { revisionEventHref } from "../../../lib/dashboardNavigation";
import { loadMatchSession } from "../../../lib/matchPersistence";
import { buildVideoReviewRows, buildWhatsAppVideoText, VideoReviewKind, VideoReviewRow } from "../../../lib/videoReview";
import { buildYouTubeWatchAtUrl, compatibleVideoSegments, formatVideoTimestamp, parseVideoTimestamp, removeVideoEventOverride, resolveEventVideoPosition, upsertVideoEventOverride } from "../../../lib/videoIndex";
import { useMatchStore } from "../../../store/useMatchStore";
import { useTeamStore } from "../../../store/useTeamStore";

function localRecords(): DashboardMatchRecord[] {
  return listMatchCatalog().flatMap((catalog) => { const session = loadMatchSession(catalog.matchId); return session ? [{ catalog, session }] : []; });
}

const KIND_LABEL: Record<VideoReviewKind, string> = { ALL: "TODAS LAS JUGADAS", GOALS: "GOLES CDA", SHOTS_FOR: "REMATES CDA", THREATS_AGAINST: "AMENAZAS RIV", SAVES: "PARADAS", LOSSES: "PÉRDIDAS", CORNERS_FOR: "CÓRNER CDA", CORNERS_AGAINST: "CÓRNER RIV", KICK_INS_FOR: "BANDA CDA", KICK_INS_AGAINST: "BANDA RIV", FOULS: "FALTAS", CARDS: "TARJETAS" };

function rowKey(row: VideoReviewRow): string { return `${row.record.catalog.matchId}:${row.event.id}`; }

function VideoAdjustment({ row, onClose, onChanged, readOnlyFixture = false }: { row: VideoReviewRow; onClose(): void; onChanged(): void; readOnlyFixture?: boolean }) {
  const setOverrides = useMatchStore((state) => state.setVideoEventOverrides);
  const currentOverride = row.record.session.videoEventOverrides?.find((item) => item.eventId === row.event.id);
  const segments = compatibleVideoSegments(row.record.session, row.event);
  const automatic = resolveEventVideoPosition(removeVideoEventOverride(row.record.session, row.event.id), row.event.id);
  const [segmentId, setSegmentId] = useState(currentOverride?.segmentId ?? (automatic.status !== "NO_VIDEO" ? automatic.segmentId : segments[0]?.id ?? ""));
  const [timestamp, setTimestamp] = useState(formatVideoTimestamp(currentOverride?.videoSecond ?? (automatic.status === "RESOLVED" ? automatic.estimatedSecond : 0)));
  const [message, setMessage] = useState("");
  const second = parseVideoTimestamp(timestamp);
  const segment = segments.find((item) => item.id === segmentId);
  const testUrl = second !== null && segment ? buildYouTubeWatchAtUrl(segment.videoId, Math.max(0, second - segment.leadSeconds)) : null;

  function persist(next: ReturnType<typeof upsertVideoEventOverride>) {
    useMatchStore.getState().ensureMatch(row.record.catalog.matchId);
    setOverrides(row.record.catalog.matchId, next.videoEventOverrides ?? []);
    onChanged(); onClose();
  }
  function save() {
    if (readOnlyFixture) return;
    if (second === null || !segmentId) { setMessage("Escribe una posición válida, por ejemplo 0:17, 07:51 o 1:02:15."); return; }
    persist(upsertVideoEventOverride(row.record.session, { eventId: row.event.id, segmentId, videoSecond: second }));
  }
  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/90 p-4"><section className="w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-5"><p className="text-[10px] font-black tracking-widest text-red-300">AJUSTE DE ESTA JUGADA</p><h2 className="mt-1 text-xl font-black">P{row.event.period} · min {row.event.minute}</h2><p className="mt-3 text-xs text-slate-400">Posición calculada: <strong className="text-white">{automatic.status === "RESOLVED" ? `~${formatVideoTimestamp(automatic.estimatedSecond)}` : "SIN POSICIÓN"}</strong></p>{segments.length > 1 && <label className="mt-4 block text-[10px] font-black text-slate-400">SEGMENTO<select value={segmentId} onChange={(event) => setSegmentId(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl bg-slate-950 px-3 text-sm">{segments.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}<label className="mt-4 block text-[10px] font-black text-slate-400">POSICIÓN REAL EN YOUTUBE<input autoFocus value={timestamp} onChange={(event) => setTimestamp(event.target.value)} placeholder="00:17" className="mt-1 min-h-14 w-full rounded-xl bg-slate-950 px-4 text-center font-mono text-xl font-black"/></label><p className="mt-2 text-xs text-slate-500">Se guarda el instante real. El enlace abrirá {segment?.leadSeconds ?? 0}s antes.</p>{readOnlyFixture && <p className="mt-2 text-xs font-bold text-amber-300">Vista de validación: no guarda cambios.</p>}{message && <p role="alert" className="mt-3 text-sm text-amber-300">{message}</p>}<div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={onClose} className="min-h-12 rounded-xl bg-slate-800 text-xs font-black">CANCELAR</button><a href={testUrl ?? undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!testUrl} className={`grid min-h-12 place-items-center rounded-xl text-xs font-black ${testUrl ? "bg-red-950 text-red-200" : "pointer-events-none bg-slate-800 text-slate-600"}`}>▶ PROBAR</a><button type="button" onClick={save} disabled={readOnlyFixture || second === null || !segmentId} className="min-h-12 rounded-xl bg-cyan-300 text-xs font-black text-slate-950 disabled:opacity-35">GUARDAR AJUSTE</button>{currentOverride && <button type="button" onClick={() => { if (!readOnlyFixture) persist(removeVideoEventOverride(row.record.session, row.event.id)); }} disabled={readOnlyFixture} className="min-h-12 rounded-xl bg-amber-950 text-xs font-black text-amber-200 disabled:opacity-35">VOLVER A AUTOMÁTICO</button>}</div></section></div>;
}

function VideoReviewContent() {
  const searchParams = useSearchParams();
  const fixture = searchParams.get("fixture") === "1";
  const { canWrite } = useAccess();
  const currentClubId = useTeamStore((state) => state.currentClubId);
  const workspace = useTeamStore((state) => state.teams[state.currentClubId]);
  const [records, setRecords] = useState<DashboardMatchRecord[]>([]);
  const [kind, setKind] = useState<VideoReviewKind>("ALL");
  const [actorId, setActorId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adjusting, setAdjusting] = useState<VideoReviewRow | null>(null);
  const [copied, setCopied] = useState("");
  const [fallbackText, setFallbackText] = useState("");
  useEffect(() => setRecords(fixture ? buildDashboardFixture() : localRecords()), [fixture]);
  const resolvedRecords = useMemo(
    () => fixture ? records : withCurrentPlayerIdentity(records, workspace?.players ?? []),
    [fixture, records, workspace?.players],
  );
  const first = resolvedRecords[0]?.catalog;
  const fallback = useMemo(() => emptyDashboardScope(
    fixture ? DASHBOARD_FIXTURE_CLUB_ID : first?.clubId ?? currentClubId,
    fixture ? DASHBOARD_FIXTURE_TEAM_ID : first?.teamId ?? "",
    fixture ? DASHBOARD_FIXTURE_SEASON_ID : first?.seasonId ?? "",
  ), [currentClubId, first?.clubId, first?.seasonId, first?.teamId, fixture]);
  const scope = useMemo(() => scopeFromSearchParams(new URLSearchParams(searchParams.toString()), "a", fallback), [fallback, searchParams]);
  const rows = useMemo(() => buildVideoReviewRows(resolvedRecords, scope, kind, actorId || undefined), [actorId, kind, resolvedRecords, scope]);
  const actors = useMemo(() => {
    const map = new Map<string, string>();
    for (const record of resolvedRecords) for (const player of record.session.players) map.set(player.id, `#${player.number} ${player.name}`);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [resolvedRecords]);
  const query = searchParams.toString();
  const title = `${KIND_LABEL[kind]}${actorId ? ` · ${actors.find(([id]) => id === actorId)?.[1] ?? actorId}` : ""}`;
  const selectedRows = rows.filter((row) => selected.has(rowKey(row)));
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(rowKey(row)));
  async function copyLinks(target: readonly VideoReviewRow[], label: string) {
    const text = buildWhatsAppVideoText(title, target, window.location.origin);
    try { await navigator.clipboard.writeText(text); setCopied(label); setFallbackText(""); }
    catch { setFallbackText(text); setCopied(""); }
  }
  return <div className="min-h-screen overflow-x-clip bg-slate-950 text-white"><AppHeader title="Revisión de jugadas" clubId={fixture ? undefined : scope.clubId}/><main className="mx-auto max-w-6xl space-y-4 p-3 pb-16 sm:p-5">
    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black tracking-widest text-red-300">ÍNDICE DE VÍDEO · MISMO SCOPE DEL DASHBOARD</p><h2 className="mt-1 text-2xl font-black">Localiza, ajusta y comparte jugadas</h2><p className="mt-1 text-xs text-slate-400">Los enlaces se calculan al instante; ningún evento almacena una URL de vídeo.</p></div><Link href={`/dashboard?${query}`} className="inline-grid min-h-11 place-items-center rounded-xl bg-slate-800 px-4 text-xs font-black">← DASHBOARD</Link></div></section>
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_14rem]"><label className="text-[10px] font-black text-slate-500">TIPO DE JUGADA<select value={kind} onChange={(event) => { setKind(event.target.value as VideoReviewKind); setActorId(""); setSelected(new Set()); }} className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-xs font-black">{(Object.keys(KIND_LABEL) as VideoReviewKind[]).map((value) => <option key={value} value={value}>{KIND_LABEL[value]}</option>)}</select></label><label className="text-[10px] font-black text-slate-500">PERSONA<select aria-label="Filtrar persona" value={actorId} onChange={(event) => { setActorId(event.target.value); setSelected(new Set()); }} disabled={["ALL", "THREATS_AGAINST", "CORNERS_FOR", "CORNERS_AGAINST", "KICK_INS_FOR", "KICK_INS_AGAINST", "FOULS", "CARDS"].includes(kind)} className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-xs font-black disabled:opacity-40"><option value="">TODAS LAS PERSONAS</option>{actors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setSelected(allSelected ? new Set() : new Set(rows.map(rowKey)))} disabled={rows.length === 0} className="min-h-11 rounded-xl bg-slate-800 px-4 text-xs font-black disabled:opacity-35">{allSelected ? "QUITAR SELECCIÓN" : "SELECCIONAR VISIBLES"}</button><button type="button" onClick={() => void copyLinks(selectedRows, "selection")} disabled={selectedRows.length === 0} className="min-h-11 rounded-xl bg-cyan-950 px-4 text-xs font-black text-cyan-200 disabled:opacity-35">{copied === "selection" ? "✓ COPIADO" : `COPIAR SELECCIÓN (${selectedRows.length})`}</button><button type="button" onClick={() => void copyLinks(rows, "all")} disabled={rows.length === 0} className="min-h-11 rounded-xl bg-emerald-400 px-4 text-xs font-black text-slate-950 disabled:opacity-35">{copied === "all" ? "✓ COPIADO" : "COPIAR TODAS LAS FILTRADAS"}</button></div>
      {fallbackText && <label className="block text-[10px] font-black text-amber-300">COPIA MANUAL<textarea readOnly value={fallbackText} onFocus={(event) => event.currentTarget.select()} className="mt-1 h-36 w-full rounded-xl bg-slate-950 p-3 text-xs text-white"/></label>}
    </section>
    <p className="text-xs text-slate-500">{rows.length} jugadas · {rows.filter((row) => row.resolution.status === "RESOLVED").length} con enlace</p>
    <div className="space-y-2">{rows.map((row) => { const { record, event, resolution } = row; const key = rowKey(row); const manual = resolution.status === "RESOLVED" && resolution.quality === "MANUAL"; return <article key={key} className={`grid gap-2 rounded-2xl border bg-slate-900 p-3 sm:grid-cols-[3rem_8rem_1fr_auto] sm:items-center ${selected.has(key) ? "border-cyan-400" : "border-slate-800"}`}><label className="grid min-h-11 min-w-11 place-items-center"><input aria-label={`Seleccionar ${event.id}`} type="checkbox" className="h-6 w-6" checked={selected.has(key)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })}/></label><div><p className="text-[10px] font-black text-cyan-300">{record.catalog.date}</p><p className="truncate text-xs font-bold">{record.catalog.opponent}</p></div><div className="min-w-0"><p className="text-[10px] font-black text-slate-500">P{event.period} · min {event.minute} · order {event.order}</p><p className="truncate text-sm font-bold">{eventDescription(event, record.session.players)}</p><p className={`mt-0.5 text-[10px] ${manual ? "font-bold text-amber-300" : "text-slate-500"}`}>{resolution.status === "RESOLVED" ? `${manual ? "Vídeo ajustado" : "Vídeo estimado"}: ${manual ? "" : "~"}${formatVideoTimestamp(resolution.estimatedSecond)} · abre desde ${formatVideoTimestamp(resolution.openSecond)}${manual ? " · AJUSTADO MANUALMENTE" : ""}` : videoResolutionLabel(resolution.status)}</p></div><div className="flex flex-wrap items-center gap-2"><VideoStatusLink session={record.session} eventId={event.id}/><Link href={revisionEventHref(record.catalog.matchId, event.id, `/dashboard/jugadas?${query}`, fixture)} className="inline-grid min-h-11 place-items-center rounded-xl bg-slate-800 px-3 text-[10px] font-black">VER EVENTO</Link>{canWrite && compatibleVideoSegments(record.session, event).length > 0 && <button type="button" onClick={() => setAdjusting(row)} className="min-h-11 rounded-xl bg-red-950 px-3 text-[10px] font-black text-red-200">AJUSTAR VÍDEO</button>}</div></article>; })}</div>
    {rows.length === 0 && <section className="rounded-3xl border border-dashed border-slate-700 p-10 text-center text-slate-400">No hay jugadas para esta intersección de filtros.</section>}
    {adjusting && <VideoAdjustment row={adjusting} onClose={() => setAdjusting(null)} onChanged={() => setRecords(localRecords())} readOnlyFixture={fixture}/>}
  </main></div>;
}

export default function VideoReviewPage() {
  return <Suspense fallback={<div className="min-h-screen bg-slate-950 p-10 text-center text-slate-500">Preparando jugadas…</div>}><VideoReviewContent /></Suspense>;
}
