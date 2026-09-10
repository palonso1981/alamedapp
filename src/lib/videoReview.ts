import { DashboardMatchRecord } from "./dashboardAnalytics";
import { DashboardScopeV2, filterDashboardDataset } from "./dashboardV2";
import { sortEvents } from "./matchEngine";
import { resolveEventVideoPosition } from "./videoIndex";
import { MatchEvent } from "../types";
import { eventDescription } from "./eventPresentation";

export type VideoReviewKind = "ALL" | "GOALS" | "SAVES" | "LOSSES";

export interface VideoReviewRow {
  record: DashboardMatchRecord;
  event: MatchEvent;
  resolution: ReturnType<typeof resolveEventVideoPosition>;
}

function matchesKind(event: MatchEvent, kind: VideoReviewKind, actorId?: string): boolean {
  if (kind === "GOALS") return event.type === "threat_recorded" && event.side === "FOR" && event.outcome === "GOL" && (!actorId || event.playerId === actorId);
  if (kind === "SAVES") return event.type === "threat_recorded" && event.side === "AGAINST" && event.outcome === "PARADA" && (!actorId || (event.defensive?.goalkeeper.status === "PLAYER" && event.defensive.goalkeeper.playerId === actorId));
  if (kind === "LOSSES") return event.type === "possession_lost" && (!actorId || event.playerId === actorId);
  return !["lineup_initialized", "substitution", "game_state_changed"].includes(event.type);
}

export function buildVideoReviewRows(records: readonly DashboardMatchRecord[], scope: DashboardScopeV2, kind: VideoReviewKind, actorId?: string): VideoReviewRow[] {
  const filtered = filterDashboardDataset(records, scope);
  const accepted = new Map(filtered.map((record) => [record.catalog.matchId, new Set(record.session.events.map((event) => event.id))]));
  return records.flatMap((record) => {
    const eventIds = accepted.get(record.catalog.matchId);
    if (!eventIds) return [];
    return sortEvents(record.session.events)
      .filter((event) => event.deletedAt === null && eventIds.has(event.id) && matchesKind(event, kind, actorId))
      .map((event) => ({ record, event, resolution: resolveEventVideoPosition(record.session, event.id) }));
  }).sort((left, right) => right.record.catalog.date.localeCompare(left.record.catalog.date) || right.event.period - left.event.period || right.event.minute - left.event.minute || right.event.order - left.event.order);
}

export function buildWhatsAppVideoText(title: string, rows: readonly VideoReviewRow[]): string {
  const lines = rows.map(({ record, event, resolution }) => {
    const prefix = `${record.catalog.opponent} · ${record.catalog.date} · P${event.period} min ${event.minute} · ${eventDescription(event, record.session.players)}`;
    return resolution.status === "RESOLVED" ? `${prefix}\n${resolution.url}` : `${prefix} · SIN VÍDEO`;
  });
  const unavailable = rows.filter((row) => row.resolution.status !== "RESOLVED").length;
  return [`ALAMEDAPP · ${title}`, ...lines, unavailable > 0 ? `${unavailable} jugada${unavailable === 1 ? "" : "s"} sin enlace disponible.` : ""].filter(Boolean).join("\n\n");
}
