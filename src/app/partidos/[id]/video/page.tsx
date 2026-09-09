"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "../../../../components/app/AppHeader";
import { SyncStatusBadge } from "../../../../components/match/SyncStatusBadge";
import { eventDescription } from "../../../../lib/eventPresentation";
import { sortEvents } from "../../../../lib/matchEngine";
import { addVideoAnchor, createVideoSegment, formatVideoTimestamp, isVideoTimeResolvable, parseVideoTimestamp, parseYouTubeVideoId, removeVideoAnchor, removeVideoSegment, resolveEventVideoPosition, upsertVideoSegment } from "../../../../lib/videoIndex";
import { useMatchStore } from "../../../../store/useMatchStore";
import { MatchEvent, MatchSession, MatchVideoPeriod, MatchVideoSegment } from "../../../../types";

const captureTime = (event: MatchEvent) => new Date(event.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function MatchVideoPage() {
  const { id: matchId } = useParams<{ id: string }>();
  const session = useMatchStore((state) => state.matches[matchId]);
  const ensureMatch = useMatchStore((state) => state.ensureMatch);
  const setVideoSegments = useMatchStore((state) => state.setVideoSegments);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [coverage, setCoverage] = useState<"P1" | "P2" | "FULL">("FULL");
  const [lead, setLead] = useState(6);
  const [message, setMessage] = useState<string | null>(null);
  const fixtureOnly = matchId.startsWith("dashboard-fixture-");
  useEffect(() => { if (!fixtureOnly) ensureMatch(matchId); }, [ensureMatch, fixtureOnly, matchId]);
  const candidates = useMemo(() => session ? sortEvents(session.events).filter((event) => event.deletedAt === null && isVideoTimeResolvable(event)).sort((a, b) => Number(b.type === "threat_recorded" && b.outcome === "GOL") - Number(a.type === "threat_recorded" && a.outcome === "GOL")) : [], [session]);
  if (fixtureOnly) return <div className="grid min-h-screen place-items-center bg-slate-900 p-6 text-center text-white"><div><h1 className="text-2xl font-black">Fixture solo de lectura</h1><p className="mt-2 text-slate-400">La muestra de Dashboard vive únicamente en memoria y no puede crear datos locales ni remotos.</p><Link href="/dashboard/jugadas?fixture=1" className="mt-4 inline-grid min-h-11 place-items-center rounded-xl bg-cyan-400 px-4 font-black text-slate-950">VOLVER</Link></div></div>;
  if (!session) return <div className="grid min-h-screen place-items-center bg-slate-900 text-white">Cargando vídeo…</div>;
  const preparation = session.preparation;
  const periods: MatchVideoPeriod[] = coverage === "FULL" ? [1, 2] : [coverage === "P1" ? 1 : 2];
  const commit = (next: MatchSession) => setVideoSegments(matchId, next.videoSegments ?? []);
  function addSegment() {
    try {
      commit(upsertVideoSegment(session, createVideoSegment({ urlOrVideoId: url, label, periods, leadSeconds: lead })));
      setUrl(""); setLabel(""); setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar el vídeo."); }
  }
  return <div className="min-h-screen bg-slate-900 text-white"><AppHeader title="Vídeo del partido" clubId={preparation?.clubId} actions={<SyncStatusBadge matchId={matchId}/>} /><main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
    <section className="rounded-3xl border border-slate-700 bg-slate-800 p-5"><p className="text-[10px] font-black tracking-widest text-red-300">YOUTUBE · ÍNDICE EXTERNO</p><div className="mt-1 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-black">{preparation?.opponent ?? matchId}</h2><p className="text-xs text-slate-400">{preparation?.date ?? "Sin fecha"} · {preparation?.competition ?? preparation?.competitionType ?? "Sin competición"}</p></div><Link href={session.matchFinished ? `/partido/${matchId}/revision` : `/partido/${matchId}/directo`} className="inline-grid min-h-11 place-items-center rounded-xl bg-slate-700 px-4 text-xs font-black">VOLVER AL PARTIDO</Link></div><p className="mt-3 text-xs text-slate-400">AlamedAPP solo guarda el ID del vídeo y puntos de sincronización. El vídeo permanece en YouTube y solo se abre cuando tú lo decides.</p></section>
    <section className="grid gap-3 rounded-3xl border border-slate-700 bg-slate-950 p-4 sm:grid-cols-[1fr_1fr_auto]">
      <label className="text-[9px] font-black text-slate-400 sm:col-span-2">URL O ID DE YOUTUBE<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://youtu.be/…" className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-sm text-white"/></label>
      <label className="text-[9px] font-black text-slate-400">COBERTURA<select value={coverage} onChange={(event) => setCoverage(event.target.value as typeof coverage)} className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3"><option value="FULL">P1 + P2</option><option value="P1">P1</option><option value="P2">P2</option></select></label>
      <label className="text-[9px] font-black text-slate-400">ETIQUETA<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Automática" className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-sm"/></label>
      <label className="text-[9px] font-black text-slate-400">MARGEN<input type="number" min={0} max={20} value={lead} onChange={(event) => setLead(Number(event.target.value))} className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3"/></label>
      <button type="button" onClick={addSegment} disabled={!parseYouTubeVideoId(url)} className="min-h-12 self-end rounded-xl bg-red-600 px-5 text-xs font-black disabled:opacity-35">+ VÍDEO</button>
      {message && <p role="alert" className="rounded-xl bg-red-950 p-3 text-sm text-red-200 sm:col-span-3">{message}</p>}
    </section>
    <div className="space-y-4">{(session.videoSegments ?? []).map((segment) => <SegmentCard key={segment.id} segment={segment} session={session} candidates={candidates} onCommit={commit} onMessage={setMessage}/>)}</div>
    {(session.videoSegments ?? []).length === 0 && <section className="rounded-3xl border border-dashed border-slate-700 p-10 text-center text-slate-400">Añade un vídeo para empezar. Podrás guardarlo sin ancla y sincronizarlo después.</section>}
  </main></div>;
}

function SegmentCard({ segment, session, candidates, onCommit, onMessage }: { segment: MatchVideoSegment; session: MatchSession; candidates: MatchEvent[]; onCommit: (session: MatchSession) => void; onMessage: (message: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(segment.videoId);
  const [label, setLabel] = useState(segment.label);
  const [lead, setLead] = useState(segment.leadSeconds);
  const [search, setSearch] = useState("");
  const [eventId, setEventId] = useState("");
  const [timestamp, setTimestamp] = useState("");
  const eligible = candidates.filter((event) => segment.periods.includes(event.period as MatchVideoPeriod)).filter((event) => `${eventDescription(event, session.players)} p${event.period} ${event.minute}`.toLowerCase().includes(search.toLowerCase())).slice(0, 40);
  function saveDetails() {
    const videoId = parseYouTubeVideoId(url);
    if (!videoId) return onMessage("La URL o ID de YouTube no es válido.");
    if (videoId !== segment.videoId && segment.anchors.length > 0 && !window.confirm("Cambiar el vídeo eliminará sus anchors. ¿Continuar?")) return;
    onCommit(upsertVideoSegment(session, { ...segment, videoId, label: label.trim() || segment.label, leadSeconds: lead, updatedAt: Date.now() }));
    setEditing(false); onMessage(null);
  }
  function addAnchor() {
    const second = parseVideoTimestamp(timestamp);
    if (!eventId || second === null) return onMessage("Elige un evento y escribe un tiempo válido, por ejemplo 08:47.");
    try {
      onCommit(addVideoAnchor(session, segment.id, { id: globalThis.crypto.randomUUID(), eventId, videoSecond: second }));
      setEventId(""); setTimestamp(""); onMessage(null);
    } catch (error) { onMessage(error instanceof Error ? error.message : "No se pudo guardar el anchor."); }
  }
  return <section className="rounded-3xl border border-slate-700 bg-slate-800 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black text-red-300">{segment.periods.map((period) => `P${period}`).join(" + ")} · −{segment.leadSeconds}s</p><h3 className="text-xl font-black">{segment.label}</h3><code className="text-[10px] text-slate-500">{segment.videoId}</code></div><div className="flex gap-2"><button type="button" onClick={() => setEditing(!editing)} className="min-h-11 rounded-xl bg-slate-700 px-3 text-xs font-black">✎</button><button type="button" onClick={() => { if (window.confirm("¿Eliminar este índice de vídeo? Los eventos no se modificarán.")) onCommit(removeVideoSegment(session, segment.id)); }} className="min-h-11 rounded-xl bg-slate-700 px-3 text-xs font-black">×</button></div></div>
    {editing && <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_6rem_auto]"><input aria-label="URL o ID editado" value={url} onChange={(event) => setUrl(event.target.value)} className="min-h-11 rounded-xl bg-slate-950 px-3 text-sm"/><input aria-label="Etiqueta editada" value={label} onChange={(event) => setLabel(event.target.value)} className="min-h-11 rounded-xl bg-slate-950 px-3 text-sm"/><input aria-label="Margen editado" type="number" min={0} max={20} value={lead} onChange={(event) => setLead(Number(event.target.value))} className="min-h-11 rounded-xl bg-slate-950 px-3"/><button type="button" onClick={saveDetails} className="min-h-11 rounded-xl bg-cyan-400 px-4 text-xs font-black text-slate-950">GUARDAR</button></div>}
    <div className="mt-4 rounded-2xl bg-slate-900 p-3"><p className="text-[10px] font-black text-cyan-300">SINCRONIZAR CON UNA JUGADA</p><p className="mt-1 text-[10px] text-slate-500">Los goles aparecen primero. Solo son elegibles eventos capturados en directo.</p><div className="mt-2 grid gap-2 sm:grid-cols-[1fr_2fr_8rem_auto]"><input aria-label="Buscar evento" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar jugador, minuto…" className="min-h-11 rounded-xl bg-slate-950 px-3 text-sm"/><select aria-label="Evento anchor" value={eventId} onChange={(event) => setEventId(event.target.value)} className="min-h-11 min-w-0 rounded-xl bg-slate-950 px-3 text-xs"><option value="">ELIGE JUGADA</option>{eligible.map((event) => <option key={event.id} value={event.id}>{event.type === "threat_recorded" && event.outcome === "GOL" ? "★ " : ""}P{event.period} · min {event.minute} · {eventDescription(event, session.players)} · {captureTime(event)}</option>)}</select><input aria-label="Tiempo de vídeo" value={timestamp} onChange={(event) => setTimestamp(event.target.value)} placeholder="08:47" className="min-h-11 rounded-xl bg-slate-950 px-3 text-sm"/><button type="button" onClick={addAnchor} className="min-h-11 rounded-xl bg-amber-400 px-4 text-xs font-black text-slate-950">ANCLAR</button></div></div>
    <div className="mt-3 space-y-2">{segment.anchors.map((anchor) => { const event = session.events.find((item) => item.id === anchor.eventId); const resolution = event ? resolveEventVideoPosition(session, event.id) : null; return <div key={anchor.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs"><span className="min-w-0 truncate"><strong>{formatVideoTimestamp(anchor.videoSecond)}</strong> · {event ? `P${event.period} min ${event.minute} · ${eventDescription(event, session.players)}` : "Evento no disponible"}</span><span className="flex gap-2">{resolution?.status === "RESOLVED" && <a href={resolution.url} target="_blank" rel="noopener noreferrer" className="inline-grid min-h-9 place-items-center rounded-lg bg-red-600 px-3 font-black">▶ PROBAR</a>}<button type="button" onClick={() => onCommit(removeVideoAnchor(session, segment.id, anchor.id))} className="min-h-9 rounded-lg bg-slate-700 px-3">×</button></span></div>; })}{segment.anchors.length === 0 && <p className="text-xs text-amber-300">Pendiente de ancla: el vídeo está guardado pero todavía no puede posicionar jugadas.</p>}</div>
  </section>;
}
