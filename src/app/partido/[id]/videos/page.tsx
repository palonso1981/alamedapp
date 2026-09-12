"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { AppHeader } from "../../../../components/app/AppHeader";
import { useMatchStore } from "../../../../store/useMatchStore";

export default function MatchVideosReadOnlyPage() {
  const { id: matchId } = useParams<{ id: string }>();
  const session = useMatchStore((state) => state.matches[matchId]);
  const ensureMatch = useMatchStore((state) => state.ensureMatch);
  useEffect(() => ensureMatch(matchId), [ensureMatch, matchId]);
  if (!session) return <div className="grid min-h-screen place-items-center bg-slate-900 text-white">Cargando vídeos…</div>;
  return <div className="min-h-screen bg-slate-900 text-white"><AppHeader title="Vídeos del partido" clubId={session.preparation?.clubId}/><main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6"><Link href={session.matchFinished ? `/partido/${matchId}/revision` : "/partidos"} className="inline-grid min-h-11 place-items-center rounded-xl bg-slate-800 px-4 text-xs font-black">← VOLVER</Link>{(session.videoSegments ?? []).map((segment) => <section key={segment.id} className="rounded-3xl border border-slate-700 bg-slate-800 p-5"><p className="text-[10px] font-black text-red-300">YOUTUBE · {segment.periods.map((period) => `P${period}`).join(" + ")}</p><h2 className="mt-1 text-xl font-black">{segment.label}</h2><a href={`https://www.youtube.com/watch?v=${encodeURIComponent(segment.videoId)}`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-grid min-h-12 place-items-center rounded-xl bg-red-600 px-5 text-sm font-black">▶ ABRIR EN YOUTUBE</a></section>)}{(session.videoSegments ?? []).length === 0 && <p className="rounded-3xl border border-dashed border-slate-700 p-8 text-center text-slate-400">Este partido todavía no tiene vídeos.</p>}</main></div>;
}
