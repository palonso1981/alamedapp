import { resolveEventVideoPosition } from "../../lib/videoIndex";
import { MatchSession } from "../../types";

export function VideoStatusLink({ session, eventId, compact = false }: { session: MatchSession; eventId: string; compact?: boolean }) {
  const resolution = resolveEventVideoPosition(session, eventId);
  if (resolution.status === "RESOLVED") {
    return <a href={resolution.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center justify-center rounded-xl bg-red-600 px-3 text-xs font-black text-white" title={`Abrir ${resolution.leadSeconds}s antes · ${resolution.quality}`}>▶{compact ? "" : " VER JUGADA"}</a>;
  }
  if (compact) return <span title={videoResolutionLabel(resolution.status)} className="inline-grid min-h-9 min-w-9 place-items-center rounded-lg bg-slate-800 text-xs text-slate-500">{resolution.status === "PENDING_SYNC" ? "⌁" : "—"}</span>;
  return <span className="inline-flex min-h-10 items-center rounded-xl bg-slate-800 px-3 text-[10px] font-bold text-slate-400">{videoResolutionLabel(resolution.status)}</span>;
}

export function videoResolutionLabel(status: "NO_VIDEO" | "NO_POSITION" | "PENDING_SYNC"): string {
  if (status === "NO_VIDEO") return "SIN VÍDEO";
  if (status === "NO_POSITION") return "SIN POSICIÓN DE VÍDEO";
  return "SINCRONIZACIÓN PENDIENTE";
}
