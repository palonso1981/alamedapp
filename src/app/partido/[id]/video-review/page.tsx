"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "../../../../components/app/AppHeader";
import { useAccess } from "../../../../components/access/AccessProvider";
import { EventEditor } from "../../../../components/match/EventEditor";
import { SecondPeriodLineupDialog } from "../../../../components/match/SecondPeriodLineupDialog";
import { SyncStatusBadge } from "../../../../components/match/SyncStatusBadge";
import { VideoClipComposer } from "../../../../components/video/VideoClipComposer";
import { VideoReviewEventComposer } from "../../../../components/video/VideoReviewEventComposer";
import { VideoReviewPlayer, VideoReviewPlayerHandle } from "../../../../components/video/VideoReviewPlayer";
import { eventDescription } from "../../../../lib/eventPresentation";
import { buildDashboardFixture } from "../../../../lib/dashboardFixture";
import { replayMatch, sortEvents } from "../../../../lib/matchEngine";
import { upsertVideoEventOverride } from "../../../../lib/videoIndex";
import { buildVideoLabSyncSegments } from "../../../../lib/videoLab";
import { formatPreciseVideoTime, inspectVideoReviewWorkspace, preciseVideoSecond, replayVideoReviewAt, shiftPreciseVideoSecond, videoReviewReferenceAtOrBefore } from "../../../../lib/videoReviewWorkspace";
import { useMatchStore } from "../../../../store/useMatchStore";
import { MatchEvent } from "../../../../types";

