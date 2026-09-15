import { DashboardMatchRecord } from "./dashboardAnalytics";
import { DashboardScopeV2, filterDashboardDataset } from "./dashboardV2";
import { sortEvents } from "./matchEngine";
import { resolveEventVideoPosition } from "./videoIndex";
import { MatchEvent } from "../types";
import { eventDescription } from "./eventPresentation";

export type VideoReviewKind =
  | "ALL" | "GOALS" | "SHOTS_FOR" | "THREATS_AGAINST" | "SAVES" | "LOSSES"
  | "CORNERS_FOR" | "CORNERS_AGAINST" | "KICK_INS_FOR" | "KICK_INS_AGAINST"
  | "FOULS" | "CARDS";

export interface VideoReviewRow {
  record: DashboardMatchRecord;
  event: MatchEvent;
  resolution: ReturnType<typeof resolveEventVideoPosition>;
}

export function isVideoReviewableEvent(event: MatchEvent): boolean {
  return ["threat_recorded", "possession_lost", "restart_recorded", "foul_recorded", "card_recorded"].includes(event.type);
}

function matchesKind(event: MatchEvent, kind: VideoReviewKind, actorId?: string): boolean {
  if (kind === "GOALS") return event.type === "threat_recorded" && event.side === "FOR" && event.outcome === "GOL" && (!actorId || event.playerId === actorId);
  if (kind === "SHOTS_FOR") return event.type === "threat_recorded" && event.side === "FOR" && (!actorId || event.playerId === actorId);
  if (kind === "THREATS_AGAINST") return event.type === "threat_recorded" && event.side === "AGAINST";
  if (kind === "SAVES") return event.type === "threat_recorded" && event.side === "AGAINST" && event.outcome === "PARADA" && (!actorId || (event.defensive?.goalkeeper.status === "PLAYER" && event.defensive.goalkeeper.playerId === actorId));
  if (kind === "LOSSES") return event.type === "possession_lost" && (!actorId || event.playerId === actorId);
  if (kind === "CORNERS_FOR" || kind === "CORNERS_AGAINST") return event.type === "restart_recorded" && event.restart === "CORNER" && event.side === (kind === "CORNERS_FOR" ? "FOR" : "AGAINST");
  if (kind === "KICK_INS_FOR" || kind === "KICK_INS_AGAINST") return event.type === "restart_recorded" && event.restart === "DANGEROUS_KICK_IN" && event.side === (kind === "KICK_INS_FOR" ? "FOR" : "AGAINST");
  if (kind === "FOULS") return event.type === "foul_recorded";
  if (kind === "CARDS") return event.type === "card_recorded";
  return isVideoReviewableEvent(event);
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

function absoluteVideoUrl(url: string, appOrigin: string): string {
  if (!url.startsWith("/") || !appOrigin) return url;
  return new URL(url, appOrigin.endsWith("/") ? appOrigin : `${appOrigin}/`).toString();
}

export function buildWhatsAppVideoText(title: string, rows: readonly VideoReviewRow[], appOrigin = ""): string {
  const lines = rows.map(({ record, event, resolution }) => {
    const prefix = `${record.catalog.opponent} · ${record.catalog.date} · P${event.period} min ${event.minute} · ${eventDescription(event, record.session.players)}`;
    return resolution.status === "RESOLVED" ? `${prefix}\n${absoluteVideoUrl(resolution.url, appOrigin)}` : `${prefix} · SIN VÍDEO`;
  });
  const unavailable = rows.filter((row) => row.resolution.status !== "RESOLVED").length;
  return [`ALAMEDAPP · ${title}`, ...lines, unavailable > 0 ? `${unavailable} jugada${unavailable === 1 ? "" : "s"} sin enlace disponible.` : ""].filter(Boolean).join("\n\n");
}
