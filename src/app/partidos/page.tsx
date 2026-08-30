"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppHeader } from "../../components/app/AppHeader";
import { listMatchCatalog, MatchCatalogEntry } from "../../lib/matchCatalog";

const STATUS_LABEL: Record<MatchCatalogEntry["status"], string> = { DRAFT: "PREPARAR", READY: "LISTO", LIVE: "EN CURSO", FINISHED: "FINALIZADO" };

export default function MatchesPage() {
  const [matches, setMatches] = useState<MatchCatalogEntry[]>([]);
  useEffect(() => setMatches(listMatchCatalog()), []);
  return <div className="min-h-screen bg-slate-900 text-white"><AppHeader title="Partidos" actions={<Link href="/partidos/nuevo" className="min-h-10 rounded-lg bg-amber-400 px-4 py-2.5 font-black text-slate-950">+ PARTIDO</Link>} /><main className="mx-auto max-w-5xl p-4 sm:p-6"><div className="space-y-3">
    {matches.map((match) => { const href = match.status === "LIVE" || match.status === "FINISHED" ? `/partido/${match.matchId}/directo` : `/partido/${match.matchId}/prepartido`; return <Link key={match.matchId} href={href} className="flex min-h-24 items-center justify-between gap-4 rounded-2xl border border-slate-700 bg-slate-800 p-4 hover:border-amber-400"><span><span className="block text-xs font-bold text-slate-400">{match.date}{match.time ? ` · ${match.time}` : ""} · {match.venue === "HOME" ? "LOCAL" : "VISITANTE"}</span><span className="mt-1 block text-xl font-black">{match.opponent}</span></span><span className={`rounded-xl px-3 py-2 text-xs font-black ${match.status === "LIVE" ? "bg-red-950 text-red-300" : match.status === "READY" ? "bg-emerald-950 text-emerald-300" : "bg-slate-950 text-slate-300"}`}>{STATUS_LABEL[match.status]} →</span></Link>; })}
    {matches.length === 0 && <div className="rounded-3xl border border-dashed border-slate-700 p-10 text-center"><p className="text-slate-400">Todavía no hay partidos reales en este dispositivo.</p><Link href="/partidos/nuevo" className="mt-5 inline-grid min-h-12 place-items-center rounded-xl bg-amber-400 px-6 font-black text-slate-950">CREAR PARTIDO</Link></div>}
  </div></main></div>;
}