export default function VideoReviewWorkspacePage() {
  const { id: matchId } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const { canWrite } = useAccess();
  const storedSession = useMatchStore((state) => state.matches[matchId]);
  const fixtureSession = useMemo(() =>
    process.env.NODE_ENV !== "production" && searchParams.get("fixture") === "1"
      ? buildDashboardFixture().find((record) => record.catalog.matchId === matchId)?.session
      : undefined,
  [matchId, searchParams]);
  const session = fixtureSession ?? storedSession;
  const workspaceCanWrite = canWrite && !fixtureSession;
  const ensureMatch = useMatchStore((state) => state.ensureMatch);
  const initializeLineup = useMatchStore((state) => state.initializeVideoReviewLineup);
  const addEvent = useMatchStore((state) => state.addVideoReviewEvent);
  const editEvent = useMatchStore((state) => state.editAndReorderEvent);
  const deleteEvent = useMatchStore((state) => state.softDeleteEvent);
  const restoreEvent = useMatchStore((state) => state.restoreEvent);
  const setOverrides = useMatchStore((state) => state.setVideoEventOverrides);
  const upsertClip = useMatchStore((state) => state.upsertVideoAnalysisClip);
  const playerRef = useRef<VideoReviewPlayerHandle>(null);
  const [segmentId, setSegmentId] = useState("");
  const [period, setPeriod] = useState(1);
  const [minute, setMinute] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [composerAnchor, setComposerAnchor] = useState<number | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [clipOpen, setClipOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [lineupOpen, setLineupOpen] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [anchorDraft, setAnchorDraft] = useState<number | null>(null);

  useEffect(() => { if (!fixtureSession) ensureMatch(matchId); }, [ensureMatch, fixtureSession, matchId]);
  const segments = useMemo(() => session?.videoSegments ?? [], [session?.videoSegments]);
  useEffect(() => { if (!segments.some((segment) => segment.id === segmentId)) setSegmentId(segments[0]?.id ?? ""); }, [segmentId, segments]);
  const segment = segments.find((candidate) => candidate.id === segmentId);
  const state = session ? inspectVideoReviewWorkspace(session) : undefined;
  const orderedEvents = useMemo(() => session ? sortEvents(session.events).filter((event) => event.type !== "lineup_initialized") : [], [session]);
  useEffect(() => { if (orderedEvents.length > 0) setTimelineOpen(true); }, [orderedEvents.length]);
  useEffect(() => { if (state && !state.hasInitialLineup && state.hasSquad && workspaceCanWrite) setLineupOpen(true); }, [state, workspaceCanWrite]);
  useEffect(() => {
    if (!draftDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draftDirty]);

  const selectedEvent = session?.events.find((event) => event.id === selectedEventId);
  const selectedOverride = session?.videoEventOverrides?.find((override) => override.eventId === selectedEventId);
  const editingEvent = session?.events.find((event) => event.id === editingEventId);
  const fullReplay = useMemo(() => session ? replayMatch(session.players, session.events) : undefined, [session]);
  const positionReplay = useMemo(() => session ? replayVideoReviewAt(session, period, minute) : undefined, [minute, period, session]);
  const editingEntry = useMemo(() => editingEvent && fullReplay?.timeline.find((entry) => entry.event.id === editingEvent.id), [editingEvent, fullReplay?.timeline]);
  const logicalSegment = useMemo(() => session && segment
    ? buildVideoLabSyncSegments(session).find((candidate) => candidate.physicalSegmentId === segment.id && candidate.period === period)
    : undefined, [period, segment, session]);
  const currentReference = session ? videoReviewReferenceAtOrBefore(session, period, minute) : undefined;
  const positionGoalkeeper = positionReplay?.lineupValidation.goalkeeper;
  const positionGoalkeeperName = positionGoalkeeper?.status === "PLAYER"
    ? session.players.find((player) => player.id === positionGoalkeeper.playerId)?.name
    : "pendiente";
  useEffect(() => {
    if (!selectedOverride || selectedOverride.segmentId !== segmentId) return;
    const lead = segments.find((candidate) => candidate.id === selectedOverride.segmentId)?.leadSeconds ?? 6;
    const timer = window.setTimeout(() => playerRef.current?.seekTo(Math.max(0, selectedOverride.videoSecond - lead)), 80);
    return () => window.clearTimeout(timer);
  }, [segmentId, segments, selectedOverride]);

  const guardDraft = useCallback(() => !draftDirty || window.confirm("Hay un evento sin guardar. ¿Descartarlo y continuar?"), [draftDirty]);
  const chooseSegment = (nextId: string) => {
    if (!guardDraft()) return;
    const next = segments.find((candidate) => candidate.id === nextId);
    setComposerAnchor(null); setDraftDirty(false); setSegmentId(nextId);
    if (next && !next.periods.includes(period as 1 | 2)) setPeriod(next.periods[0] ?? 1);
  };
  const chooseEvent = (event: MatchEvent) => {
    if (!guardDraft()) return;
    setComposerAnchor(null); setDraftDirty(false); setSelectedEventId(event.id); setPeriod(event.period); setMinute(event.minute);
    const override = session?.videoEventOverrides?.find((item) => item.eventId === event.id);
    setAnchorDraft(override?.videoSecond ?? null);
    if (override) {
      if (segments.some((candidate) => candidate.id === override.segmentId)) setSegmentId(override.segmentId);
      if (override.segmentId === segmentId) playerRef.current?.seekTo(Math.max(0, override.videoSecond - (segments.find((candidate) => candidate.id === override.segmentId)?.leadSeconds ?? 6)));
    }
  };
  const startComposer = () => {
    if (!workspaceCanWrite || !segment || !state?.hasInitialLineup) return;
    const exact = preciseVideoSecond(playerRef.current?.currentTime() ?? 0);
    setComposerAnchor(exact); setDraftDirty(true); setClipOpen(false);
  };
  const saveExistingAnchor = () => {
    if (!session || !segment || !selectedEvent || anchorDraft === null || !workspaceCanWrite) return;
    try {
      const next = upsertVideoEventOverride(session, { eventId: selectedEvent.id, segmentId: segment.id, syncSegmentId: `${segment.id}:P${selectedEvent.period}`, videoSecond: preciseVideoSecond(anchorDraft), status: "VERIFIED", timeSource: "manual" });
      setOverrides(matchId, next.videoEventOverrides ?? []);
    } catch { /* La store conserva el error de persistencia; la incompatibilidad de periodo se muestra deshabilitando la acción. */ }
  };

  if (!session) return <div className="grid min-h-screen place-items-center bg-slate-950 text-white">Preparando revisión desde vídeo…</div>;
  if (segments.length === 0) return <div className="min-h-screen bg-slate-950 text-white"><AppHeader title="Revisión desde vídeo" clubId={session.preparation?.clubId} /><main className="mx-auto max-w-3xl p-5"><section className="rounded-3xl border border-dashed border-slate-700 bg-slate-900 p-10 text-center"><h1 className="text-xl font-black">Primero asocia un vídeo al partido</h1><p className="mt-2 text-sm text-slate-400">Se reutiliza la configuración audiovisual existente; no se crea otro uploader.</p><Link href={`/partidos/${matchId}/video`} className="mt-5 inline-grid min-h-12 place-items-center rounded-xl bg-cyan-400 px-5 font-black text-slate-950">CONFIGURAR VÍDEO</Link></section></main></div>;

  return <div className="min-h-screen overflow-x-hidden bg-slate-950 text-white">
    <AppHeader title="Revisión / registro desde vídeo" clubId={session.preparation?.clubId} actions={<SyncStatusBadge matchId={matchId} />} />
    <main className="mx-auto max-w-[1680px] space-y-3 p-3 sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-3"><div><p className="text-[10px] font-black tracking-[.18em] text-violet-300">MISMA CRONOLOGÍA CANÓNICA · EDITOR VÍDEO</p><h1 className="text-xl font-black">{session.preparation?.opponent ?? matchId}</h1><p className="text-xs text-slate-400">{state?.mode === "EMPTY" ? "Falta quinteto inicial" : state?.mode === "LINEUP_ONLY" ? "Quinteto preparado · sin acciones" : `${state?.sportsEventCount ?? 0} registros deportivos`}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setTimelineOpen((value) => !value)} className="min-h-11 rounded-xl bg-slate-800 px-4 text-xs font-black">{timelineOpen ? "OCULTAR" : "ABRIR"} CRONOLOGÍA</button><Link href={`/partido/${matchId}/video-lab`} className="inline-grid min-h-11 place-items-center rounded-xl bg-slate-800 px-4 text-xs font-black">VIDEO LAB</Link></div></header>
      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Partes de vídeo">{segments.map((item) => <button key={item.id} type="button" onClick={() => chooseSegment(item.id)} className={`min-h-11 shrink-0 rounded-xl px-4 text-xs font-black ${item.id === segmentId ? "bg-violet-400 text-slate-950" : "bg-slate-800"}`}>{item.label} · {item.periods.map((value) => `P${value}`).join("+")}</button>)}</nav>
      {segment && <div className={`grid gap-3 ${timelineOpen ? "xl:grid-cols-[minmax(0,1fr)_360px]" : "grid-cols-1"}`}>
        <div className="min-w-0 space-y-3">
          <VideoReviewPlayer ref={playerRef} matchId={matchId} videoId={segment.videoId} label={segment.label} />
          <section className="grid gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-3 sm:grid-cols-[120px_160px_1fr]">
            <label className="text-[10px] font-black text-slate-400">PERIODO<select value={period} onChange={(event) => setPeriod(Number(event.target.value))} className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-sm"><option value={1}>P1</option><option value={2}>P2</option></select></label>
            <label className="text-[10px] font-black text-slate-400">MINUTO DE PARTIDO<input type="number" min={0} max={20} value={minute} onChange={(event) => setMinute(Math.max(0, Math.min(20, Number(event.target.value))))} className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-sm" /></label>
            <div className="flex flex-wrap items-end gap-2"><div className="min-w-0 flex-1"><p className="text-[10px] font-black text-slate-400">ESTADO OPERATIVO EN ESE PUNTO</p><p className="mt-1 truncate text-sm font-black">{positionReplay?.onCourtPlayerIds.map((id) => session.players.find((player) => player.id === id)?.name ?? id).join(" · ") || "Sin quinteto"}</p><p className="text-[10px] text-slate-500">Portero: {positionGoalkeeperName} · Marcador {positionReplay?.score.for ?? 0}–{positionReplay?.score.against ?? 0}</p></div>{workspaceCanWrite && <button type="button" disabled={!state?.hasInitialLineup} onClick={startComposer} className="min-h-12 rounded-xl bg-cyan-400 px-5 text-sm font-black text-slate-950 disabled:opacity-40">+ REGISTRAR EVENTO</button>}</div>
          </section>
          {!state?.hasInitialLineup && <section className="rounded-2xl border border-amber-600 bg-amber-950/30 p-4"><h2 className="font-black text-amber-200">Configura el quinteto inicial antes de registrar</h2><p className="mt-1 text-xs text-amber-300">La convocatoria se conserva; se crea el mismo evento canónico de alineación que usa Directo.</p>{workspaceCanWrite && <button type="button" onClick={() => setLineupOpen(true)} className="mt-3 min-h-12 rounded-xl bg-amber-400 px-5 font-black text-slate-950">CONFIGURAR QUINTETO</button>}</section>}
          {composerAnchor !== null && <VideoReviewEventComposer session={session} segment={segment} initialPeriod={period} initialMinute={minute} initialVideoSecond={composerAnchor} referenceEventId={selectedEvent?.id ?? currentReference?.id} readCurrentTime={() => playerRef.current?.currentTime() ?? composerAnchor} onSeek={(second) => playerRef.current?.seekTo(second)} onDirtyChange={setDraftDirty} onSave={(creation) => { addEvent(matchId, creation); setSelectedEventId(creation.event.id); setAnchorDraft(creation.override.videoSecond); setComposerAnchor(null); setDraftDirty(false); }} onCancel={() => { setComposerAnchor(null); setDraftDirty(false); }} />}
          {selectedEvent && <section className="rounded-2xl border border-slate-700 bg-slate-900 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black tracking-[.16em] text-slate-500">EVENTO SELECCIONADO · {selectedEvent.provenance}</p><h2 className="font-black">P{selectedEvent.period} · min {selectedEvent.minute} · {eventDescription(selectedEvent, session.players, undefined, session.staff)}</h2><p className="text-xs text-slate-400">{selectedOverride ? `${selectedOverride.status ?? "VERIFIED"} · ${segments.find((item) => item.id === selectedOverride.segmentId)?.label ?? selectedOverride.segmentId} · ${formatPreciseVideoTime(selectedOverride.videoSecond)}` : "Sin vínculo de vídeo confirmado"}</p></div>{workspaceCanWrite && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setEditingEventId(selectedEvent.id)} className="min-h-11 rounded-xl bg-cyan-700 px-3 text-xs font-black">EDITAR DEPORTIVO</button><button type="button" onClick={() => { if (window.confirm("¿Eliminar este evento? Se conservará su tombstone.")) deleteEvent(matchId, selectedEvent.id); }} className="min-h-11 rounded-xl bg-rose-950 px-3 text-xs font-black text-rose-200">ELIMINAR</button>{selectedEvent.deletedAt !== null && <button type="button" onClick={() => restoreEvent(matchId, selectedEvent.id)} className="min-h-11 rounded-xl bg-emerald-800 px-3 text-xs font-black">RESTAURAR</button>}</div>}</div>
            {workspaceCanWrite && <div className="mt-3 rounded-xl bg-slate-950 p-3"><p className="text-[10px] font-black text-violet-300">ANCHOR AUDIOVISUAL · no modifica el evento deportivo</p><div className="mt-2 flex flex-wrap gap-1">{([-5, -1, 1, 5] as const).map((delta) => <button key={delta} type="button" disabled={anchorDraft === null} onClick={() => { const next = shiftPreciseVideoSecond(anchorDraft ?? 0, delta); setAnchorDraft(next); playerRef.current?.seekTo(next); }} className="min-h-11 rounded-xl bg-slate-800 px-3 font-black disabled:opacity-40">{delta > 0 ? `+${delta}` : delta}</button>)}<span className="grid min-h-11 place-items-center rounded-xl bg-slate-900 px-3 font-mono font-black text-cyan-200">{anchorDraft === null ? "SIN ANCLA" : formatPreciseVideoTime(anchorDraft)}</span><button type="button" onClick={() => { const next = preciseVideoSecond(playerRef.current?.currentTime() ?? 0); setAnchorDraft(next); }} className="min-h-11 rounded-xl bg-violet-500 px-3 text-xs font-black text-slate-950">USAR POSICIÓN ACTUAL</button><button type="button" disabled={anchorDraft === null || !segment.periods.includes(selectedEvent.period as 1 | 2)} onClick={saveExistingAnchor} className="min-h-11 rounded-xl bg-emerald-400 px-3 text-xs font-black text-slate-950 disabled:opacity-40">GUARDAR / VERIFICAR</button>{logicalSegment && <button type="button" onClick={() => setClipOpen((value) => !value)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black">+ CLIP</button>}</div></div>}
            {clipOpen && logicalSegment && <div className="mt-3"><VideoClipComposer session={session} segment={logicalSegment} currentSecond={() => playerRef.current?.currentTime() ?? 0} onSave={(clip) => { upsertClip(matchId, clip); setClipOpen(false); }} onCancel={() => setClipOpen(false)} /></div>}
          </section>}
          {(fullReplay?.issues.length ?? 0) > 0 && <details className="rounded-2xl border border-amber-800 bg-amber-950/30 p-3"><summary className="cursor-pointer text-sm font-black text-amber-200">{fullReplay?.issues.length} ADVERTENCIAS DE CRONOLOGÍA · no se corrige nada automáticamente</summary><ul className="mt-2 space-y-1 text-xs text-amber-100">{fullReplay?.issues.map((issue) => <li key={`${issue.eventId}-${issue.code}`}>{issue.code} · {issue.message}</li>)}</ul></details>}
        </div>
        {timelineOpen && <aside className="fixed inset-y-0 right-0 z-50 flex w-[min(92vw,380px)] flex-col border-l border-slate-700 bg-slate-900 shadow-2xl xl:static xl:z-auto xl:max-h-[calc(100vh-7rem)] xl:w-auto xl:rounded-3xl xl:border"><header className="flex items-center justify-between border-b border-slate-800 p-3"><div><p className="text-[10px] font-black text-slate-500">CRONOLOGÍA CANÓNICA</p><p className="font-black">{orderedEvents.length} registros</p></div><button type="button" onClick={() => setTimelineOpen(false)} className="min-h-11 min-w-11 rounded-xl bg-slate-800 text-xl">×</button></header><div className="flex-1 space-y-1 overflow-y-auto p-2">{orderedEvents.length === 0 ? <p className="p-5 text-center text-sm text-slate-500">Todavía no hay acciones.</p> : orderedEvents.map((event) => { const override = session.videoEventOverrides?.find((item) => item.eventId === event.id); return <button key={event.id} type="button" onClick={() => chooseEvent(event)} className={`grid min-h-14 w-full grid-cols-[54px_1fr_auto] items-center gap-2 rounded-xl border p-2 text-left ${selectedEventId === event.id ? "border-cyan-300 bg-cyan-950/40" : event.deletedAt !== null ? "border-rose-950 bg-rose-950/20 opacity-60" : "border-transparent bg-slate-950"}`}><span className="text-center text-[10px] font-black text-slate-400">P{event.period}<br />min {event.minute}</span><span className="min-w-0"><span className="block truncate text-xs font-bold">{eventDescription(event, session.players, undefined, session.staff)}</span><span className="block truncate text-[9px] font-black text-slate-500">{event.provenance}{event.reviewState === "PENDING_REVIEW" ? " · ? NO COMPUTA" : ""}</span></span><span className={`text-[9px] font-black ${override ? "text-emerald-300" : "text-slate-600"}`}>{override ? "VERIFIED" : "SIN VÍDEO"}</span></button>; })}</div></aside>}
      </div>}
    </main>
    {lineupOpen && <SecondPeriodLineupDialog players={session.players} proposedPlayerIds={session.preparation?.starterPlayerIds ?? session.players.slice(0, 5).map((player) => player.id)} proposedGoalkeeperId={session.preparation?.startingGoalkeeperId} period={1} confirmLabel="GUARDAR QUINTETO P1" onCancel={() => setLineupOpen(false)} onConfirm={(playerIds, goalkeeperId) => { initializeLineup(matchId, 1, playerIds, goalkeeperId); setLineupOpen(false); }} />}
    {editingEvent && <EventEditor event={editingEvent} events={session.events} entry={editingEntry} players={session.players} staff={session.staff} onClose={() => setEditingEventId(null)} onSave={(target, changes) => { editEvent(matchId, editingEvent.id, target, changes); setEditingEventId(null); }} />}
  </div>;
}
