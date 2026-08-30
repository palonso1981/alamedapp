"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "../../../components/app/AppHeader";
import { usePreMatchStore } from "../../../store/usePreMatchStore";

function slug(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "rival"; }

export default function NewMatchPage() {
  const router = useRouter(); const createMatch = usePreMatchStore((state) => state.createMatch); const [error, setError] = useState<string | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const opponent = String(data.get("opponent") ?? ""); const date = String(data.get("date") ?? ""); const matchId = `partido-${date}-${slug(opponent)}-${crypto.randomUUID().slice(0, 8)}`; const ok = createMatch(matchId, { opponent, date, venue: String(data.get("venue")) === "AWAY" ? "AWAY" : "HOME", time: String(data.get("time") ?? ""), competition: String(data.get("competition") ?? ""), category: String(data.get("category") ?? ""), matchday: String(data.get("matchday") ?? "") }); if (ok) router.push(`/partido/${matchId}/prepartido`); else setError(usePreMatchStore.getState().errors[matchId] ?? "No se pudo crear."); }
  return <div className="min-h-screen bg-slate-900 text-white"><AppHeader title="Nuevo partido" /><main className="mx-auto max-w-2xl p-4 sm:p-8"><form onSubmit={submit} className="space-y-5 rounded-3xl border border-slate-700 bg-slate-800 p-5 sm:p-7">
    <label className="block text-sm font-bold text-slate-300">Rival<input name="opponent" required autoFocus className="mt-1 min-h-14 w-full rounded-xl border border-slate-600 bg-slate-950 px-4 text-lg font-bold" /></label>
    <div className="grid grid-cols-2 gap-3"><label className="text-sm font-bold text-slate-300">Fecha<input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="mt-1 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-950 px-3" /></label><label className="text-sm font-bold text-slate-300">Hora<input name="time" type="time" className="mt-1 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-950 px-3" /></label></div>
    <fieldset><legend className="text-sm font-bold text-slate-300">CDA</legend><div className="mt-1 grid grid-cols-2 gap-2"><label className="grid min-h-12 cursor-pointer place-items-center rounded-xl bg-slate-950 has-[:checked]:bg-cyan-400 has-[:checked]:text-slate-950"><input type="radio" name="venue" value="HOME" defaultChecked className="sr-only" />LOCAL</label><label className="grid min-h-12 cursor-pointer place-items-center rounded-xl bg-slate-950 has-[:checked]:bg-cyan-400 has-[:checked]:text-slate-950"><input type="radio" name="venue" value="AWAY" className="sr-only" />VISITANTE</label></div></fieldset>
    <div className="grid gap-3 sm:grid-cols-3"><label className="text-xs font-bold text-slate-400">Competición<input name="competition" className="mt-1 min-h-11 w-full rounded-xl bg-slate-950 px-3 text-white" /></label><label className="text-xs font-bold text-slate-400">Categoría<input name="category" className="mt-1 min-h-11 w-full rounded-xl bg-slate-950 px-3 text-white" /></label><label className="text-xs font-bold text-slate-400">Jornada<input name="matchday" className="mt-1 min-h-11 w-full rounded-xl bg-slate-950 px-3 text-white" /></label></div>
    {error && <p role="alert" className="rounded-xl bg-red-950 p-3 text-red-200">{error}</p>}<button type="submit" className="min-h-14 w-full rounded-xl bg-amber-400 text-lg font-black text-slate-950">CREAR Y PREPARAR →</button>
  </form></main></div>;
}
