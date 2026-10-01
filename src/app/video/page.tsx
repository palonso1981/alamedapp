"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppHeader } from "../../components/app/AppHeader";
import { useAccess } from "../../components/access/AccessProvider";
import { CompactMultiSelect, CompactMultiSelectOption } from "../../components/video/CompactMultiSelect";
import { YouTubeLabPlayer, YouTubeLabPlayerHandle } from "../../components/video/YouTubeLabPlayer";
import { DASHBOARD_PHASES, DashboardMatchRecord } from "../../lib/dashboardAnalytics";
import { PitchOriginZone } from "../../lib/dashboardAnalysis";
import { buildDashboardFixture } from "../../lib/dashboardFixture";
import { emptyDashboardScope, hasDashboardScopeSearchParams, matchCompetition, scopeFromSearchParams } from "../../lib/dashboardV2";
import { eventDescription, phaseLabel } from "../../lib/eventPresentation";
import { listMatchCatalog } from "../../lib/matchCatalog";
import { loadMatchSession } from "../../lib/matchPersistence";
import { VIDEO_CLIP_SUGGESTED_CATEGORIES, videoClipTagSuggestions } from "../../lib/videoLab";
import { formatVideoTimestamp } from "../../lib/videoIndex";
import { activeVideoLibraryRecords, buildVideoLibraryItems, canonicalVideoRival, dashboardReturnHref, EMPTY_VIDEO_LIBRARY_FILTERS, nextReelIndex, reelCutCompletion, removeVideoTag, renameVideoTag, videoLabNavigationHref, videoLibraryFiltersFromSearchParams, videoLibraryFiltersToSearchParams, videoLibraryKeyboardAction, videoLibraryWriteActionState, VideoLibraryEventKind, VideoLibraryFilters, VideoLibraryItem, VideoLibrarySourceFilter, videoTagUsage } from "../../lib/videoLibrary";
import { useMatchStore } from "../../store/useMatchStore";
import { useTeamStore } from "../../store/useTeamStore";
import { MatchVideoAnalysisClip, ThreatOutcome } from "../../types";
import { useVideoCollections } from "../../hooks/useVideoCollections";
import { appendCollectionItems, collectionShareHref, createVideoCollection, listedVideoCollections, playableCollectionItems, removeCollectionItem, reorderCollectionItem, VideoCollection, VideoCollectionVisibility } from "../../lib/videoCollections";

const EVENT_FILTERS: Array<[VideoLibraryEventKind, string]> = [
  ["SHOTS", "REMATES"],
  ["THREATS", "AMENAZAS"],
  ["LOSSES", "PÉRDIDAS"],
  ["SET_PIECES", "ABP"],
  ["SET_PIECE_CORNER", "ABP · CÓRNER"],
  ["SET_PIECE_FREE_KICK", "ABP · FALTA / LIBRE DIRECTO"],
  ["SET_PIECE_KICK_IN", "ABP · BANDA"],
  ["SET_PIECE_PENALTY", "ABP · PENALTI"],
  ["SET_PIECE_DOUBLE_PENALTY", "ABP · DOBLE PENALTI"],
  ["FOULS", "FALTAS"],
  ["CARDS", "TARJETAS"],
];
const OUTCOME_LABELS: Record<ThreatOutcome, string> = { GOL: "GOL", PARADA: "PARADA", FUERA: "FUERA", BLOQUEADO: "BLOQUEADO · LEGACY" };

