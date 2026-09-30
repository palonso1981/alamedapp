"use client";

import { useEffect, useId, useRef, useState } from "react";
import { shouldCloseVideoFilterMenu } from "../../lib/videoLibrary";

export interface CompactMultiSelectOption {
  value: string;
  label: string;
}

export function CompactMultiSelect({
  label,
  allLabel,
  values,
  options,
  onChange,
}: {
  label: string;
  allLabel: string;
  values: string[];
  options: CompactMultiSelectOption[];
  onChange: (values: string[]) => void;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (open && !rootRef.current?.contains(event.target as Node) && shouldCloseVideoFilterMenu("OUTSIDE_POINTER")) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (open && event.key === "Escape" && shouldCloseVideoFilterMenu("ESCAPE")) {
        event.preventDefault();
        setOpen(false);
      }
    };
    const closeForOtherMenu = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id && shouldCloseVideoFilterMenu("OTHER_MENU_OPENED")) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("alamedapp:video-filter-open", closeForOtherMenu);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("alamedapp:video-filter-open", closeForOtherMenu);
    };
  }, [id, open]);
  const toggle = () => {
    const next = !open;
    if (next) window.dispatchEvent(new CustomEvent("alamedapp:video-filter-open", { detail: id }));
    setOpen(next);
  };
  const selectedLabel = values.length === 0
    ? allLabel
    : values.length === 1
      ? options.find((option) => option.value === values[0])?.label ?? `${label} · 1`
      : `${label} · ${values.length}`;
  return <div ref={rootRef} className="relative min-w-0">
    <button type="button" aria-expanded={open} aria-haspopup="listbox" onClick={toggle} className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl bg-slate-800 px-3 text-left text-xs font-black focus:outline-none focus:ring-2 focus:ring-cyan-400">
      <span className="min-w-0 flex-1 truncate">{selectedLabel}</span><span aria-hidden="true" className="text-slate-400">⌄</span>
    </button>
    {open && <div role="listbox" aria-multiselectable="true" aria-label={label} className="absolute left-0 top-[calc(100%+.4rem)] z-50 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-slate-600 bg-slate-950 p-2 shadow-2xl">
      <div className="flex items-center justify-between gap-2 px-2 py-1"><strong className="text-[10px] tracking-widest text-slate-400">{label}</strong>{values.length > 0 && <button type="button" onClick={() => onChange([])} className="min-h-9 rounded-lg border border-slate-700 px-3 text-[9px] font-black">LIMPIAR</button>}</div>
      <div className="max-h-64 overflow-y-auto overscroll-contain">
        {options.map((option) => {
          const checked = values.includes(option.value);
          return <label key={option.value} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-xs font-bold ${checked ? "bg-cyan-950 text-cyan-100" : "text-slate-200 hover:bg-slate-900"}`}>
            <input type="checkbox" checked={checked} onChange={() => onChange(checked ? values.filter((value) => value !== option.value) : [...values, option.value])} className="h-5 w-5 shrink-0 accent-cyan-300"/>
            <span className="min-w-0 flex-1">{option.label}</span>
          </label>;
        })}
        {options.length === 0 && <p className="p-4 text-center text-xs text-slate-500">Sin opciones disponibles</p>}
      </div>
    </div>}
  </div>;
}
