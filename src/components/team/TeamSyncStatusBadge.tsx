"use client";

import { useState } from "react";
import { useTeamSync } from "../../hooks/useTeamSync";

export function TeamSyncStatusBadge({ teamId }: { teamId: string }) {
  const { summary, conflicts, errors, config, online, retry, recheckConflicts } = useTeamSync(teamId);
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
        <div className="absolute right-0 top-12 z-50 w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs shadow-2xl">
          <p className="font-black">PLANTILLA · NUBE</p>
          <p className="mt-1 text-slate-400">
            {!config.configured ? "Firebase no está configurado; los cambios siguen locales." : !online ? "Sin conexión. La cola se enviará al volver." : summary.conflicts ? "Existe una ficha en conflicto. La versión local se conserva." : summary.pending || summary.errors ? "Hay cambios locales pendientes de envío." : "Sin cambios pendientes."}
          </p>
          {conflicts.map((conflict) => (
            <div key={conflict.operationId} className="mt-3 rounded-lg border border-red-800/70 bg-red-950/40 p-2 text-[10px] text-red-100">
              <p className="text-xs font-black">{conflict.entityType} · {conflict.entityLabel}</p>
              <p className="mt-1 break-all text-red-200/80">ID {conflict.entityId}</p>
              <p className="mt-1">{conflict.namespace} · club {conflict.clubId}</p>
              <p>base {conflict.baseRevision} · local {conflict.localRevision ?? "—"} · nube {conflict.remoteRevision}</p>
              <p className="break-all">op {conflict.operationId} · {conflict.status}</p>
              <p className="mt-1 font-bold text-amber-200">La versión local sigue intacta.</p>
            </div>
          ))}
          {errors.map((issue) => (
            <div key={issue.operationId} className="mt-3 rounded-lg border border-amber-800/70 bg-amber-950/30 p-2 text-[10px] text-amber-100">
              <p className="text-xs font-black">{issue.entityType} · {issue.entityLabel}</p>
              <p className="mt-1 break-all text-amber-100/80">ID {issue.entityId}</p>
              <p>{issue.namespace} · club {issue.clubId} · base {issue.baseRevision}</p>
              <p className="break-all">op {issue.operationId}</p>
              <p className="mt-1 text-amber-200">{issue.error}</p>
            </div>
          ))}
          {conflicts.length > 0 && (
            <button type="button" onClick={recheckConflicts} disabled={!online} className="mt-3 min-h-11 w-full rounded-lg border border-amber-500/60 bg-amber-950/40 px-3 font-black text-amber-100 disabled:opacity-40">
              RECOMPROBAR SIN SOBRESCRIBIR
            </button>
          )}
          {summary.lastSyncedAt && <p className="mt-2 text-[10px] text-slate-500">{new Date(summary.lastSyncedAt).toLocaleTimeString()}</p>}
          {summary.errors > 0 && <button type="button" onClick={retry} disabled={!online} className="mt-3 min-h-10 w-full rounded-lg bg-cyan-400 font-black text-slate-950 disabled:opacity-40">REINTENTAR</button>}
        </div>
      )}
    </div>
  );
}
