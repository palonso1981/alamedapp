"use client";

import { useState } from "react";
import { useTeamSync } from "../../hooks/useTeamSync";

export function TeamSyncStatusBadge({ teamId }: { teamId: string }) {
  const { summary, config, online, retry } = useTeamSync(teamId);
  const [open, setOpen] = useState(false);
  const state = summary.conflicts
    ? { label: `! ${summary.conflicts}`, tone: "bg-red-950 text-red-300" }
    : summary.errors
      ? { label: `! ${summary.errors}`, tone: "bg-red-950 text-red-300" }
      : summary.syncing
        ? { label: `↻ ${summary.syncing}`, tone: "bg-cyan-950 text-cyan-200" }
        : summary.pending
          ? { label: `● ${summary.pending}`, tone: "bg-amber-950 text-amber-300" }
          : config.configured && summary.lastSyncedAt
            ? { label: "✓ NUBE", tone: "bg-emerald-950 text-emerald-300" }
            : { label: "○ LOCAL", tone: "bg-slate-800 text-slate-300" };
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className={`min-h-10 rounded-lg px-3 text-xs font-black ${state.tone}`} aria-label="Estado de sincronización de plantilla">
        {state.label}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-64 rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs shadow-2xl">
          <p className="font-black">PLANTILLA · DEV</p>
          <p className="mt-1 text-slate-400">
            {!config.configured ? "Firebase no está configurado; los cambios siguen locales." : !online ? "Sin conexión. La cola se enviará al volver." : summary.conflicts ? "Existe una ficha en conflicto. La versión local se conserva." : summary.pending || summary.errors ? "Hay cambios locales pendientes de envío." : "Sin cambios pendientes."}
          </p>
          {summary.lastSyncedAt && <p className="mt-2 text-[10px] text-slate-500">{new Date(summary.lastSyncedAt).toLocaleTimeString()}</p>}
          {summary.errors > 0 && <button type="button" onClick={retry} disabled={!online} className="mt-3 min-h-10 w-full rounded-lg bg-cyan-400 font-black text-slate-950 disabled:opacity-40">REINTENTAR</button>}
        </div>
      )}
    </div>
  );
}
