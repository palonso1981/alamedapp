"use client";

import { useState } from "react";

import { useMatchSync } from "../../hooks/useMatchSync";

export function SyncStatusBadge({ matchId }: { matchId: string }) {
  const { summary, config, eligible, online, retry } = useMatchSync(matchId);
  const [open, setOpen] = useState(false);

  const state = !eligible
    ? { label: "○ Solo local", tone: "bg-slate-900 text-slate-400" }
    : summary.conflicts > 0
      ? {
          label: `! ${summary.conflicts} conflicto${summary.conflicts === 1 ? "" : "s"}`,
          tone: "bg-red-950 text-red-300",
        }
      : summary.errors > 0
        ? { label: `! ${summary.errors} sin enviar`, tone: "bg-red-950 text-red-300" }
        : summary.syncing > 0
          ? { label: `↻ ${summary.syncing}`, tone: "bg-cyan-950 text-cyan-200" }
          : summary.pending > 0
            ? { label: `● ${summary.pending} pendientes`, tone: "bg-amber-950 text-amber-300" }
            : config.configured && summary.lastSyncedAt
              ? { label: "✓ Sincronizado", tone: "bg-emerald-950 text-emerald-300" }
              : { label: "○ Solo dispositivo", tone: "bg-slate-900 text-slate-400" };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`min-h-10 rounded-lg px-3 text-xs font-semibold ${state.tone}`}
        aria-label="Ver estado de sincronización remota"
        aria-expanded={open}
      >
        {state.label}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-64 rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-slate-200 shadow-2xl">
          <p className="font-black">NUBE DEV</p>
          <p className="mt-1 text-slate-400">
            {!eligible
              ? "Los partidos demo permanecen solo en este dispositivo."
              : !config.configured
                ? "Firebase DEV no está configurado. Todo sigue seguro localmente."
                : !online
                  ? "Sin conexión. La cola se enviará al recuperar la red."
                  : summary.conflicts > 0
                    ? `${summary.conflicts} ${summary.conflicts === 1 ? "entidad necesita" : "entidades necesitan"} revisión. La versión local se conserva y no se sobrescribe.`
                  : summary.pending > 0 || summary.errors > 0
                    ? `${summary.pending + summary.errors} operaciones guardadas pendientes de envío.`
                    : "No hay operaciones locales pendientes."}
          </p>
          {summary.lastSyncedAt && (
            <p className="mt-2 text-[10px] text-slate-500">
              Último sync: {new Date(summary.lastSyncedAt).toLocaleTimeString()}
            </p>
          )}
          {summary.lastError && (
            <p className="mt-2 rounded-lg bg-red-950 p-2 text-red-200">
              {summary.lastError}
            </p>
          )}
          {eligible && config.configured && summary.errors > 0 && (
            <button
              type="button"
              onClick={retry}
              disabled={!online}
              className="mt-3 min-h-10 w-full rounded-lg bg-cyan-500 font-black text-slate-950 disabled:opacity-40"
            >
              REINTENTAR
            </button>
          )}
        </div>
      )}
    </div>
  );
}
