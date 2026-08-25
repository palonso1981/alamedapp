"use client";

import { useEffect, useState } from "react";

interface HistoryControlsProps {
  canUndo: boolean;
  canRedo: boolean;
  undoDescription: string;
  onUndo: () => void;
  onRedo: () => void;
}

export function HistoryControls({
  canUndo,
  canRedo,
  undoDescription,
  onUndo,
  onRedo,
}: HistoryControlsProps) {
  const [confirmingUndo, setConfirmingUndo] = useState(false);

  useEffect(() => {
    if (!confirmingUndo) return;
    const timeout = window.setTimeout(() => setConfirmingUndo(false), 4_000);
    return () => window.clearTimeout(timeout);
  }, [confirmingUndo]);

  return (
    <div className="relative flex min-h-11 items-center justify-end gap-2" aria-label="Historial de acciones">
      {confirmingUndo ? (
        <div className="absolute right-0 top-0 z-30 flex min-h-12 items-center gap-2 rounded-xl border border-amber-400/60 bg-slate-950 px-2 shadow-xl">
          <span className="max-w-52 truncate text-xs text-amber-100">
            Deshacer: {undoDescription}
          </span>
          <button
            type="button"
            onClick={() => {
              onUndo();
              setConfirmingUndo(false);
            }}
            className="grid min-h-10 min-w-10 place-items-center rounded-lg bg-amber-300 text-lg font-black text-slate-950"
            aria-label={`Confirmar deshacer ${undoDescription}`}
          >
            ✓
          </button>
          <button
            type="button"
            onClick={() => setConfirmingUndo(false)}
            className="grid min-h-10 min-w-10 place-items-center rounded-lg bg-slate-800 text-lg font-black"
            aria-label="Cancelar deshacer"
          >
            ×
          </button>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setConfirmingUndo(true)}
        disabled={!canUndo}
        className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-slate-700 bg-slate-900 text-xl text-slate-300 disabled:cursor-not-allowed disabled:opacity-25"
        aria-label="Deshacer última acción"
        title="Deshacer"
      >
        ↶
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-slate-700 bg-slate-900 text-xl text-slate-300 disabled:cursor-not-allowed disabled:opacity-25"
        aria-label="Rehacer última acción"
        title="Rehacer"
      >
        ↷
      </button>
    </div>
  );
}
