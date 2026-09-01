"use client";

import { useState } from "react";

interface Props {
  label: string;
  archived: boolean;
  impact: string;
  onArchive: () => void;
  onReactivate: () => void;
  onDelete: () => void;
  onEdit?: () => void;
}

export function AdminEntityActions({ label, archived, impact, onArchive, onReactivate, onDelete, onEdit }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return <>
    <details className="relative">
      <summary aria-label={`Acciones de ${label}`} className="grid min-h-11 min-w-11 cursor-pointer list-none place-items-center rounded-xl bg-slate-950 text-xl font-black text-slate-300">···</summary>
      <div className="absolute right-0 z-30 mt-2 w-52 rounded-2xl border border-slate-600 bg-slate-950 p-2 shadow-2xl">
        {onEdit && <button type="button" onClick={onEdit} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-black text-cyan-300 hover:bg-slate-800">✎ EDITAR</button>}
        {archived
          ? <button type="button" onClick={onReactivate} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-black text-emerald-300 hover:bg-slate-800">↻ REACTIVAR</button>
          : <button type="button" onClick={onArchive} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-black text-amber-300 hover:bg-slate-800">▣ ARCHIVAR</button>}
        <button type="button" onClick={() => setConfirmDelete(true)} className="mt-1 min-h-11 w-full rounded-xl px-3 text-left text-sm font-black text-red-300 hover:bg-red-950">⌫ ELIMINAR</button>
      </div>
    </details>
    {confirmDelete && <div role="dialog" aria-modal="true" aria-label={`Eliminar ${label}`} className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-red-700 bg-slate-900 p-5 shadow-2xl">
        <p className="text-xs font-black uppercase tracking-wider text-red-300">Acción irreversible</p>
        <h2 className="mt-2 text-xl font-black">Eliminar {label}</h2>
        <p className="mt-3 rounded-2xl bg-slate-950 p-4 text-sm text-slate-300">{impact}</p>
        <p className="mt-3 text-xs text-slate-400">Se conservará un tombstone para impedir que la sincronización resucite el dato y proteger referencias históricas. No se ejecuta una purga física.</p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-12 rounded-xl bg-slate-700 font-black">CANCELAR</button>
          <button type="button" onClick={() => { onDelete(); setConfirmDelete(false); }} className="min-h-12 rounded-xl bg-red-500 px-3 text-sm font-black text-white">ELIMINAR DEFINITIVAMENTE</button>
        </div>
      </div>
    </div>}
  </>;
}
