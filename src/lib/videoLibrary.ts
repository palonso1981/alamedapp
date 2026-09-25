import { DashboardMatchRecord } from "./dashboardAnalytics";
import { DashboardScopeV2, filterDashboardDataset, filterDashboardEventSelection } from "./dashboardV2";
import { eventDescription } from "./eventPresentation";
import { isVideoReviewableEvent } from "./videoReview";
import { resolveEventVideoPosition } from "./videoIndex";
import { MatchEvent, MatchVideoAnalysisClip } from "../types";

export type VideoLibraryEventKind = "ALL" | MatchEvent["type"];
export type VideoLibrarySource = "EVENT" | "CLIP";
export type VideoLibrarySourceFilter = "ALL" | VideoLibrarySource;

export interface VideoLibraryFilters {
  source: VideoLibrarySourceFilter;
  playerId: string;
  eventKind: VideoLibraryEventKind;
  category: string;
  tag: string;
  rival: string;
  matchId: string;
  seasonId: string;
  verifiedOnly: boolean;
}

interface BaseVideoLibraryItem {
  key: string;
  source: VideoLibrarySource;
  matchId: string;
  opponent: string;
  date: string;
  seasonId: string;
  videoId: string;
  startSecond: number;
  endSecond: number;
  referenceSecond: number;
  verified: boolean;
  playerIds: string[];
}

export interface VideoLibraryEventItem extends BaseVideoLibraryItem {
  source: "EVENT";
  event: MatchEvent;
  title: string;
}

export interface VideoLibraryClipItem extends BaseVideoLibraryItem {
  source: "CLIP";
  clip: MatchVideoAnalysisClip;
  title: string;
}

export type VideoLibraryItem = VideoLibraryEventItem | VideoLibraryClipItem;

export const EMPTY_VIDEO_LIBRARY_FILTERS: VideoLibraryFilters = {
  source: "ALL",
  playerId: "",
  eventKind: "ALL",
  category: "",
  tag: "",
  rival: "",
  matchId: "",
  seasonId: "",
  verifiedOnly: false,
};

function eventPlayerIds(event: MatchEvent): string[] {
  const ids: string[] = [];
  if ("playerId" in event && typeof event.playerId === "string") ids.push(event.playerId);
  if (event.type === "threat_recorded" && event.defensive?.goalkeeper.status === "PLAYER") ids.push(event.defensive.goalkeeper.playerId);
  return Array.from(new Set(ids));
}

function eventItems(records: readonly DashboardMatchRecord[], scope?: DashboardScopeV2): VideoLibraryEventItem[] {
  const scoped = scope ? filterDashboardEventSelection(records, scope) : records;
  const accepted = new Map(scoped.map((record) => [
    record.catalog.matchId,
    new Set(record.session.events.map((event) => event.id)),
  ]));
  return records.flatMap((record) => record.session.events.flatMap((event) => {
    if (!accepted.get(record.catalog.matchId)?.has(event.id)) return [];
    if (event.deletedAt !== null || !isVideoReviewableEvent(event)) return [];
    const resolution = resolveEventVideoPosition(record.session, event.id);
    if (resolution.status !== "RESOLVED") return [];
    const verified = (record.session.videoEventOverrides ?? []).some((override) => override.eventId === event.id && override.status === "VERIFIED");
    return [{
      key: `EVENT:${record.catalog.matchId}:${event.id}`,
      source: "EVENT" as const,
      matchId: record.catalog.matchId,
      opponent: record.catalog.opponent,
      date: record.catalog.date,
      seasonId: record.catalog.seasonId ?? "",
      videoId: resolution.videoId,
      startSecond: resolution.openSecond,
      endSecond: Math.max(resolution.openSecond + 1, resolution.estimatedSecond + resolution.leadSeconds),
      referenceSecond: resolution.estimatedSecond,
      verified,
      playerIds: eventPlayerIds(event),
      event,
      title: eventDescription(event, record.session.players, undefined, record.session.staff),
    }];
  }));
}