const SOURCE_FILTERS: Array<[VideoLibrarySourceFilter, string]> = [
  ["ALL", "◫ TODO"],
  ["EVENT", "⚽ EVENTOS DEL PARTIDO"],
  ["CLIP", "🧑‍🏫 CLIPS DE ANÁLISIS"],
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

function option(value: string, label = value): CompactMultiSelectOption {
  return { value, label };
}

function VideoLibraryContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { canWrite } = useAccess();
  const writeActions = videoLibraryWriteActionState(canWrite);
  const currentClubId = useTeamStore((state) => state.currentClubId);
  const workspace = useTeamStore((state) => state.teams[currentClubId]);
  const ensureRegistry = useTeamStore((state) => state.ensureRegistry);
  const ensureTeam = useTeamStore((state) => state.ensureTeam);
  const ensureMatch = useMatchStore((state) => state.ensureMatch);
  const upsertClip = useMatchStore((state) => state.upsertVideoAnalysisClip);
  const removeClip = useMatchStore((state) => state.removeVideoAnalysisClip);
  const playerRef = useRef<YouTubeLabPlayerHandle>(null);
  const reelContainerRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const lastCompletedCutRef = useRef<string | null>(null);
  const fixture = searchParams.get("fixture") === "1";
  const fromDashboard = searchParams.get("from") === "dashboard";
  const defaultSource: VideoLibrarySourceFilter = fromDashboard ? "EVENT" : "ALL";
  const [records, setRecords] = useState<DashboardMatchRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState<VideoLibraryFilters>(() => videoLibraryFiltersFromSearchParams(searchParams, defaultSource));
  const [selected, setSelected] = useState(0);
  const [reel, setReel] = useState(false);
  const [autoPlaySelection, setAutoPlaySelection] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenFallback, setFullscreenFallback] = useState(false);
  const [reelFinished, setReelFinished] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [manageTags, setManageTags] = useState(false);
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const [collectionEditor, setCollectionEditor] = useState<VideoCollection | null>(null);
  const [collectionName, setCollectionName] = useState("");
  const [collectionDescription, setCollectionDescription] = useState("");
  const [collectionVisibility, setCollectionVisibility] = useState<VideoCollectionVisibility>("CLUB");
  const [collectionMessage, setCollectionMessage] = useState("");
  const collectionId = searchParams.get("collection");
  const collectionStore = useVideoCollections(currentClubId, !fixture);

  useEffect(() => { ensureRegistry(); ensureTeam(currentClubId); }, [currentClubId, ensureRegistry, ensureTeam]);
  useEffect(() => { setRecords(fixture ? buildDashboardFixture() : readLocalRecords()); setReady(true); }, [fixture]);
  const fallbackRecord = records.find((record) => record.catalog.clubId === currentClubId) ?? records[0];
  const dashboardScope = useMemo(() => {
    if (!fromDashboard || !fallbackRecord || !hasDashboardScopeSearchParams(new URLSearchParams(searchParams.toString()), "a")) return undefined;
    const fallback = emptyDashboardScope(fallbackRecord.catalog.clubId ?? currentClubId, fallbackRecord.catalog.teamId ?? "", fallbackRecord.catalog.seasonId ?? "");
    return scopeFromSearchParams(new URLSearchParams(searchParams.toString()), "a", fallback);
  }, [currentClubId, fallbackRecord, fromDashboard, searchParams]);
  const visibleRecords = useMemo(() => activeVideoLibraryRecords(records.filter((record) => fixture || record.catalog.clubId === currentClubId || (!record.catalog.clubId && currentClubId === "cd-alameda"))), [currentClubId, fixture, records]);
  const filteredItems = useMemo(() => buildVideoLibraryItems(visibleRecords, filters, { dashboardScope }), [dashboardScope, filters, visibleRecords]);
  const originItems = useMemo(() => buildVideoLibraryItems(visibleRecords, EMPTY_VIDEO_LIBRARY_FILTERS, { includeClips: true }), [visibleRecords]);
  const openedCollection = useMemo(() => collectionStore.collections.find((item) => item.collectionId === collectionId && item.active && item.deletedAt === null), [collectionId, collectionStore.collections]);
  const collectionPlayback = useMemo(() => openedCollection ? playableCollectionItems(openedCollection, originItems) : null, [openedCollection, originItems]);
  const items = collectionPlayback?.items ?? filteredItems;
  const allItems = useMemo(() => buildVideoLibraryItems(visibleRecords, { ...filters, verifiedOnly: false }, { dashboardScope }), [dashboardScope, filters, visibleRecords]);
  const verifiedCount = allItems.filter((item) => item.verified).length;
  const active = items[selected] ?? items[0];
  const itemSignature = items.map((item) => item.key).join("|");
  const move = useCallback((direction: 1 | -1) => {
    const next = nextReelIndex(items, selected, direction);
    if (next >= 0) {
      setAutoPlaySelection(true);
      setReelFinished(false);
      setAutoplayBlocked(false);
      if (fullscreen || fullscreenFallback) setReel(true);
      setSelected(next);
    }
  }, [fullscreen, fullscreenFallback, items, selected]);

  useEffect(() => { if (selected >= items.length) setSelected(Math.max(0, items.length - 1)); }, [items.length, selected]);
  useEffect(() => {
    const focusKey = searchParams.get("vFocus");
    const focusIndex = focusKey ? items.findIndex((item) => item.key === focusKey) : -1;
    setSelected(focusIndex >= 0 ? focusIndex : 0);
    if (focusKey && focusIndex >= 0) window.setTimeout(() => itemRefs.current[focusKey]?.scrollIntoView({ block: "nearest" }), 0);
    setReel(false);
    setAutoPlaySelection(false);
    setReelFinished(false);
    setAutoplayBlocked(false);
    lastCompletedCutRef.current = null;
  }, [itemSignature, items, searchParams]);
  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === reelContainerRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);
  useEffect(() => {
    const params = videoLibraryFiltersToSearchParams(filters, searchParams.toString(), defaultSource);
    const next = params.toString();
    if (next !== searchParams.toString()) router.replace(`/video${next ? `?${next}` : ""}`, { scroll: false });
  }, [defaultSource, filters, router, searchParams]);
  useEffect(() => {
    if (!active) return;
    lastCompletedCutRef.current = null;
  }, [active]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable = Boolean(target?.isContentEditable || target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
      if ((event.key === "Escape" || event.code === "Escape") && fullscreenFallback) {
        event.preventDefault();
        setFullscreenFallback(false);
        return;
      }
      const action = videoLibraryKeyboardAction(event.code, editable);
      if (!action) return;
      event.preventDefault();
      if (action === "PREVIOUS") {
        move(-1);
      } else if (action === "NEXT") {
        move(1);
      } else if (playing) {
        playerRef.current?.pause();
        setReel(false);
        setAutoPlaySelection(false);
      } else {
        playerRef.current?.play();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreenFallback, move, playing]);

  const players = useMemo(() => Array.from(new Map(visibleRecords.flatMap((record) => record.session.players).map((player) => [player.id, player])).values()).sort((a, b) => a.name.localeCompare(b.name)), [visibleRecords]);
  const availableItems = useMemo(() => buildVideoLibraryItems(visibleRecords, EMPTY_VIDEO_LIBRARY_FILTERS, { dashboardScope, includeClips: true }), [dashboardScope, visibleRecords]);
  const allClips = useMemo(() => visibleRecords.flatMap((record) => record.session.videoAnalysisClips ?? []), [visibleRecords]);
  const rivals = useMemo(() => Array.from(new Map(visibleRecords.map((record) => [canonicalVideoRival(record.catalog.opponent), record.catalog.opponent])).entries()).sort((a, b) => a[1].localeCompare(b[1])), [visibleRecords]);
  const seasons = useMemo(() => Array.from(new Set(visibleRecords.map((record) => record.catalog.seasonId).filter(Boolean) as string[])).sort(), [visibleRecords]);
  const tags = useMemo(() => videoClipTagSuggestions(allClips), [allClips]);
  const categories = useMemo(() => Array.from(new Set([...VIDEO_CLIP_SUGGESTED_CATEGORIES, ...allClips.flatMap((clip) => clip.category ? [clip.category] : [])])).sort(), [allClips]);
  const outcomes = useMemo(() => Array.from(new Set(availableItems.flatMap((item) => item.source === "EVENT" && item.event.type === "threat_recorded" ? [item.event.outcome] : []))) as ThreatOutcome[], [availableItems]);
  const competitions = useMemo(() => Array.from(new Set(visibleRecords.map(matchCompetition))).sort(), [visibleRecords]);
  const matchdays = useMemo(() => Array.from(new Set(visibleRecords.flatMap((record) => record.session.preparation?.matchday ? [record.session.preparation.matchday] : []))).sort((a, b) => a - b), [visibleRecords]);
  const goalkeeperIds = useMemo(() => Array.from(new Set(availableItems.flatMap((item) => item.source === "EVENT" && item.event.type === "threat_recorded" && item.event.defensive?.goalkeeper.status === "PLAYER" ? [item.event.defensive.goalkeeper.playerId] : []))), [availableItems]);
  const feet = useMemo(() => Array.from(new Set(availableItems.flatMap((item) => item.dominantFeet))).sort(), [availableItems]);
  const matchOptions = useMemo(() => visibleRecords.map((record) => {
    const preparation = record.session.preparation;
    const competition = preparation?.competition ?? preparation?.competitionOtherDetail ?? preparation?.competitionType ?? "Sin competición";
    return option(record.catalog.matchId, `${preparation?.matchday ? `J${preparation.matchday} · ` : ""}${competition} · ${record.catalog.opponent}`);
  }), [visibleRecords]);
  const playerOptions = useMemo(() => players.map((player) => option(player.id, `#${player.number} ${player.name}`)), [players]);
  const goalkeeperOptions = useMemo(() => goalkeeperIds.map((playerId) => option(playerId, players.find((player) => player.id === playerId)?.name ?? playerId)), [goalkeeperIds, players]);
  const activeFilterCount = Object.entries(filters).reduce((total, [key, value]) => total + (key === "source" || key === "side" || key === "verifiedOnly" ? 0 : Array.isArray(value) && value.length > 0 ? 1 : 0), 0) + (filters.verifiedOnly ? 1 : 0) + (filters.side === "ALL" ? 0 : 1);

  const onTimeChange = (second: number) => {
    if (!active || lastCompletedCutRef.current === active.key) return;
    const completion = reelCutCompletion(items, selected, second, reel);
    if (completion.kind === "WAIT") return;
    lastCompletedCutRef.current = active.key;
    if (completion.kind === "NEXT") {
      setAutoPlaySelection(true);
      setAutoplayBlocked(false);
      setSelected(completion.index);
      return;
    }
    playerRef.current?.pause();
    setReel(false);
    setAutoPlaySelection(false);
    setReelFinished(true);
  };
  const startFullscreenReel = () => {
    if (!active) return;
    setSelected(0);
    setReel(true);
    setReelFinished(false);
    setAutoPlaySelection(true);
    setAutoplayBlocked(false);
    lastCompletedCutRef.current = null;
    if (selected === 0) {
      playerRef.current?.seekTo(active.startSecond);
      playerRef.current?.play();
    }
    const element = reelContainerRef.current;
    if (!element?.requestFullscreen) {
      setFullscreenFallback(true);
      return;
    }
    setFullscreenFallback(false);
    void element.requestFullscreen().catch(() => setFullscreenFallback(true));
  };
  const leaveFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else setFullscreenFallback(false);
  };
  const restartReel = () => {
    setSelected(0);
    setReel(true);
    setReelFinished(false);
    setAutoPlaySelection(true);
    setAutoplayBlocked(false);
    lastCompletedCutRef.current = null;
    if (selected === 0 && items[0]) {
      playerRef.current?.seekTo(items[0].startSecond);
      playerRef.current?.play();
    }
  };
  const updateFilter = <K extends keyof VideoLibraryFilters>(key: K, value: VideoLibraryFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  const selectSource = (source: VideoLibrarySourceFilter) => setFilters((current) => ({
    ...current,
    source,
    ...(source === "CLIP" ? { side: "ALL" as const, eventKinds: [], phases: [], outcomes: [], goalkeeperIds: [], originZones: [], targetZones: [] } : {}),
    ...(source === "EVENT" ? { themes: [], tags: [] } : {}),
  }));
  const clearFilters = () => setFilters({ ...EMPTY_VIDEO_LIBRARY_FILTERS, source: defaultSource });
  const persistTagChange = (transform: (clips: readonly MatchVideoAnalysisClip[]) => MatchVideoAnalysisClip[]) => {
    const visibleMatchIds = new Set(visibleRecords.map((record) => record.catalog.matchId));
    const nextRecords = records.map((record) => {
      if (!visibleMatchIds.has(record.catalog.matchId)) return record;
      const previous = record.session.videoAnalysisClips ?? [];
      const next = transform(previous);
      const changed = next.filter((clip, index) => clip !== previous[index]);
      if (changed.length === 0) return record;
      ensureMatch(record.catalog.matchId);
      changed.forEach((clip) => upsertClip(record.catalog.matchId, clip));
      return { ...record, session: { ...record.session, videoAnalysisClips: next } };
    });
    setRecords(nextRecords);
  };
  const renameTag = (tag: string) => {
    const next = tagDrafts[tag]?.trim();
    if (!next || next.toLocaleLowerCase("es") === tag.toLocaleLowerCase("es")) return;
    persistTagChange((clips) => renameVideoTag(clips, tag, next));
    setTagDrafts((current) => ({ ...current, [tag]: "" }));
  };
  const deleteTag = (tag: string) => {
    const usage = videoTagUsage(allClips, tag);
    if (!window.confirm(`La etiqueta “${tag}” se utiliza en ${usage} elemento${usage === 1 ? "" : "s"}. ¿Retirarla sin borrar clips ni eventos?`)) return;
    persistTagChange((clips) => removeVideoTag(clips, tag));
  };
  const dashboardReturnUrl = useMemo(() => dashboardReturnHref(searchParams.toString()), [searchParams]);
  const editHref = active ? videoLabNavigationHref(active, searchParams.toString(), "EDIT") : "#";
  const addAtCurrentSecond = () => {
    if (!active || !writeActions.canAdd) return;
    router.push(videoLabNavigationHref(active, searchParams.toString(), "ADD", playerRef.current?.currentSecond() ?? active.referenceSecond));
  };
  const activePlayerNames = active
    ? Array.from(new Set(active.playerIds.flatMap((playerId) => visibleRecords.flatMap((record) => record.session.players.filter((player) => player.id === playerId).map((player) => player.name)))))
    : [];
  const cinemaMode = fullscreen || fullscreenFallback;
  const visibleCollections = useMemo(() => listedVideoCollections(collectionStore.collections).filter((item) => canWrite || item.visibility === "CLUB"), [canWrite, collectionStore.collections]);
  const beginCollection = (kind: "COLLECTION" | "SHARED_REEL") => {
    setCollectionEditor(null);
    setCollectionName(kind === "COLLECTION" ? `Selección · ${items.length} jugadas` : `Reel · ${items.length} jugadas`);
    setCollectionDescription("");
    setCollectionVisibility(kind === "COLLECTION" ? "CLUB" : "LINK_ONLY");
    setCollectionMessage(kind);
  };
  const editCollection = (value: VideoCollection) => {
    setCollectionEditor(value);
    setCollectionName(value.name);
    setCollectionDescription(value.description ?? "");
    setCollectionVisibility(value.visibility);
    setCollectionMessage("EDIT");
  };
  const saveCollection = () => {
    if (!canWrite || !collectionName.trim()) return;
    const now = Date.now();
    const value = collectionEditor
      ? { ...collectionEditor, name: collectionName.trim(), description: collectionDescription.trim() || undefined, visibility: collectionVisibility, updatedAt: now }
      : createVideoCollection({ collectionId: crypto.randomUUID(), clubId: currentClubId, kind: collectionMessage === "COLLECTION" ? "COLLECTION" : "SHARED_REEL", name: collectionName, description: collectionDescription, visibility: collectionVisibility, items, now });
    collectionStore.upsert(value);
    setCollectionMessage("");
    setCollectionEditor(null);
    if (typeof window !== "undefined") void navigator.clipboard?.writeText(collectionShareHref(value.collectionId, window.location.origin));
  };
  const copyCollectionLink = (value: VideoCollection) => {
    if (typeof window !== "undefined") void navigator.clipboard?.writeText(collectionShareHref(value.collectionId, window.location.origin));
  };

  return <div className="min-h-screen overflow-x-hidden bg-slate-950 text-white"><AppHeader title="Biblioteca Video" clubId={fixture ? undefined : currentClubId}/><main className="mx-auto max-w-[1500px] space-y-4 p-3 pb-16 sm:p-5">
    <header className="rounded-3xl border border-slate-800 bg-slate-900 p-4"><p className="text-[10px] font-black tracking-[.18em] text-cyan-300">{openedCollection ? "COLECCIÓN / REEL COMPARTIDO" : "EVENTOS DEPORTIVOS + CLIPS DE ANÁLISIS"}</p><div className="mt-1 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-black">{openedCollection?.name ?? "BIBLIOTECA VIDEO"}</h1><p className="text-xs text-slate-400">{openedCollection?.description ?? (fromDashboard ? "Conjunto heredado del Dashboard." : "Consulta audiovisual del club.")}</p></div><div className="flex flex-wrap gap-2"><span className="rounded-full bg-slate-800 px-3 py-2 text-xs font-black">RESULTADOS {items.length}</span>{collectionPlayback && collectionPlayback.missing.length > 0 && <span className="rounded-full bg-amber-950 px-3 py-2 text-xs font-black text-amber-200">NO DISPONIBLES {collectionPlayback.missing.length}</span>}<span className="rounded-full bg-emerald-950 px-3 py-2 text-xs font-black text-emerald-300">VERIFIED {verifiedCount}</span>{activeFilterCount > 0 && !openedCollection && <span className="rounded-full bg-cyan-950 px-3 py-2 text-xs font-black text-cyan-200">FILTROS · {activeFilterCount}</span>}{openedCollection && <Link href="/video" className="rounded-full bg-cyan-950 px-3 py-2 text-xs font-black text-cyan-200">← VOLVER A VIDEO</Link>}{fromDashboard && !openedCollection && <><Link href={dashboardReturnUrl} className="rounded-full bg-cyan-950 px-3 py-2 text-xs font-black text-cyan-200">← VOLVER AL ANÁLISIS</Link><Link href="/video" className="rounded-full bg-violet-950 px-3 py-2 text-xs font-black text-violet-200">VER TODA LA BIBLIOTECA</Link></>}</div></div></header>

    {!openedCollection && <section aria-label="Colecciones de vídeo" className="rounded-3xl border border-violet-900/60 bg-slate-900 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-black tracking-[.16em] text-violet-300">COLECCIONES</p><p className="text-xs text-slate-400">Selecciones guardadas y reels compartibles · {collectionStore.pending ? `${collectionStore.pending} pendiente(s)` : "sin cambios pendientes"}</p></div>{canWrite && <div className="flex flex-wrap gap-2"><button type="button" disabled={items.length === 0} onClick={() => beginCollection("COLLECTION")} className="min-h-11 rounded-xl bg-violet-400 px-4 text-xs font-black text-slate-950 disabled:opacity-40">+ GUARDAR COLECCIÓN</button><button type="button" disabled={items.length === 0} onClick={() => beginCollection("SHARED_REEL")} className="min-h-11 rounded-xl bg-cyan-400 px-4 text-xs font-black text-slate-950 disabled:opacity-40">↗ COMPARTIR REEL</button></div>}</div>
      {visibleCollections.length > 0 && <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{visibleCollections.map((value) => <article key={value.collectionId} className="rounded-2xl bg-slate-950 p-3"><div className="flex items-start justify-between gap-2"><div><strong className="text-sm">{value.name}</strong><p className="text-[10px] text-slate-500">{value.items.length} cortes · {value.visibility === "CLUB" ? "CLUB" : "SOLO ENLACE"}</p></div></div><div className="mt-3 flex flex-wrap gap-2"><Link href={collectionShareHref(value.collectionId)} className="rounded-lg bg-cyan-950 px-3 py-2 text-[10px] font-black text-cyan-200">VER REEL</Link><button type="button" onClick={() => copyCollectionLink(value)} className="rounded-lg bg-slate-800 px-3 py-2 text-[10px] font-black">COPIAR ENLACE</button>{canWrite && <><button type="button" onClick={() => editCollection(value)} className="rounded-lg bg-violet-950 px-3 py-2 text-[10px] font-black text-violet-200">EDITAR</button><button type="button" onClick={() => { if (window.confirm("¿Retirar esta colección? El enlace dejará de abrirla.")) collectionStore.softDelete(value.collectionId); }} className="rounded-lg bg-rose-950 px-3 py-2 text-[10px] font-black text-rose-200">ELIMINAR</button></>}</div></article>)}</div>}
      {collectionStore.conflicts > 0 && <p className="mt-3 rounded-xl bg-amber-950 p-3 text-xs text-amber-200">{collectionStore.conflicts} colección(es) requieren revisión; la versión local se conserva.</p>}
    </section>}

    {collectionMessage && canWrite && <section role="dialog" aria-label="Editar colección" className="rounded-3xl border border-violet-700 bg-slate-900 p-4"><div className="grid gap-3 md:grid-cols-[1fr_1.4fr_auto]"><label className="text-[10px] font-black text-slate-400">NOMBRE<input value={collectionName} onChange={(event) => setCollectionName(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-950 px-3 text-sm text-white"/></label><label className="text-[10px] font-black text-slate-400">DESCRIPCIÓN OPCIONAL<input value={collectionDescription} onChange={(event) => setCollectionDescription(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-950 px-3 text-sm text-white"/></label><label className="text-[10px] font-black text-slate-400">VISIBILIDAD<select value={collectionVisibility} onChange={(event) => setCollectionVisibility(event.target.value as VideoCollectionVisibility)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-950 px-3 text-sm text-white"><option value="CLUB">CLUB</option><option value="LINK_ONLY">SOLO ENLACE</option></select></label></div>
      {collectionEditor && <div className="mt-3 space-y-2">{collectionEditor.items.map((item, index) => <div key={item.key} className="flex items-center gap-2 rounded-xl bg-slate-950 p-2"><span className="min-w-0 flex-1 truncate text-xs">{index + 1}. {item.title}</span><button type="button" disabled={index === 0} onClick={() => setCollectionEditor(reorderCollectionItem(collectionEditor, index, index - 1))} className="rounded-lg bg-slate-800 px-3 py-2 text-xs disabled:opacity-30">↑</button><button type="button" disabled={index === collectionEditor.items.length - 1} onClick={() => setCollectionEditor(reorderCollectionItem(collectionEditor, index, index + 1))} className="rounded-lg bg-slate-800 px-3 py-2 text-xs disabled:opacity-30">↓</button><button type="button" onClick={() => setCollectionEditor(removeCollectionItem(collectionEditor, item.key))} className="rounded-lg bg-rose-950 px-3 py-2 text-xs text-rose-200">QUITAR</button></div>)}<button type="button" onClick={() => setCollectionEditor(appendCollectionItems(collectionEditor, filteredItems))} className="min-h-10 rounded-xl bg-cyan-950 px-3 text-[10px] font-black text-cyan-200">AÑADIR RESULTADOS FILTRADOS</button></div>}
      <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => { setCollectionMessage(""); setCollectionEditor(null); }} className="min-h-11 rounded-xl bg-slate-800 px-4 text-xs font-black">CANCELAR</button><button type="button" onClick={saveCollection} className="min-h-11 rounded-xl bg-violet-400 px-4 text-xs font-black text-slate-950">GUARDAR Y COPIAR ENLACE</button></div>
    </section>}

    {!openedCollection && <><section aria-label="Fuente de contenido" className="grid gap-2 rounded-3xl border border-slate-800 bg-slate-900 p-2 sm:grid-cols-3">
      {SOURCE_FILTERS.map(([value, label]) => <button key={value} type="button" aria-pressed={filters.source === value} onClick={() => selectSource(value)} className={`min-h-12 rounded-2xl px-3 text-xs font-black ${filters.source === value ? "bg-violet-400 text-slate-950" : "bg-slate-800 text-slate-200"}`}>{label}</button>)}
    </section>

    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <CompactMultiSelect label="JUGADORES" allLabel="TODOS LOS JUGADORES" values={filters.playerIds} options={playerOptions} onChange={(values) => updateFilter("playerIds", values)}/>
        <CompactMultiSelect label="PARTIDOS" allLabel="TODOS LOS PARTIDOS" values={filters.matchIds} options={matchOptions} onChange={(values) => updateFilter("matchIds", values)}/>
        <CompactMultiSelect label="RIVALES" allLabel="TODOS LOS RIVALES" values={filters.rivals} options={rivals.map(([value, label]) => option(value, label))} onChange={(values) => updateFilter("rivals", values)}/>
        <CompactMultiSelect label="EVENTOS" allLabel="TODOS LOS EVENTOS" values={filters.eventKinds} options={EVENT_FILTERS.map(([value, label]) => option(value, label))} onChange={(values) => updateFilter("eventKinds", values as VideoLibraryEventKind[])}/>
        <CompactMultiSelect label="FASES" allLabel="TODAS LAS FASES" values={filters.phases} options={DASHBOARD_PHASES.map((value) => option(value, phaseLabel(value)))} onChange={(values) => updateFilter("phases", values as VideoLibraryFilters["phases"])}/>
        <CompactMultiSelect label="RESULTADO" allLabel="TODOS LOS RESULTADOS" values={filters.outcomes} options={outcomes.map((value) => option(value, OUTCOME_LABELS[value]))} onChange={(values) => updateFilter("outcomes", values as VideoLibraryFilters["outcomes"])}/>
        <CompactMultiSelect label="ETIQUETAS" allLabel="TODAS LAS ETIQUETAS" values={filters.tags} options={tags.map((value) => option(value))} onChange={(values) => updateFilter("tags", values)}/>
        <CompactMultiSelect label="TEMÁTICA" allLabel="TODAS LAS TEMÁTICAS" values={filters.themes} options={categories.map((value) => option(value))} onChange={(values) => updateFilter("themes", values)}/>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Lado del evento" className="flex min-h-11 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 p-1">
          {(["ALL", "FOR", "AGAINST"] as const).map((side) => <button key={side} type="button" aria-pressed={filters.side === side} onClick={() => updateFilter("side", side)} className={`min-h-9 rounded-lg px-3 text-[10px] font-black ${filters.side === side ? side === "FOR" ? "bg-cyan-400 text-slate-950" : side === "AGAINST" ? "bg-rose-400 text-slate-950" : "bg-slate-600 text-white" : "text-slate-400"}`}>{side === "ALL" ? "TODOS" : side === "FOR" ? "CDA" : "RIVAL"}</button>)}
        </div>
        <button type="button" role="switch" aria-checked={filters.verifiedOnly} onClick={() => updateFilter("verifiedOnly", !filters.verifiedOnly)} className={`min-h-11 rounded-xl px-4 text-xs font-black ${filters.verifiedOnly ? "bg-emerald-400 text-slate-950" : "bg-slate-800"}`}>SOLO VERIFICADOS · {filters.verifiedOnly ? "ON" : "OFF"}</button>
        <button type="button" onClick={clearFilters} className="min-h-11 rounded-xl border border-slate-700 px-4 text-xs font-black text-slate-300">LIMPIAR FILTROS</button>
        {canWrite && tags.length > 0 && <button type="button" onClick={() => setManageTags((current) => !current)} className="min-h-11 rounded-xl bg-violet-950 px-4 text-xs font-black text-violet-200">GESTIONAR ETIQUETAS</button>}
      </div>
      <details className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-2">
        <summary className="cursor-pointer px-2 py-2 text-xs font-black text-slate-300">FILTROS AVANZADOS</summary>
        <div className="grid gap-2 p-1 pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <CompactMultiSelect label="TEMPORADAS" allLabel="TODAS LAS TEMPORADAS" values={filters.seasonIds} options={seasons.map((value) => option(value, workspace?.seasons.find((season) => season.seasonId === value)?.label ?? value))} onChange={(values) => updateFilter("seasonIds", values)}/>
          <CompactMultiSelect label="PERIODO" allLabel="P1 + P2" values={filters.periods.map(String)} options={[option("1", "P1"), option("2", "P2")]} onChange={(values) => updateFilter("periods", values.map(Number))}/>
          <CompactMultiSelect label="LOCAL / VISITANTE" allLabel="TODAS LAS SEDES" values={filters.venues} options={[option("HOME", "LOCAL"), option("AWAY", "VISITANTE")]} onChange={(values) => updateFilter("venues", values as VideoLibraryFilters["venues"])}/>
          <CompactMultiSelect label="COMPETICIÓN" allLabel="TODAS LAS COMPETICIONES" values={filters.competitions} options={competitions.map((value) => option(value, value === "LEAGUE" ? "LIGA" : value === "CUP" ? "COPA" : value === "FRIENDLY" ? "AMISTOSO" : value === "OTHER" ? "OTRA" : "SIN CLASIFICAR"))} onChange={(values) => updateFilter("competitions", values as VideoLibraryFilters["competitions"])}/>
          <CompactMultiSelect label="JORNADAS" allLabel="TODAS LAS JORNADAS" values={filters.matchdays.map(String)} options={matchdays.map((value) => option(String(value), `J${value}`))} onChange={(values) => updateFilter("matchdays", values.map(Number))}/>
          {goalkeeperOptions.length > 0 && <CompactMultiSelect label="PORTEROS" allLabel="TODOS LOS PORTEROS" values={filters.goalkeeperIds} options={goalkeeperOptions} onChange={(values) => updateFilter("goalkeeperIds", values)}/>}
          <CompactMultiSelect label="ZONA DE PISTA" allLabel="TODAS LAS ZONAS" values={filters.originZones} options={(["Z1", "Z2", "Z3", "Z4", "Z5", "Z6"] as PitchOriginZone[]).map((value) => option(value))} onChange={(values) => updateFilter("originZones", values as VideoLibraryFilters["originZones"])}/>
          <CompactMultiSelect label="ZONA DE PORTERÍA" allLabel="TODA LA PORTERÍA" values={filters.targetZones} options={["LEFT_HIGH", "CENTER_HIGH", "RIGHT_HIGH", "LEFT_LOW", "CENTER_LOW", "RIGHT_LOW"].map((value) => option(value, value.replace("_", " · ")))} onChange={(values) => updateFilter("targetZones", values as VideoLibraryFilters["targetZones"])}/>
          {feet.length > 0 && <CompactMultiSelect
            label="PIE"
            allLabel="CUALQUIER PIE"
            values={filters.dominantFeet}
            options={feet.map((value) => option(value, value === "LEFT" ? "IZQUIERDO" : value === "RIGHT" ? "DERECHO" : "AMBOS"))}
            onChange={(values) => updateFilter("dominantFeet", values as VideoLibraryFilters["dominantFeet"])}
          />}
        </div>
      </details>
      {manageTags && canWrite && <div className="mt-3 rounded-2xl border border-violet-900 bg-slate-950 p-3"><div className="mb-2 flex items-center justify-between"><div><strong className="text-xs">GESTIONAR ETIQUETAS</strong><p className="text-[10px] text-slate-500">Renombrar fusiona duplicados. Eliminar solo retira la etiqueta.</p></div><button type="button" onClick={() => setManageTags(false)} className="rounded-lg px-3 py-2 text-xs">✕</button></div><div className="grid gap-2 sm:grid-cols-2">{tags.map((tag) => <div key={tag} className="rounded-xl bg-slate-900 p-2"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-black">{tag}</span><span className="text-[9px] text-slate-500">{videoTagUsage(allClips, tag)} usos</span></div><div className="mt-2 flex gap-2"><input aria-label={`Nuevo nombre para ${tag}`} value={tagDrafts[tag] ?? ""} onChange={(event) => setTagDrafts((current) => ({ ...current, [tag]: event.target.value }))} placeholder="Nuevo nombre" className="min-h-10 min-w-0 flex-1 rounded-lg bg-slate-800 px-3 text-xs"/><button type="button" onClick={() => renameTag(tag)} className="rounded-lg bg-cyan-950 px-3 text-[9px] font-black text-cyan-200">RENOMBRAR</button><button type="button" onClick={() => deleteTag(tag)} className="rounded-lg bg-rose-950 px-3 text-[9px] font-black text-rose-200">ELIMINAR</button></div></div>)}</div></div>}
    </section></>}

    {!ready ? <p className="p-10 text-center text-slate-500">Preparando vídeos…</p> : !active ? <section className="rounded-3xl border border-dashed border-slate-700 p-10 text-center"><strong>Sin vídeos para esta combinación</strong><p className="mt-2 text-sm text-slate-500">Retira un filtro o verifica la calibración del partido.</p></section> : <div className="grid gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(340px,.85fr)]">
      <section ref={reelContainerRef} className={cinemaMode ? "fixed inset-0 z-[200] flex h-screen w-screen flex-col overflow-hidden bg-black p-2 text-white sm:p-3" : "rounded-3xl border border-slate-800 bg-slate-900 p-3"}>
        {cinemaMode && <header className="flex shrink-0 items-center justify-between gap-3 pb-2">
          <div className="min-w-0"><p className="truncate text-sm font-black">{labelFor(active)}</p><p className="truncate text-[10px] text-slate-400">{activePlayerNames.length ? `${activePlayerNames.join(" · ")} · ` : ""}{active.opponent} · {active.date}</p></div>
          <div className="flex shrink-0 items-center gap-2"><span className="rounded-full bg-slate-900 px-3 py-2 font-mono text-xs font-black text-cyan-300">{selected + 1} / {items.length}</span><button type="button" onClick={leaveFullscreen} className="min-h-11 rounded-xl bg-slate-800 px-4 text-xs font-black">SALIR ✕</button></div>
        </header>}
        <div className={cinemaMode ? "min-h-0 flex-1" : ""}><YouTubeLabPlayer ref={playerRef} videoId={active.videoId} initialSecond={active.startSecond} autoPlay={reel || autoPlaySelection} onPlayingChange={(value) => { setPlaying(value); if (value) setAutoplayBlocked(false); }} onTimeChange={onTimeChange} onAutoplayBlocked={() => setAutoplayBlocked(true)} presentation={cinemaMode ? "REEL" : "LAB"}/></div>
        <div className={`grid shrink-0 grid-cols-2 gap-2 ${cinemaMode ? "pt-2 sm:grid-cols-5" : canWrite ? "mt-3 sm:grid-cols-6" : "mt-3 sm:grid-cols-5"}`}>
          <button type="button" onClick={() => move(-1)} className="min-h-12 rounded-xl bg-slate-800 text-xs font-black">← ANTERIOR</button>
          <button type="button" onClick={() => move(1)} className="min-h-12 rounded-xl bg-slate-800 text-xs font-black">SIGUIENTE →</button>
          <button type="button" onClick={() => { const next = !reel; setReel(next); setAutoPlaySelection(next); setReelFinished(false); if (next) playerRef.current?.play(); else playerRef.current?.pause(); }} className={`min-h-12 rounded-xl text-xs font-black ${reel ? "bg-amber-400 text-slate-950" : "bg-cyan-400 text-slate-950"}`}>{reel ? "Ⅱ PAUSA REEL" : "▶ REPRODUCIR REEL"}</button>
          {!cinemaMode ? <button type="button" onClick={startFullscreenReel} className="min-h-12 rounded-xl bg-violet-400 px-3 text-xs font-black text-slate-950">⛶ PANTALLA COMPLETA</button> : <span className="grid min-h-12 place-items-center rounded-xl bg-slate-900 font-mono text-xs text-cyan-300">{selected + 1} / {items.length}</span>}
          <span className="col-span-2 grid min-h-12 place-items-center rounded-xl bg-slate-950 font-mono text-xs text-cyan-300 sm:col-span-1">{formatVideoTimestamp(active.startSecond)}–{formatVideoTimestamp(active.endSecond)}</span>
          {writeActions.canAdd && !cinemaMode && <button type="button" onClick={addAtCurrentSecond} className="col-span-2 min-h-12 rounded-xl bg-amber-400 px-3 text-xs font-black text-slate-950 sm:col-span-1">+ AÑADIR</button>}
        </div>
        {autoplayBlocked && <p role="status" className="mt-2 rounded-xl bg-amber-950 px-3 py-2 text-center text-xs font-bold text-amber-200">El navegador ha bloqueado el autoplay. Pulsa ▶ para continuar el reel.</p>}
        {reelFinished && <div role="status" className={`${cinemaMode ? "absolute inset-0 z-10 grid place-items-center bg-black/75" : "mt-3"}`}><div className="rounded-3xl border border-cyan-400/50 bg-slate-950 p-6 text-center shadow-2xl"><p className="text-sm font-black tracking-[.18em] text-cyan-300">FIN DEL REEL</p><div className="mt-4 flex flex-wrap justify-center gap-2"><button type="button" onClick={restartReel} className="min-h-12 rounded-xl bg-cyan-400 px-5 text-xs font-black text-slate-950">↺ VOLVER AL PRIMERO</button>{cinemaMode && <button type="button" onClick={leaveFullscreen} className="min-h-12 rounded-xl bg-slate-800 px-5 text-xs font-black">SALIR</button>}</div></div></div>}
        {fullscreenFallback && <p className="mt-2 text-center text-[10px] font-bold text-amber-300">Pantalla completa no disponible; el reel continúa en modo cine.</p>}
        {!cinemaMode && <><p className="mt-2 text-center text-[10px] font-bold text-slate-500">← / → · ANTERIOR / SIGUIENTE &nbsp;·&nbsp; ESPACIO · PLAY / PAUSA</p><article className="mt-3 rounded-2xl bg-slate-950 p-4"><div className="flex items-start justify-between gap-3"><div><span className={`text-[9px] font-black ${active.source === "EVENT" ? "text-cyan-300" : "text-violet-300"}`}>{active.source === "EVENT" ? "EVENTO DEPORTIVO" : "CLIP DE ANÁLISIS"}</span><h2 className="text-xl font-black">{labelFor(active)}</h2><p className="text-xs text-slate-400">{active.opponent} · {active.date}</p></div><span className={`rounded-full px-3 py-2 text-[10px] font-black ${active.verified ? "bg-emerald-950 text-emerald-300" : "bg-amber-950 text-amber-300"}`}>{active.verified ? "VERIFIED" : "AUTO"}</span></div>{active.source === "EVENT" ? <p className="mt-2 text-sm text-slate-300">P{active.event.period} · min {active.event.minute} · {eventDescription(active.event, visibleRecords.find((record) => record.catalog.matchId === active.matchId)?.session.players ?? [])}</p> : <><p className="mt-2 text-sm text-slate-300">{active.clip.tags.join(" · ") || "Sin etiquetas"}</p>{active.clip.comment && <p className="mt-2 text-sm text-slate-400">{active.clip.comment}</p>}</>} {writeActions.canEdit && <div className="mt-3 flex flex-wrap gap-2"><Link href={editHref} className="inline-grid min-h-11 place-items-center rounded-xl bg-violet-500 px-4 text-xs font-black text-slate-950">EDITAR</Link>{active.source === "CLIP" && <button type="button" onClick={() => { if (window.confirm("¿Eliminar este clip de análisis?")) { ensureMatch(active.matchId); window.setTimeout(() => { removeClip(active.matchId, active.clip.id); setRecords(readLocalRecords()); }, 0); } }} className="min-h-11 rounded-xl bg-rose-950 px-4 text-xs font-black text-rose-200">ELIMINAR</button>}</div>}</article></>}
      </section>
      {!cinemaMode && <section className="max-h-[75vh] space-y-2 overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-2">{items.map((item, index) => <button ref={(node) => { itemRefs.current[item.key] = node; }} key={item.key} type="button" onClick={() => { setSelected(index); setReel(false); setAutoPlaySelection(false); setReelFinished(false); }} className={`w-full rounded-2xl border p-3 text-left ${index === selected ? "border-cyan-400 bg-cyan-950/30" : "border-transparent bg-slate-950"}`}><div className="flex justify-between gap-2"><strong className="truncate text-sm">{labelFor(item)}</strong><span className="font-mono text-[10px] text-cyan-300">{formatVideoTimestamp(item.startSecond)}</span></div><p className="mt-1 text-[10px] text-slate-400">{item.opponent} · {item.date}</p><div className="mt-2 flex gap-2"><span className={`rounded-full px-2 py-1 text-[9px] font-black ${item.source === "EVENT" ? "bg-cyan-950 text-cyan-300" : "bg-violet-950 text-violet-300"}`}>{item.source}</span><span className={`rounded-full px-2 py-1 text-[9px] font-black ${item.verified ? "bg-emerald-950 text-emerald-300" : "bg-amber-950 text-amber-300"}`}>{item.verified ? "VERIFIED" : "AUTO"}</span></div></button>)}</section>}
    </div>}
  </main></div>;
}

export default function VideoLibraryPage() {
  return <Suspense fallback={<div className="grid min-h-screen place-items-center bg-slate-950 text-slate-400">Preparando Biblioteca Video…</div>}><VideoLibraryContent/></Suspense>;
}
