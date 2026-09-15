"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { buildYouTubeEmbedUrl, buildYouTubeWatchAtUrl, formatVideoTimestamp, parseVideoPlayerParams } from "../../../lib/videoIndex";

function VideoPlayerContent() {
  const searchParams = useSearchParams();
  const params = parseVideoPlayerParams(searchParams.get("videoId"), searchParams.get("start"));

  if (!params) {
    return <main className="grid min-h-screen place-items-center bg-slate-950 p-5 text-white"><section className="w-full max-w-lg rounded-3xl border border-red-900 bg-slate-900 p-6 text-center"><p className="text-xs font-black tracking-widest text-red-300">VÍDEO NO VÁLIDO</p><h1 className="mt-2 text-xl font-black">No se puede abrir esta posición</h1><p className="mt-3 text-sm text-slate-400">El enlace no contiene un vídeo y un segundo válidos. No se ha inventado ninguna posición temporal.</p><Link href="/partidos" className="mt-5 inline-grid min-h-12 place-items-center rounded-xl bg-slate-800 px-5 text-sm font-black">VOLVER A APP ALAM</Link></section></main>;
  }

  return <main className="min-h-screen bg-slate-950 p-3 text-white sm:p-6"><section className="mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-6xl flex-col justify-center gap-4 sm:min-h-[calc(100vh-3rem)]"><div className="overflow-hidden rounded-2xl border border-slate-800 bg-black shadow-2xl"><div className="aspect-video w-full"><iframe
    className="h-full w-full"
    src={buildYouTubeEmbedUrl(params.videoId, params.startSecond)}
    title={`YouTube desde ${params.startSecond} segundos`}
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    referrerPolicy="strict-origin-when-cross-origin"
    allowFullScreen
  /></div></div><div className="flex flex-wrap items-center justify-between gap-3"><Link href="/partidos" className="inline-grid min-h-12 place-items-center rounded-xl bg-slate-800 px-5 text-sm font-black">← APP ALAM</Link><p className="text-xs font-bold text-slate-400">Inicio solicitado · {formatVideoTimestamp(params.startSecond)}</p><a href={buildYouTubeWatchAtUrl(params.videoId, params.startSecond)} target="_blank" rel="noopener noreferrer" className="inline-grid min-h-12 place-items-center rounded-xl bg-red-600 px-5 text-sm font-black">▶ VER EN YOUTUBE</a></div></section></main>;
}

export default function VideoPlayerPage() {
  return <Suspense fallback={<main className="grid min-h-screen place-items-center bg-slate-950 text-sm font-bold text-slate-400">Preparando vídeo…</main>}><VideoPlayerContent /></Suspense>;
}
