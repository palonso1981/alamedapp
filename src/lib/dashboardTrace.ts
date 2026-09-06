import { DashboardGoalPoint, DashboardMatchRecord, DashboardThreatPoint } from "./dashboardAnalytics";
import { ThreatRecordedEvent } from "../types";

export type IndividualEventPoint = DashboardThreatPoint | DashboardGoalPoint;
export type DashboardTraceablePoint = IndividualEventPoint;

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
  const target = event.defensive?.goalTarget;
  return [
    event.outcome,
    `P${event.period} · min ${event.minute}`,
    record.catalog.opponent,
    event.phase.replaceAll("_", " "),
    player,
    target
      ? `Destino X ${Math.round(target.x * 100)} · Y ${Math.round(target.y * 100)}`
      : `Origen X ${Math.round(event.origin.x * 100)} · Y ${Math.round(event.origin.y * 100)}`,
    event.defensive?.version === 2 ? event.defensive.keeperBodyPart : undefined,
    event.defensive?.saveOutcome,
  ].filter(Boolean).join(" · ");
}
