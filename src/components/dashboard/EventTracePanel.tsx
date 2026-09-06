import Link from "next/link";
import { DashboardMatchRecord, DashboardThreatPoint, DashboardGoalPoint } from "../../lib/dashboardAnalytics";
import { derivePitchOriginZone } from "../../lib/dashboardAnalysis";
import { ThreatRecordedEvent } from "../../types";

export type TraceablePoint = DashboardThreatPoint | DashboardGoalPoint;

export function resolveMapPoint(records: readonly DashboardMatchRecord[], point: TraceablePoint): { record: DashboardMatchRecord; event: ThreatRecordedEvent } | null {
  const record = records.find((item) => item.catalog.matchId === point.matchId);
  const event = record?.session.events.find((item): item is ThreatRecordedEvent => item.id === point.eventId && item.type === "threat_recorded");
  return record && event ? { record, event } : null;
}

export function EventTracePanel({ records, point, onClose }: { records: readonly DashboardMatchRecord[]; point: TraceablePoint; onClose: () => void }) {
  const resolved = resolveMapPoint(records, point);
  if (!resolved) return null;
  const { record, event } = resolved;
  const player = event.playerId ? record.session.players.find((item) => item.id === event.playerId) : undefined;
  const goalkeeperId = event.defensive?.goalkeeper.status === "PLAYER" ? event.defensive.goalkeeper.playerId : undefined;
  const goalkeeper = goalkeeperId ? record.session.players.find((item) => item.id === goalkeeperId) : undefined;
  const assist = event.assist?.status === "PLAYER" ? record.session.players.find((item) => item.id === event.assist?.playerId)?.name : event.assist?.status === "NONE" ? "Sin asistencia" : event.assist?.status === "PENDING" ? "Pendiente" : undefined;
  return <aside role="dialog" aria-label="Detalle del evento del mapa" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-3xl border border-cyan-700 bg-slate-950 p-4 text-white shadow-2xl">
    <div className="flex items-start justify-between gap-3"><div><span className="text-[10px] font-black text-cyan-300">{event.outcome} · P{event.period} {String(event.minute).padStart(2, "0")}&apos;</span><h3 className="text-xl font-black">{record.catalog.opponent}</h3><p className="text-xs text-slate-400">{record.catalog.date} · {record.catalog.venue === "HOME" ? "Local" : "Visitante"} · {event.side === "FOR" ? "Remate CDA" : "Amenaza rival"}</p></div><button type="button" onClick={onClose} className="grid min-h-10 min-w-10 place-items-center rounded-xl bg-slate-800" aria-label="Cerrar detalle">×</button></div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3"><Detail label="FASE" value={event.phase}/><Detail label="ORIGEN" value={`${derivePitchOriginZone(event.origin)} · X ${Math.round(event.origin.x * 100)} · Y ${Math.round(event.origin.y * 100)}`}/>{player && <Detail label="JUGADOR" value={player.name}/>} {goalkeeper && <Detail label="PORTERO" value={goalkeeper.name}/>} {event.defensive?.version === 2 && event.defensive.keeperBodyPart && <Detail label="CUERPO" value={event.defensive.keeperBodyPart}/>} {event.defensive?.saveOutcome && <Detail label="DESENLACE" value={event.defensive.saveOutcome}/>} {assist && <Detail label="ASISTENCIA" value={assist}/>} {event.sequenceId && <Detail label="SECUENCIA" value={event.sequenceId}/>} {event.parentEventId && <Detail label="PADRE" value={event.parentEventId}/>}<Detail label="PROCEDENCIA" value={event.provenance ?? event.source}/></div>
    <div className="mt-3 flex items-center justify-between gap-3"><code className="truncate text-[9px] text-slate-600">eventId · {event.id}</code><Link href={`/partido/${record.catalog.matchId}/revision?eventId=${encodeURIComponent(event.id)}`} className="inline-grid min-h-11 shrink-0 place-items-center rounded-xl bg-cyan-300 px-4 text-xs font-black text-slate-950">VER EVENTO</Link></div>
  </aside>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-slate-900 p-2"><span className="block text-[8px] font-black text-slate-500">{label}</span><strong className="mt-0.5 block break-words">{value.replaceAll("_", " ")}</strong></div>; }
