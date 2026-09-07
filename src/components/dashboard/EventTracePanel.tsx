import Link from "next/link";
import { DashboardMatchRecord } from "../../lib/dashboardAnalytics";
import { DashboardTraceablePoint, resolveDashboardMapPoint } from "../../lib/dashboardTrace";
import { derivePitchOriginZone } from "../../lib/dashboardAnalysis";
import { DASHBOARD_FIXTURE_CLUB_ID } from "../../lib/dashboardFixture";
import { revisionEventHref } from "../../lib/dashboardNavigation";
export type TraceablePoint = DashboardTraceablePoint;

export function EventTracePanel({ records, point, onClose, returnTo }: { records: readonly DashboardMatchRecord[]; point: TraceablePoint; onClose: () => void; returnTo: string }) {
  const resolved = resolveDashboardMapPoint(records, point);
  if (!resolved) return null;
  const { record, event } = resolved;
  const player = event.playerId ? record.session.players.find((item) => item.id === event.playerId) : undefined;
  const goalkeeperId = event.defensive?.goalkeeper.status === "PLAYER" ? event.defensive.goalkeeper.playerId : undefined;
  const goalkeeper = goalkeeperId ? record.session.players.find((item) => item.id === goalkeeperId) : undefined;
  const assistData = event.assist;
  const assist = assistData?.status === "PLAYER" ? record.session.players.find((item) => item.id === assistData.playerId)?.name : assistData?.status === "NONE" ? "Sin asistencia" : assistData?.status === "PENDING" ? "Pendiente" : undefined;
  const capturedAt = Number.isFinite(event.createdAt) && event.createdAt > 0 ? new Date(event.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null;
  return <aside role="dialog" aria-label="Detalle del evento del mapa" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-3xl border border-cyan-700 bg-slate-950 p-4 text-white shadow-2xl">
    <div className="flex items-start justify-between gap-3"><div><span className="text-[10px] font-black text-cyan-300">{event.outcome} · P{event.period} · min {event.minute}</span><h3 className="text-xl font-black">{record.catalog.opponent}</h3><p className="text-xs text-slate-400">{record.catalog.date} · {record.catalog.venue === "HOME" ? "Local" : "Visitante"} · {event.side === "FOR" ? "Remate CDA" : "Amenaza rival"}</p>{capturedAt && <p className="mt-1 text-[10px] text-slate-500">Registrado a las {capturedAt} · hora de captura, no reloj deportivo</p>}</div><button type="button" onClick={onClose} className="grid min-h-10 min-w-10 place-items-center rounded-xl bg-slate-800" aria-label="Cerrar detalle">×</button></div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3"><Detail label="FASE" value={event.phase}/><Detail label="ORIGEN" value={`${derivePitchOriginZone(event.origin)} · X ${Math.round(event.origin.x * 100)} · Y ${Math.round(event.origin.y * 100)}`}/>{event.defensive?.goalTarget && <Detail label="DESTINO" value={`X ${Math.round(event.defensive.goalTarget.x * 100)} · Y ${Math.round(event.defensive.goalTarget.y * 100)} · G${event.defensive.goalTarget.geometryVersion}`}/>} {player && <Detail label="JUGADOR" value={player.name}/>} {goalkeeper && <Detail label="PORTERO" value={goalkeeper.name}/>} {event.defensive?.version === 2 && event.defensive.keeperBodyPart && <Detail label="CUERPO" value={event.defensive.keeperBodyPart}/>} {event.defensive?.saveOutcome && <Detail label="DESENLACE" value={event.defensive.saveOutcome}/>} {assist && <Detail label="ASISTENCIA" value={assist}/>} {event.sequenceId && <Detail label="SECUENCIA" value={event.sequenceId}/>} {event.parentEventId && <Detail label="PADRE" value={event.parentEventId}/>}<Detail label="PROCEDENCIA" value={event.provenance ?? event.source}/></div>
    <div className="mt-3 flex items-center justify-between gap-3"><code className="truncate text-[9px] text-slate-600">eventId · {event.id}</code><Link href={revisionEventHref(record.catalog.matchId, event.id, returnTo, record.catalog.clubId === DASHBOARD_FIXTURE_CLUB_ID)} className="inline-grid min-h-11 shrink-0 place-items-center rounded-xl bg-cyan-300 px-4 text-xs font-black text-slate-950">VER EVENTO</Link></div>
  </aside>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-slate-900 p-2"><span className="block text-[8px] font-black text-slate-500">{label}</span><strong className="mt-0.5 block break-words">{value.replaceAll("_", " ")}</strong></div>; }
