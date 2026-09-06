import { DashboardGoalPoint, DashboardMatchRecord, DashboardThreatPoint } from "./dashboardAnalytics";
import { ThreatRecordedEvent } from "../types";

export type DashboardTraceablePoint = DashboardThreatPoint | DashboardGoalPoint;

/**
 * La identidad trazable de un punto es siempre partido + evento. Las coordenadas
 * pueden repetirse y nunca se usan para localizar el evento original.
 */
export function resolveDashboardMapPoint(
  records: readonly DashboardMatchRecord[],
  point: DashboardTraceablePoint,
): { record: DashboardMatchRecord; event: ThreatRecordedEvent } | null {
  const record = records.find((item) => item.catalog.matchId === point.matchId);
  const event = record?.session.events.find(
    (item): item is ThreatRecordedEvent => item.id === point.eventId && item.type === "threat_recorded",
  );
  return record && event ? { record, event } : null;
}

export function dashboardMapPointTitle(records: readonly DashboardMatchRecord[], point: DashboardTraceablePoint): string {
  const resolved = resolveDashboardMapPoint(records, point);
  if (!resolved) return `${point.outcome} · evento ${point.eventId}`;
  const { record, event } = resolved;
  const player = event.playerId ? record.session.players.find((item) => item.id === event.playerId)?.name : undefined;
  return [
    event.outcome,
    `P${event.period} · min ${event.minute}`,
    record.catalog.opponent,
    event.phase.replaceAll("_", " "),
    player,
    `X ${Math.round(event.origin.x * 100)} · Y ${Math.round(event.origin.y * 100)}`,
  ].filter(Boolean).join(" · ");
}
