"use client";

import { useId, useMemo, useState } from "react";
import { filterSearchableMatches, SearchableMatch, searchableMatchLabel } from "../../lib/dashboardSelectors";

export function SearchableMatchCombobox({ matches, value, onChange, label = "Partido", allLabel = "Todos los partidos" }: { matches: SearchableMatch[]; value: string; onChange: (matchId: string) => void; label?: string; allLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const id = useId();
  const filtered = useMemo(() => filterSearchableMatches(matches, query), [matches, query]);
  const selected = matches.find((match) => match.matchId === value);
  return <div className="relative min-w-56">
    <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} onClick={() => setOpen((current) => !current)} className="min-h-10 w-full rounded-xl bg-slate-800 px-3 text-left text-xs font-black">
      <span className="block truncate">{selected ? searchableMatchLabel(selected) : allLabel}</span>
    </button>
    {open && <div className="absolute left-0 top-full z-50 mt-2 w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-slate-600 bg-slate-950 p-2 shadow-2xl">
      <label className="sr-only" htmlFor={id}>{label}</label><input id={id} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rival, jornada, fecha o competición…" className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm outline-none focus:border-cyan-400" />
      <div role="listbox" className="mt-2 max-h-64 space-y-1 overflow-y-auto overscroll-contain">
        <button type="button" role="option" aria-selected={!value} onClick={() => { onChange(""); setOpen(false); setQuery(""); }} className="min-h-11 w-full rounded-xl px-3 text-left text-xs font-bold hover:bg-slate-800">{allLabel}</button>
        {filtered.map((match) => <button type="button" role="option" aria-selected={match.matchId === value} key={match.matchId} onClick={() => { onChange(match.matchId); setOpen(false); setQuery(""); }} className={`min-h-11 w-full rounded-xl px-3 text-left text-xs font-bold ${match.matchId === value ? "bg-cyan-950 text-cyan-200" : "hover:bg-slate-800"}`}>{searchableMatchLabel(match)}</button>)}
        {filtered.length === 0 && <p className="p-4 text-center text-xs text-slate-500">Sin resultados</p>}
      </div>
    </div>}
  </div>;
}