function clipItems(records: readonly DashboardMatchRecord[]): VideoLibraryClipItem[] {
  return records.flatMap((record) => (record.session.videoAnalysisClips ?? []).map((clip) => ({
    key: `CLIP:${record.catalog.matchId}:${clip.id}`,
    source: "CLIP" as const,
    matchId: record.catalog.matchId,
    opponent: record.catalog.opponent,
    date: record.catalog.date,
    seasonId: record.catalog.seasonId ?? "",
    videoId: clip.videoId,
    startSecond: clip.startSecond,
    endSecond: clip.endSecond,
    referenceSecond: clip.referenceSecond,
    verified: true,
    playerIds: clip.playerIds,
    clip,
    title: clip.category || clip.tags[0] || "Clip de análisis",
  })));
}

function filterItems(items: VideoLibraryItem[], filters: VideoLibraryFilters): VideoLibraryItem[] {
  return items.filter((item) => {
    if (filters.source !== "ALL" && item.source !== filters.source) return false;
    if (filters.playerId && !item.playerIds.includes(filters.playerId)) return false;
    if (filters.rival && item.opponent !== filters.rival) return false;
    if (filters.matchId && item.matchId !== filters.matchId) return false;
    if (filters.seasonId && item.seasonId !== filters.seasonId) return false;
    if (filters.verifiedOnly && !item.verified) return false;
    if (filters.eventKind !== "ALL" && (item.source !== "EVENT" || item.event.type !== filters.eventKind)) return false;
    if (filters.category && (item.source !== "CLIP" || item.clip.category !== filters.category)) return false;
    if (filters.tag && (item.source !== "CLIP" || !item.clip.tags.includes(filters.tag))) return false;
    return true;
  });
}

export function buildVideoLibraryItems(
  records: readonly DashboardMatchRecord[],
  filters: VideoLibraryFilters = EMPTY_VIDEO_LIBRARY_FILTERS,
  options: { dashboardScope?: DashboardScopeV2; includeClips?: boolean } = {},
): VideoLibraryItem[] {
  const clipsRequested = Boolean(options.includeClips || filters.source !== "EVENT" || filters.category || filters.tag);
  const scopedMatchIds = options.dashboardScope
    ? new Set(filterDashboardDataset(records, options.dashboardScope).map((record) => record.catalog.matchId))
    : null;
  const clipRecords = scopedMatchIds ? records.filter((record) => scopedMatchIds.has(record.catalog.matchId)) : records;
  const items: VideoLibraryItem[] = [
    ...eventItems(records, options.dashboardScope),
    ...(clipsRequested ? clipItems(clipRecords) : []),
  ];
  return filterItems(items, filters).sort((left, right) =>
    right.date.localeCompare(left.date) || left.matchId.localeCompare(right.matchId) || left.startSecond - right.startSecond,
  );
}

export function nextReelIndex(items: readonly VideoLibraryItem[], current: number, direction: 1 | -1 = 1): number {
  if (items.length === 0) return -1;
  return (current + direction + items.length) % items.length;
}

export function shouldAdvanceReel(item: VideoLibraryItem | undefined, currentSecond: number, playing: boolean): boolean {
  return Boolean(playing && item && currentSecond >= item.endSecond);
}

export type VideoLibraryKeyboardAction = "TOGGLE_PLAYBACK" | "PREVIOUS" | "NEXT";

export function videoLibraryKeyboardAction(code: string, editableTarget: boolean): VideoLibraryKeyboardAction | null {
  if (editableTarget) return null;
  if (code === "Space") return "TOGGLE_PLAYBACK";
  if (code === "ArrowLeft") return "PREVIOUS";
  if (code === "ArrowRight") return "NEXT";
  return null;
}

export function dashboardReturnHref(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("from");
  Array.from(params.keys()).filter((key) => key.startsWith("v")).forEach((key) => params.delete(key));
  const query = params.toString();
  return `/dashboard${query ? `?${query}` : ""}`;
}
