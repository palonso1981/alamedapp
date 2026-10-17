"use client";

import { useEffect, useRef, useState } from "react";

export type DashboardActionIconKind = "SHOT" | "ON_TARGET" | "OUTSIDE" | "SAVE" | "GOAL" | "KEY_MINUTES" | "GOLD_MINUTES";

function Glyph({ kind }: { kind: DashboardActionIconKind }) {
  if (kind === "SHOT") return <><path d="M3 14h7l3-3 4 2 3-1v5H9l-3 2H3z"/><circle cx="19" cy="6" r="2.2"/></>;
  if (kind === "KEY_MINUTES" || kind === "GOLD_MINUTES") return <><circle cx="11" cy="12" r="7"/><path d="M11 8v4l3 2M9 2h4"/><path d="M20 8v5"/><circle cx="20" cy="16.5" r=".5" fill="currentColor" stroke="none"/>{kind === "GOLD_MINUTES" && <><rect x="14" y="2" width="8" height="5" rx="2" fill="currentColor" stroke="none"/><text x="18" y="5.8" textAnchor="middle" fontSize="3.7" fontWeight="900" fill="#020617" stroke="none">5′</text></>}</>;
  return <><path d="M3 18V6h15v12M3 8h15M8 6v2M13 6v2"/>{kind === "ON_TARGET" && <><circle cx="11" cy="12.5" r="3"/><path d="M11 8v9M6.5 12.5h9"/></>}{kind === "OUTSIDE" && <><circle cx="8" cy="14" r="1.7"/><path d="m10 12 8-7m-3 0h3v3"/></>}{kind === "SAVE" && <path d="m7 15 1-5 1.5 2V8l1.5 4V7l1.5 5V9l1.5 4 2-1-1 5H9z"/>}{kind === "GOAL" && <><circle cx="11" cy="13" r="2.5"/><path d="m9.3 11.2 3.4 3.6m0-3.6-3.4 3.6"/></>}</>;
}

export function DashboardActionIcon({ kind, label, tone = "slate", compact = false }: { kind: DashboardActionIconKind; label: string; tone?: "green" | "red" | "cyan" | "amber" | "slate"; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const color = tone === "green" ? "text-emerald-300" : tone === "red" ? "text-rose-300" : tone === "cyan" ? "text-cyan-300" : tone === "amber" ? "text-amber-300" : "text-slate-300";
  return <span ref={host} className="relative inline-flex shrink-0 align-middle">
    <button type="button" aria-label={label} aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }} className={`grid place-items-center rounded-lg border border-current/20 bg-slate-950/70 ${compact ? "h-7 w-7" : "h-9 w-9"} ${color}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className={compact ? "h-4 w-4" : "h-5 w-5"} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><Glyph kind={kind}/></svg>
    </button>
    {open && <span role="tooltip" className="absolute left-1/2 top-full z-40 mt-1 w-max max-w-52 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[9px] font-black text-white shadow-xl">{label}</span>}
  </span>;
}
