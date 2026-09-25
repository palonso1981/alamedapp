"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppHeader } from "../../components/app/AppHeader";
import { useAccess } from "../../components/access/AccessProvider";
import { VideoClipComposer } from "../../components/video/VideoClipComposer";
import { YouTubeLabPlayer, YouTubeLabPlayerHandle } from "../../components/video/YouTubeLabPlayer";
import { DashboardMatchRecord } from "../../lib/dashboardAnalytics";
import { buildDashboardFixture } from "../../lib/dashboardFixture";
import { emptyDashboardScope, hasDashboardScopeSearchParams, scopeFromSearchParams } from "../../lib/dashboardV2";
import { eventDescription } from "../../lib/eventPresentation";
import { listMatchCatalog } from "../../lib/matchCatalog";
import { loadMatchSession } from "../../lib/matchPersistence";
import { buildVideoLabSyncSegments, VIDEO_CLIP_SUGGESTED_CATEGORIES, videoClipTagSuggestions } from "../../lib/videoLab";
import { formatVideoTimestamp } from "../../lib/videoIndex";
import { buildVideoLibraryItems, EMPTY_VIDEO_LIBRARY_FILTERS, nextReelIndex, shouldAdvanceReel, VideoLibraryEventKind, VideoLibraryFilters, VideoLibraryItem } from "../../lib/videoLibrary";
import { useMatchStore } from "../../store/useMatchStore";
import { useTeamStore } from "../../store/useTeamStore";
import { MatchVideoAnalysisClip } from "../../types";

const EVENT_KINDS: Array<[VideoLibraryEventKind, string]> = [
  ["ALL", "TODOS LOS EVENTOS"], ["threat_recorded", "AMENAZAS / REMATES"], ["possession_lost", "PÉRDIDAS"],
  ["foul_recorded", "FALTAS"], ["card_recorded", "TARJETAS"], ["restart_recorded", "REINICIOS"],
];

function readLocalRecords(): DashboardMatchRecord[] {
  return listMatchCatalog().flatMap((catalog) => {
    const session = loadMatchSession(catalog.matchId);
    return session ? [{ catalog, session }] : [];
  });
}

function labelFor(item: VideoLibraryItem): string {
  return item.source === "EVENT" ? item.title : item.clip.category || item.clip.tags[0] || "Clip de análisis";
}

function VideoLibraryContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { canWrite } = useAccess();
  const currentClubId = useTeamStore((state) => state.currentClubId);
  const workspace = useTeamStore((state) => state.teams[currentClubId]);
  const ensureRegistry = useTeamStore((state) => state.ensureRegistry);
  const ensureTeam = useTeamStore((state) => state.ensureTeam);
  const ensureMatch = useMatchStore((state) => state.ensureMatch);
  const upsertClip = useMatchStore((state) => state.upsertVideoAnalysisClip);
  const removeClip = useMatchStore((state) => state.removeVideoAnalysisClip);
  const playerRef = useRef<YouTubeLabPlayerHandle>(null);
  const fixture = searchParams.get("fixture") === "1";
  const fromDashboard = searchParams.get("from") === "dashboard";
  const [records, setRecords] = useState<DashboardMatchRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState<VideoLibraryFilters>(() => ({
    ...EMPTY_VIDEO_LIBRARY_FILTERS,
    playerId: searchParams.get("vPlayer") ?? "",
    eventKind: (searchParams.get("vKind") as VideoLibraryEventKind) ?? "ALL",
    category: searchParams.get("vCategory") ?? "",
    tag: searchParams.get("vTag") ?? "",
    rival: searchParams.get("vRival") ?? "",
    matchId: searchParams.get("vMatch") ?? "",
    seasonId: searchParams.get("vSeason") ?? "",
    verifiedOnly: searchParams.get("vVerified") === "1",
  }));
  const [selected, setSelected] = useState(0);
  const [reel, setReel] = useState(false);
  const [editing, setEditing] = useState<MatchVideoAnalysisClip | null>(null);

  useEffect(() => { ensureRegistry(); ensureTeam(currentClubId); }, [currentClubId, ensureRegistry, ensureTeam]);
  useEffect(() => { setRecords(fixture ? buildDashboardFixture() : readLocalRecords()); setReady(true); }, [fixture]);
  const fallbackRecord = records.find((record) => record.catalog.clubId === currentClubId) ?? records[0];
  const dashboardScope = useMemo(() => {
    if (!fromDashboard || !fallbackRecord || !hasDashboardScopeSearchParams(new URLSearchParams(searchParams.toString()), "a")) return undefined;
    const fallback = emptyDashboardScope(fallbackRecord.catalog.clubId ?? currentClubId, fallbackRecord.catalog.teamId ?? "", fallbackRecord.catalog.seasonId ?? "");
    return scopeFromSearchParams(new URLSearchParams(searchParams.toString()), "a", fallback);
  }, [currentClubId, fallbackRecord, fromDashboard, searchParams]);
  const visibleRecords = useMemo(() => records.filter((record) => fixture || record.catalog.clubId === currentClubId || (!record.catalog.clubId && currentClubId === "cd-alameda")), [currentClubId, fixture, records]);
  const items = useMemo(() => buildVideoLibraryItems(visibleRecords, filters, { dashboardScope, includeClips: !fromDashboard }), [dashboardScope, filters, fromDashboard, visibleRecords]);
  const allItems = useMemo(() => buildVideoLibraryItems(visibleRecords, { ...filters, verifiedOnly: false }, { dashboardScope, includeClips: !fromDashboard }), [dashboardScope, filters, fromDashboard, visibleRecords]);
  const verifiedCount = allItems.filter((item) => item.verified).length;
  const active = items[selected] ?? items[0];

  useEffect(() => { if (selected >= items.length) setSelected(Math.max(0, items.length - 1)); }, [items.length, selected]);
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const values: Array<[string, string]> = [["vPlayer", filters.playerId], ["vKind", filters.eventKind === "ALL" ? "" : filters.eventKind], ["vCategory", filters.category], ["vTag", filters.tag], ["vRival", filters.rival], ["vMatch", filters.matchId], ["vSeason", filters.seasonId], ["vVerified", filters.verifiedOnly ? "1" : ""]];
    values.forEach(([key, value]) => value ? params.set(key, value) : params.delete(key));
    const next = params.toString();
    if (next !== searchParams.toString()) router.replace(`/video${next ? `?${next}` : ""}`, { scroll: false });
  }, [filters, router, searchParams]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => { playerRef.current?.seekTo(active.startSecond); if (reel) playerRef.current?.play(); }, 150);
    return () => window.clearTimeout(timer);
  }, [active, reel]);

  const players = useMemo(() => Array.from(new Map(visibleRecords.flatMap((record) => record.session.players).map((player) => [player.id, player])).values()).sort((a, b) => a.name.localeCompare(b.name)), [visibleRecords]);
  const rivals = useMemo(() => Array.from(new Set(visibleRecords.map((record) => record.catalog.opponent))).sort(), [visibleRecords]);
  const seasons = useMemo(() => Array.from(new Set(visibleRecords.map((record) => record.catalog.seasonId).filter(Boolean) as string[])).sort(), [visibleRecords]);
  const tags = useMemo(() => videoClipTagSuggestions(visibleRecords.flatMap((record) => record.session.videoAnalysisClips ?? [])), [visibleRecords]);
  const categories = useMemo(() => Array.from(new Set([...VIDEO_CLIP_SUGGESTED_CATEGORIES, ...visibleRecords.flatMap((record) => (record.session.videoAnalysisClips ?? []).flatMap((clip) => clip.category ? [clip.category] : []))])), [visibleRecords]);

  const move = (direction: 1 | -1) => { const next = nextReelIndex(items, selected, direction); if (next >= 0) setSelected(next); };
  const onTimeChange = (second: number) => { if (shouldAdvanceReel(active, second, reel)) move(1); };
  const openEdit = (clip: MatchVideoAnalysisClip) => { ensureMatch(clip.matchId); setEditing(clip); setReel(false); };
  const editingRecord = editing ? visibleRecords.find((record) => record.catalog.matchId === editing.matchId) : undefined;
  const editingSegment = editingRecord ? buildVideoLabSyncSegments(editingRecord.session).find((segment) => segment.id === editing?.segmentId) : undefined;
  const updateFilter = <K extends keyof VideoLibraryFilters>(key: K, value: VideoLibraryFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));

  return <div className="min-h-screen overflow-x-hidden bg-slate-950 text-white"><AppHeader title="Biblioteca Video" clubId={fixture ? undefined : currentClubId}/><main className="mx-auto max-w-[1500px] space-y-4 p-3 pb-16 sm:p-5">
    <header className="rounded-3xl border border-slate-800 bg-slate-900 p-4"><p className="text-[10px] font-black tracking-[.18em] text-cyan-300">EVENTOS DEPORTIVOS + CLIPS DE ANÁLISIS</p><div className="mt-1 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-black">BIBLIOTECA VIDEO</h1><p className="text-xs text-slate-400">{fromDashboard ? "Conjunto heredado del Dashboard · clips excluidos salvo filtro de análisis." : "Consulta audiovisual del club."}</p></div><div className="flex gap-2"><span className="rounded-full bg-slate-800 px-3 py-2 text-xs font-black">TODOS {allItems.length}</span><span className="rounded-full bg-emerald-950 px-3 py-2 text-xs font-black text-emerald-300">VERIFIED {verifiedCount}</span>{fromDashboard && <Link href="/video" className="rounded-full bg-violet-950 px-3 py-2 text-xs font-black text-violet-200">VER TODA LA BIBLIOTECA</Link>}</div></div></header>

    <section className="grid gap-2 rounded-3xl border border-slate-800 bg-slate-900 p-3 sm:grid-cols-2 lg:grid-cols-4">
      <select aria-label="Jugador" value={filters.playerId} onChange={(event) => updateFilter("playerId", event.target.value)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black"><option value="">TODOS LOS JUGADORES</option>{players.map((player) => <option key={player.id} value={player.id}>#{player.number} {player.name}</option>)}</select>
      <select aria-label="Tipo de evento" value={filters.eventKind} onChange={(event) => updateFilter("eventKind", event.target.value as VideoLibraryEventKind)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black">{EVENT_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="Categoría" value={filters.category} onChange={(event) => updateFilter("category", event.target.value)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black"><option value="">TODAS LAS CATEGORÍAS</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <select aria-label="Etiqueta" value={filters.tag} onChange={(event) => updateFilter("tag", event.target.value)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black"><option value="">TODAS LAS ETIQUETAS</option>{tags.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <select aria-label="Rival" value={filters.rival} onChange={(event) => updateFilter("rival", event.target.value)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black"><option value="">TODOS LOS RIVALES</option>{rivals.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <select aria-label="Partido" value={filters.matchId} onChange={(event) => updateFilter("matchId", event.target.value)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black"><option value="">TODOS LOS PARTIDOS</option>{visibleRecords.map((record) => <option key={record.catalog.matchId} value={record.catalog.matchId}>{record.catalog.opponent} · {record.catalog.date}</option>)}</select>
      <select aria-label="Temporada" value={filters.seasonId} onChange={(event) => updateFilter("seasonId", event.target.value)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black"><option value="">TODAS LAS TEMPORADAS</option>{seasons.map((value) => <option key={value} value={value}>{workspace?.seasons.find((season) => season.seasonId === value)?.label ?? value}</option>)}</select>
      <button type="button" onClick={() => updateFilter("verifiedOnly", !filters.verifiedOnly)} className={`min-h-11 rounded-xl px-3 text-xs font-black ${filters.verifiedOnly ? "bg-emerald-400 text-slate-950" : "bg-slate-800"}`}>{filters.verifiedOnly ? "✓ SOLO VERIFIED" : "TODOS / SOLO VERIFIED"}</button>
    </section>

    {!ready ? <p className="p-10 text-center text-slate-500">Preparando vídeos…</p> : !active ? <section className="rounded-3xl border border-dashed border-slate-700 p-10 text-center"><strong>Sin vídeos para esta combinación</strong><p className="mt-2 text-sm text-slate-500">Retira un filtro o verifica la calibración del partido.</p></section> : <div className="grid gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(340px,.85fr)]"><section className="rounded-3xl border border-slate-800 bg-slate-900 p-3"><YouTubeLabPlayer key={`${active.videoId}:${active.key}`} ref={playerRef} videoId={active.videoId} initialSecond={active.startSecond} onTimeChange={onTimeChange}/><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><button type="button" onClick={() => move(-1)} className="min-h-12 rounded-xl bg-slate-800 text-xs font-black">← ANTERIOR</button><button type="button" onClick={() => move(1)} className="min-h-12 rounded-xl bg-slate-800 text-xs font-black">SIGUIENTE →</button><button type="button" onClick={() => { const next = !reel; setReel(next); if (next) playerRef.current?.play(); else playerRef.current?.pause(); }} className={`min-h-12 rounded-xl text-xs font-black ${reel ? "bg-amber-400 text-slate-950" : "bg-cyan-400 text-slate-950"}`}>{reel ? "Ⅱ PAUSA REEL" : "▶ REANUDAR REEL"}</button><span className="grid min-h-12 place-items-center rounded-xl bg-slate-950 font-mono text-xs text-cyan-300">{formatVideoTimestamp(active.startSecond)}–{formatVideoTimestamp(active.endSecond)}</span></div><article className="mt-3 rounded-2xl bg-slate-950 p-4"><div className="flex items-start justify-between gap-3"><div><span className={`text-[9px] font-black ${active.source === "EVENT" ? "text-cyan-300" : "text-violet-300"}`}>{active.source === "EVENT" ? "EVENTO DEPORTIVO" : "CLIP DE ANÁLISIS"}</span><h2 className="text-xl font-black">{labelFor(active)}</h2><p className="text-xs text-slate-400">{active.opponent} · {active.date}</p></div><span className={`rounded-full px-3 py-2 text-[10px] font-black ${active.verified ? "bg-emerald-950 text-emerald-300" : "bg-amber-950 text-amber-300"}`}>{active.verified ? "VERIFIED" : "AUTO"}</span></div>{active.source === "EVENT" ? <p className="mt-2 text-sm text-slate-300">P{active.event.period} · min {active.event.minute} · {eventDescription(active.event, visibleRecords.find((record) => record.catalog.matchId === active.matchId)?.session.players ?? [])}</p> : <><p className="mt-2 text-sm text-slate-300">{active.clip.tags.join(" · ") || "Sin etiquetas"}</p>{active.clip.comment && <p className="mt-2 text-sm text-slate-400">{active.clip.comment}</p>}{canWrite && <div className="mt-3 flex gap-2"><button type="button" onClick={() => openEdit(active.clip)} className="min-h-11 rounded-xl bg-violet-500 px-4 text-xs font-black text-slate-950">EDITAR CLIP</button><button type="button" onClick={() => { if (window.confirm("¿Eliminar este clip de análisis?")) { ensureMatch(active.matchId); window.setTimeout(() => { removeClip(active.matchId, active.clip.id); setRecords(readLocalRecords()); }, 0); } }} className="min-h-11 rounded-xl bg-rose-950 px-4 text-xs font-black text-rose-200">ELIMINAR</button></div>}</>}</article>{editing && editingRecord && editingSegment && <div className="mt-3"><VideoClipComposer session={editingRecord.session} segment={editingSegment} initialClip={editing} currentSecond={() => playerRef.current?.currentSecond() ?? editing.referenceSecond} onSave={(clip) => { upsertClip(editing.matchId, clip); window.setTimeout(() => setRecords(readLocalRecords()), 0); setEditing(null); }} onCancel={() => setEditing(null)}/></div>}</section>
      <section className="max-h-[75vh] space-y-2 overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-2">{items.map((item, index) => <button key={item.key} type="button" onClick={() => { setSelected(index); setReel(false); }} className={`w-full rounded-2xl border p-3 text-left ${index === selected ? "border-cyan-400 bg-cyan-950/30" : "border-transparent bg-slate-950"}`}><div className="flex justify-between gap-2"><strong className="truncate text-sm">{labelFor(item)}</strong><span className="font-mono text-[10px] text-cyan-300">{formatVideoTimestamp(item.startSecond)}</span></div><p className="mt-1 text-[10px] text-slate-400">{item.opponent} · {item.date}</p><div className="mt-2 flex gap-2"><span className={`rounded-full px-2 py-1 text-[9px] font-black ${item.source === "EVENT" ? "bg-cyan-950 text-cyan-300" : "bg-violet-950 text-violet-300"}`}>{item.source}</span><span className={`rounded-full px-2 py-1 text-[9px] font-black ${item.verified ? "bg-emerald-950 text-emerald-300" : "bg-amber-950 text-amber-300"}`}>{item.verified ? "VERIFIED" : "AUTO"}</span></div></button>)}</section></div>}
  </main></div>;
}

export default function VideoLibraryPage() {
  return <Suspense fallback={<div className="grid min-h-screen place-items-center bg-slate-950 text-slate-400">Preparando Biblioteca Video…</div>}><VideoLibraryContent/></Suspense>;
}
