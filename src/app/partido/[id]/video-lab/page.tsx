"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "../../../../components/app/AppHeader";
import { YouTubeLabPlayer, YouTubeLabPlayerHandle } from "../../../../components/video/YouTubeLabPlayer";
import { eventDescription } from "../../../../lib/eventPresentation";
import { buildDashboardFixture } from "../../../../lib/dashboardFixture";
import { formatVideoTimestamp } from "../../../../lib/videoIndex";
import {
  buildVideoLabSyncSegments,
  buildVideoLabTimeline,
  currentVideoLabRow,
  verifyVideoLabEvent,
  VideoLabVerificationMap,
  videoLabSeekSecond,
} from "../../../../lib/videoLab";
import { useMatchStore } from "../../../../store/useMatchStore";

export default function VideoLabPage() {
  const { id: matchId } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const storedSession = useMatchStore((state) => state.matches[matchId]);
  const fixtureSession = useMemo(() =>
    process.env.NODE_ENV !== "production" && searchParams.get("fixture") === "1"
      ? buildDashboardFixture().find((record) => record.catalog.matchId === matchId)?.session
      : undefined,
  [matchId, searchParams]);
  const session = fixtureSession ?? storedSession;
  const ensureMatch = useMatchStore((state) => state.ensureMatch);
  const playerRef = useRef<YouTubeLabPlayerHandle>(null);
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const timelineRef = useRef<HTMLDivElement>(null);
  const [segmentId, setSegmentId] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [currentSecond, setCurrentSecond] = useState(0);
  const [followVideo, setFollowVideo] = useState(true);
  const [verifications, setVerifications] = useState<VideoLabVerificationMap>({});

  useEffect(() => { if (!fixtureSession) ensureMatch(matchId); }, [ensureMatch, fixtureSession, matchId]);
  const segments = useMemo(() => session ? buildVideoLabSyncSegments(session) : [], [session]);
  useEffect(() => {
    if (!segments.some((segment) => segment.id === segmentId)) setSegmentId(segments[0]?.id ?? "");
  }, [segmentId, segments]);
  const rows = useMemo(() => session ? buildVideoLabTimeline(session, verifications) : [], [session, verifications]);
  const segment = segments.find((candidate) => candidate.id === segmentId);
  const segmentRows = rows.filter((row) => row.syncSegmentId === segmentId);
  const activeRow = currentVideoLabRow(rows, segmentId, currentSecond);
  const selectedRow = rows.find((row) => row.event.id === selectedEventId) ?? activeRow;

  useEffect(() => {
    const row = activeRow ? rowRefs.current[activeRow.event.id] : null;
    const timeline = timelineRef.current;
    if (followVideo && row && timeline) {
      timeline.scrollTo({ top: Math.max(0, row.offsetTop - timeline.clientHeight / 2 + row.clientHeight / 2), behavior: "smooth" });
    }
  }, [activeRow, followVideo]);

  const handleTimeChange = useCallback((second: number) => setCurrentSecond(second), []);
  const chooseRow = (eventId: string) => {
    const row = rows.find((candidate) => candidate.event.id === eventId);
    setSelectedEventId(eventId);
    setFollowVideo(false);
    const second = row ? videoLabSeekSecond(row) : null;
    if (second !== null) playerRef.current?.seekTo(second);
  };
  const verifySelected = (videoSecond?: number) => {
    if (!selectedRow) return;
    setVerifications((current) => verifyVideoLabEvent(current, selectedRow, videoSecond));
  };
  const goNext = () => {
    if (segmentRows.length === 0) return;
    const index = segmentRows.findIndex((row) => row.event.id === selectedRow?.event.id);
    const next = segmentRows[(index + 1 + segmentRows.length) % segmentRows.length];
    chooseRow(next.event.id);
  };

  if (!session) return <div className="grid min-h-screen place-items-center bg-slate-950 text-white">Preparando Video Lab…</div>;

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-950 text-white">
      <AppHeader title="Video Lab" clubId={session.preparation?.clubId} />
      <main className="mx-auto max-w-[1500px] space-y-3 p-3 sm:p-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-3">
          <div>
            <p className="text-[10px] font-black tracking-[.2em] text-cyan-300">PROTOTIPO LOCAL · SIN CAMBIOS DE DATOS</p>
            <h1 className="text-xl font-black">{session.preparation?.opponent ?? matchId}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/partidos/${matchId}/video`} className="inline-grid min-h-11 place-items-center rounded-xl bg-slate-800 px-4 text-xs font-black">CONFIGURAR VÍDEO</Link>
            <Link href={session.matchFinished ? `/partido/${matchId}/revision` : `/partido/${matchId}/directo`} className="inline-grid min-h-11 place-items-center rounded-xl bg-slate-800 px-4 text-xs font-black">VOLVER</Link>
          </div>
        </header>

        {segments.length === 0 ? (
          <section className="rounded-3xl border border-dashed border-slate-700 p-10 text-center text-slate-400">Configura al menos un vídeo y un anchor para iniciar Video Lab.</section>
        ) : (
          <>
            <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Segmentos de sincronización">
              {segments.map((item) => <button key={item.id} type="button" onClick={() => { setSegmentId(item.id); setSelectedEventId(null); setFollowVideo(true); }} className={`min-h-11 shrink-0 rounded-xl px-4 text-xs font-black ${item.id === segmentId ? "bg-cyan-400 text-slate-950" : "bg-slate-800"}`}>{item.label}</button>)}
            </nav>
            {segment && <div className="grid gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(340px,.85fr)]">
              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-3 sm:p-4">
                <YouTubeLabPlayer ref={playerRef} videoId={segment.videoId} onTimeChange={handleTimeChange} onActionHere={(second) => verifySelected(second)} />
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <button type="button" disabled={selectedRow?.estimatedSecond === undefined} onClick={() => verifySelected()} className="min-h-12 rounded-xl bg-emerald-500 px-3 text-sm font-black text-slate-950 disabled:opacity-40">✓ CORRECTA</button>
                  <button type="button" onClick={goNext} className="min-h-12 rounded-xl bg-slate-700 px-3 text-sm font-black">SIGUIENTE →</button>
                  {!followVideo && <button type="button" onClick={() => setFollowVideo(true)} className="col-span-2 min-h-12 rounded-xl bg-cyan-400 px-3 text-sm font-black text-slate-950 sm:col-span-1">◎ SEGUIR VÍDEO</button>}
                </div>
                <p className="mt-3 text-xs text-slate-400">AUTO usa el primer anchor válido del periodo. Los anchors adicionales solo señalan coherencia o deriva; no desplazan la jugada silenciosamente.</p>
              </section>

              <section className="flex min-h-[420px] max-h-[72vh] flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
                <div className="flex items-center justify-between border-b border-slate-800 p-3">
                  <div><p className="text-[10px] font-black text-slate-500">CRONOLOGÍA INTERACTIVA</p><p className="text-sm font-black">P{segment.period} · {segmentRows.length} hitos</p></div>
                  <span className="font-mono text-sm font-black text-cyan-300">{formatVideoTimestamp(currentSecond)}</span>
                </div>
                <div ref={timelineRef} className="relative flex-1 space-y-1 overflow-y-auto p-2" onWheel={() => setFollowVideo(false)} onTouchMove={() => setFollowVideo(false)}>
                  {segmentRows.map((row) => {
                    const active = row.event.id === activeRow?.event.id;
                    const selected = row.event.id === selectedRow?.event.id;
                    const past = (row.estimatedSecond ?? Infinity) < currentSecond && !active;
                    return <button ref={(node) => { rowRefs.current[row.event.id] = node; }} key={row.event.id} type="button" onClick={() => chooseRow(row.event.id)} className={`grid min-h-14 w-full grid-cols-[52px_1fr_auto] items-center gap-2 rounded-xl border px-2 text-left transition ${selected ? "border-amber-300 bg-amber-300/10" : active ? "border-cyan-400 bg-cyan-400/10" : "border-transparent bg-slate-950/60"} ${past ? "opacity-45" : "opacity-100"}`}>
                      <span className="text-center text-[10px] font-black text-slate-400">P{row.event.period}<br />{row.event.minute}&apos;</span>
                      <span><span className="block text-xs font-bold">{eventDescription(row.event, session.players, undefined, session.staff)}</span><span className="mt-1 block text-[9px] font-black tracking-wide text-slate-500">{row.temporalFamily === "LANDMARK" ? "HITO · SIN CLIP" : row.temporalFamily === "PREPARATORY_RESTART" ? "PREPARACIÓN" : row.clipEligible ? "CLIP" : "CONTEXTO"}</span></span>
                      <span className="text-right"><span className={`block text-[9px] font-black ${row.status === "VERIFIED" ? "text-emerald-300" : "text-amber-300"}`}>{row.status}</span><span className="font-mono text-[10px] text-slate-400">{row.estimatedSecond === undefined ? "—" : formatVideoTimestamp(row.estimatedSecond)}</span>{row.diagnostic.status === "DRIFT_WARNING" && <span className="block text-[9px] font-black text-rose-300">DERIVA</span>}</span>
                    </button>;
                  })}
                </div>
              </section>
            </div>}
          </>
        )}
      </main>
    </div>
  );
}
