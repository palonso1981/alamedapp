"use client";

import { KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { filterSearchableMatches, SearchableMatch, searchableMatchLabel } from "../../lib/dashboardSelectors";

export function SearchableMatchCombobox({ matches, value, onChange, label = "Partido", allLabel = "Todos los partidos" }: { matches: SearchableMatch[]; value: string; onChange: (matchId: string) => void; label?: string; allLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState({ left: 16, top: 80, width: 358 });
  const filtered = useMemo(() => filterSearchableMatches(matches, query), [matches, query]);
  const selected = matches.find((match) => match.matchId === value);
  const options = useMemo(() => [
    ...(!query.trim() ? [{ matchId: "", label: allLabel }] : []),
    ...filtered.map((match) => ({ matchId: match.matchId, label: searchableMatchLabel(match) })),
  ], [allLabel, filtered, query]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !popupRef.current?.contains(event.target as Node)) { setOpen(false); setQuery(""); }
    };
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(480, window.innerWidth - 32);
      setPosition({ left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)), top: Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - 376)), width });
    };
    place();
    requestAnimationFrame(() => inputRef.current?.focus());
    document.addEventListener("pointerdown", close);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setActiveIndex(Math.max(0, options.findIndex((option) => option.matchId === value)));
  }, [open, options, value]);
  const choose = (matchId: string) => { onChange(matchId); setOpen(false); setQuery(""); setActiveIndex(-1); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); setQuery(""); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => Math.max(0, Math.min(options.length - 1, (current < 0 ? 0 : current) + delta)));
    }
    if (event.key === "Enter" && activeIndex >= 0 && options[activeIndex]) { event.preventDefault(); choose(options[activeIndex].matchId); }
  };
  return <div ref={rootRef} data-match-picker className="relative min-w-56 max-w-full">
    <button ref={triggerRef} type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} onClick={() => setOpen((current) => !current)} className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-slate-800 px-3 text-left text-xs font-black focus:outline-none focus:ring-2 focus:ring-cyan-400">
      <span className="block min-w-0 flex-1 truncate">{selected ? searchableMatchLabel(selected) : allLabel}</span><span aria-hidden="true" className="text-slate-400">⌄</span>
    </button>
    {open && typeof document !== "undefined" && createPortal(<div ref={popupRef} data-match-picker-popup className="fixed z-[100] rounded-2xl border border-slate-600 bg-slate-950 p-2 shadow-2xl" style={position}>
      <label className="sr-only" htmlFor={`${id}-search`}>{label}</label><input ref={inputRef} id={`${id}-search`} role="combobox" aria-controls={`${id}-list`} aria-expanded="true" aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined} autoFocus value={query} onKeyDown={onKeyDown} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} placeholder="Buscar rival, jornada..." className="min-h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-base outline-none focus:border-cyan-400" />
      <div id={`${id}-list`} role="listbox" className="mt-2 max-h-[min(18rem,calc(100vh-9rem))] overflow-y-auto overscroll-contain">
        {options.map((option, index) => <button id={`${id}-option-${index}`} type="button" role="option" aria-selected={option.matchId === value} key={option.matchId || "all"} onPointerMove={() => setActiveIndex(index)} onClick={() => choose(option.matchId)} className={`block min-h-11 w-full rounded-xl px-3 py-2 text-left text-xs font-bold focus:outline-none ${index === activeIndex ? "bg-slate-800" : ""} ${option.matchId === value ? "text-cyan-200" : "text-slate-200"}`}>{option.label}</button>)}
        {filtered.length === 0 && <p className="p-4 text-center text-xs text-slate-500">Sin resultados</p>}
      </div>
    </div>, document.body)}
  </div>;
}
