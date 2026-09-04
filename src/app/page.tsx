import Link from "next/link";
import { AppHeader } from "../components/app/AppHeader";

export default function Home() {
  return <div className="min-h-screen bg-slate-900 text-white">
    <AppHeader title="AlamedAPP" />
    <main className="mx-auto grid max-w-5xl gap-4 p-5 sm:grid-cols-2 sm:p-10">
      <Link href="/plantilla" className="rounded-3xl border border-cyan-900 bg-slate-800 p-7 transition hover:border-cyan-400"><span className="text-4xl">◉</span><h2 className="mt-5 text-2xl font-black">PLANTILLA</h2><p className="mt-2 text-slate-400">Jugadores, porteros, dorsales, fotos y cuerpo técnico.</p></Link>
      <Link href="/partidos" className="rounded-3xl border border-amber-900 bg-slate-800 p-7 transition hover:border-amber-400"><span className="text-4xl">▣</span><h2 className="mt-5 text-2xl font-black">PARTIDOS</h2><p className="mt-2 text-slate-400">Preparación, convocatoria, quinteto e inicio del Directo.</p></Link>
      <Link href="/dashboard" className="rounded-3xl border border-violet-900 bg-slate-800 p-7 transition hover:border-violet-400"><span className="text-4xl">▥</span><h2 className="mt-5 text-2xl font-black">DASHBOARD</h2><p className="mt-2 text-slate-400">Minutos, amenazas, fases, porteros y mapas derivados.</p></Link>
      <Link href="/partido/prueba/directo" className="rounded-2xl border border-slate-700 bg-slate-950 p-5 text-sm font-bold text-slate-300">DEMO DIRECTO →</Link>
      <Link href="/partido/prueba-porteria/directo" className="rounded-2xl border border-slate-700 bg-slate-950 p-5 text-sm font-bold text-slate-300">DEMO PORTERÍA →</Link>
    </main>
  </div>;
}
