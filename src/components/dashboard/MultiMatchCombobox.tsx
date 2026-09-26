"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  filterSearchableMatches,
  matchSelectionLabel,
  SearchableMatch,
  searchableMatchLabel,
  toggleMatchSelection,
} from "../../lib/dashboardSelectors";

export function MultiMatchCombobox({
  matches,
  values,
  onChange,
  label = "Partidos",
  allLabel = "Todos los partidos",
}: {
  matches: SearchableMatch[];
  values: string[];
  onChange: (matchIds: string[]) => void;
  label?: string;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState({ left: 16, top: 80, width: 358 });
  const filtered = useMemo(
    () => filterSearchableMatches(matches, query),
    [matches, query],
  );

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !popupRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
        setQuery("");
      }
    };
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(480, window.innerWidth - 32);
      setPosition({
        left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
        top: Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - 420)),
        width,
      });
    };
    place();
    requestAnimationFrame(() => inputRef.current?.focus());
    document.addEventListener("pointerdown", close);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      data-multi-match-picker
      className="relative min-w-56 max-w-full"
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-slate-800 px-3 text-left text-xs font-black focus:outline-none focus:ring-2 focus:ring-cyan-400"
      >
        <span className="block min-w-0 flex-1 truncate">
          {matchSelectionLabel(matches, values, allLabel)}
        </span>
        <span aria-hidden="true" className="text-slate-400">
          ⌄
        </span>
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popupRef}
            data-multi-match-picker-popup
            className="fixed z-[100] rounded-2xl border border-slate-600 bg-slate-950 p-2 shadow-2xl"
            style={position}
          >
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`${id}-search`}>
                {label}
              </label>
              <input
                ref={inputRef}
                id={`${id}-search`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar rival, jornada..."
                className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 text-base outline-none focus:border-cyan-400"
              />
              {values.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="min-h-12 rounded-xl border border-slate-700 px-3 text-[10px] font-black text-slate-300"
                >
                  LIMPIAR
                </button>
              )}
            </div>
            <div
              id={`${id}-list`}
              className="mt-2 max-h-[min(20rem,calc(100vh-10rem))] overflow-y-auto overscroll-contain"
            >
              {filtered.map((match) => {
                const checked = values.includes(match.matchId);
                return (
                  <label
                    key={match.matchId}
                    className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-xs font-bold ${checked ? "bg-cyan-950 text-cyan-100" : "text-slate-200 hover:bg-slate-900"}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        onChange(toggleMatchSelection(values, match.matchId))
                      }
                      className="h-5 w-5 shrink-0 accent-cyan-300"
                    />
                    <span className="min-w-0 flex-1">
                      {searchableMatchLabel(match)}
                    </span>
                  </label>
                );
              })}
              {filtered.length === 0 && (
                <p className="p-4 text-center text-xs text-slate-500">
                  Sin resultados
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setQuery("");
              }}
              className="mt-2 min-h-11 w-full rounded-xl bg-slate-800 text-xs font-black"
            >
              HECHO · {values.length || "TODOS"}
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
