import { DashboardMatchRecord } from "./dashboardAnalytics";
import { deriveThreatOriginZone, PitchOriginZone } from "./dashboardAnalysis";
import { DashboardCompetition, DashboardScopeV2, filterDashboardDataset, filterDashboardEventSelection, matchCompetition } from "./dashboardV2";
import { eventDescription } from "./eventPresentation";
import { GOAL_FRAME } from "./goalTarget";
import { deriveGoalZoneV1, GoalZoneV1 } from "./spatialZones";
import { isVideoReviewableEvent } from "./videoReview";
import { resolveEventVideoPosition } from "./videoIndex";
import { DominantFoot, MatchEvent, MatchVenue, MatchVideoAnalysisClip, ThreatOutcome, ThreatPhase, ThreatSide } from "../types";

export type VideoLibrarySource = "EVENT" | "CLIP";
export type VideoLibrarySourceFilter = "ALL" | VideoLibrarySource;
export type VideoLibrarySideFilter = "ALL" | ThreatSide;
export type VideoLibraryEventKind =
  | "SHOTS"
  | "THREATS"
  | "LOSSES"
  | "SET_PIECES"
  | "SET_PIECE_CORNER"
  | "SET_PIECE_FREE_KICK"
  | "SET_PIECE_KICK_IN"
  | "SET_PIECE_PENALTY"
  | "SET_PIECE_DOUBLE_PENALTY"
  | "FOULS"
  | "CARDS";

export interface VideoLibraryFilters {
  source: VideoLibrarySourceFilter;
  side: VideoLibrarySideFilter;
  playerIds: string[];
  matchIds: string[];
  rivals: string[];
  eventKinds: VideoLibraryEventKind[];
  phases: ThreatPhase[];
  outcomes: ThreatOutcome[];
  tags: string[];
  themes: string[];
  seasonIds: string[];
  periods: number[];
  venues: MatchVenue[];
  competitions: Exclude<DashboardCompetition, "ALL">[];
  matchdays: number[];
  goalkeeperIds: string[];
  originZones: PitchOriginZone[];
  targetZones: GoalZoneV1[];
  dominantFeet: Exclude<DominantFoot, "UNKNOWN">[];
  verifiedOnly: boolean;
}

interface BaseVideoLibraryItem {
  key: string;
  source: VideoLibrarySource;
  matchId: string;
  opponent: string;
  date: string;
  seasonId: string;
  venue: MatchVenue;
  competition: Exclude<DashboardCompetition, "ALL">;
  matchday?: number;
  period?: number;
  videoId: string;
  startSecond: number;
  endSecond: number;
  referenceSecond: number;
  verified: boolean;
  playerIds: string[];
  dominantFeet: Exclude<DominantFoot, "UNKNOWN">[];
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
  side: "ALL",
  playerIds: [],
  matchIds: [],
  rivals: [],
  eventKinds: [],
  phases: [],
  outcomes: [],
  tags: [],
  themes: [],
  seasonIds: [],
  periods: [],
  venues: [],
  competitions: [],
  matchdays: [],
  goalkeeperIds: [],
  originZones: [],
  targetZones: [],
  dominantFeet: [],
  verifiedOnly: false,
};

interface SearchParamsReader {
  get(key: string): string | null;
  getAll(key: string): string[];
  toString(): string;
}

function searchList(params: SearchParamsReader, key: string, legacyKey?: string): string[] {
  const values = params.getAll(key).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  if (values.length > 0 || !legacyKey) return Array.from(new Set(values));
  const legacy = params.get(legacyKey);
  return legacy ? [legacy] : [];
}

function searchNumbers(params: SearchParamsReader, key: string): number[] {
  return searchList(params, key).map(Number).filter((value) => Number.isInteger(value));
}

const LEGACY_EVENT_KIND: Partial<Record<MatchEvent["type"], VideoLibraryEventKind[]>> = {
  threat_recorded: ["SHOTS", "THREATS"],
  possession_lost: ["LOSSES"],
  restart_recorded: ["SET_PIECES"],
  foul_recorded: ["FOULS"],
  card_recorded: ["CARDS"],
};

function videoEventKinds(params: SearchParamsReader): VideoLibraryEventKind[] {
  return Array.from(new Set(searchList(params, "vKinds", "vKind").flatMap((value) =>
    LEGACY_EVENT_KIND[value as MatchEvent["type"]] ?? [value as VideoLibraryEventKind],
  )));
}

export function videoLibraryFiltersFromSearchParams(params: SearchParamsReader, defaultSource: VideoLibrarySourceFilter = "ALL"): VideoLibraryFilters {
  return {
    ...EMPTY_VIDEO_LIBRARY_FILTERS,
    source: (params.get("vSource") as VideoLibrarySourceFilter | null) ?? defaultSource,
    side: (params.get("vSide") as VideoLibrarySideFilter | null) ?? "ALL",
    playerIds: searchList(params, "vPlayers", "vPlayer"),
    matchIds: searchList(params, "vMatches", "vMatch"),
    rivals: searchList(params, "vRivals", "vRival").map(canonicalVideoRival),
    eventKinds: videoEventKinds(params),
    phases: searchList(params, "vPhases") as ThreatPhase[],
    outcomes: searchList(params, "vOutcomes") as ThreatOutcome[],
    tags: searchList(params, "vTags", "vTag"),
    themes: searchList(params, "vThemes", "vCategory"),
    seasonIds: searchList(params, "vSeasons", "vSeason"),
    periods: searchNumbers(params, "vPeriods"),
    venues: searchList(params, "vVenues") as MatchVenue[],
    competitions: searchList(params, "vCompetitions") as Exclude<DashboardCompetition, "ALL">[],
    matchdays: searchNumbers(params, "vMatchdays"),
    goalkeeperIds: searchList(params, "vGoalkeepers"),
    originZones: searchList(params, "vOriginZones") as PitchOriginZone[],
    targetZones: searchList(params, "vTargetZones") as GoalZoneV1[],
    dominantFeet: searchList(params, "vFeet") as Exclude<DominantFoot, "UNKNOWN">[],
    verifiedOnly: params.get("vVerified") === "1",
  };
}

export function videoLibraryFiltersToSearchParams(filters: VideoLibraryFilters, current = "", defaultSource: VideoLibrarySourceFilter = "ALL"): URLSearchParams {
  const params = new URLSearchParams(current);
  ["vPlayer", "vKind", "vCategory", "vTag", "vRival", "vMatch", "vSeason"].forEach((key) => params.delete(key));
  const scalar: Array<[string, string]> = [["vSource", filters.source === defaultSource ? "" : filters.source], ["vSide", filters.side === "ALL" ? "" : filters.side], ["vVerified", filters.verifiedOnly ? "1" : ""]];
  scalar.forEach(([key, value]) => value ? params.set(key, value) : params.delete(key));
  const lists: Array<[string, readonly (string | number)[]]> = [
    ["vPlayers", filters.playerIds], ["vMatches", filters.matchIds], ["vRivals", filters.rivals], ["vKinds", filters.eventKinds],
    ["vPhases", filters.phases], ["vOutcomes", filters.outcomes], ["vTags", filters.tags], ["vThemes", filters.themes],
    ["vSeasons", filters.seasonIds], ["vPeriods", filters.periods], ["vVenues", filters.venues], ["vCompetitions", filters.competitions],
    ["vMatchdays", filters.matchdays], ["vGoalkeepers", filters.goalkeeperIds], ["vOriginZones", filters.originZones],
    ["vTargetZones", filters.targetZones], ["vFeet", filters.dominantFeet],
  ];
  lists.forEach(([key, values]) => {
    params.delete(key);
    values.forEach((value) => params.append(key, String(value)));
  });
  return params;
}

export function canonicalVideoRival(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

export function activeVideoLibraryRecords(records: readonly DashboardMatchRecord[]): DashboardMatchRecord[] {
  return records.filter(({ catalog, session }) => !catalog.archivedAt && !catalog.deletedAt && !session.preparation?.archivedAt && !session.preparation?.deletedAt);
}

function eventPlayerIds(event: MatchEvent): string[] {
  const ids: string[] = [];
  if ("playerId" in event && typeof event.playerId === "string") ids.push(event.playerId);
  if (event.type === "threat_recorded" && event.defensive?.goalkeeper.status === "PLAYER") ids.push(event.defensive.goalkeeper.playerId);
  return Array.from(new Set(ids));
}

function playerFeet(record: DashboardMatchRecord, playerIds: readonly string[]): Exclude<DominantFoot, "UNKNOWN">[] {
  return Array.from(new Set(playerIds.flatMap((playerId) => {
    const foot = record.session.players.find((player) => player.id === playerId)?.dominantFoot;
    return foot && foot !== "UNKNOWN" ? [foot] : [];
  })));
}

function clipPeriod(segmentId: string): number | undefined {
  const match = segmentId.match(/:P([12])$/);
  return match ? Number(match[1]) : undefined;
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
      venue: record.catalog.venue,
      competition: matchCompetition(record),
      matchday: record.session.preparation?.matchday,
      period: event.period,
      videoId: resolution.videoId,
      startSecond: resolution.openSecond,
      endSecond: Math.max(resolution.openSecond + 1, resolution.estimatedSecond + resolution.leadSeconds),
      referenceSecond: resolution.estimatedSecond,
      verified,
      playerIds: eventPlayerIds(event),
      dominantFeet: playerFeet(record, eventPlayerIds(event)),
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
    venue: record.catalog.venue,
    competition: matchCompetition(record),
    matchday: record.session.preparation?.matchday,
    period: clipPeriod(clip.segmentId),
    videoId: clip.videoId,
    startSecond: clip.startSecond,
    endSecond: clip.endSecond,
    referenceSecond: clip.referenceSecond,
    verified: true,
    playerIds: clip.playerIds,
    dominantFeet: playerFeet(record, clip.playerIds),
    clip,
    title: clip.category || clip.tags[0] || "Clip de análisis",
  })));
}

function isSetPieceThreat(event: MatchEvent): boolean {
  return event.type === "threat_recorded" && [
    "SET_PIECE_CORNER",
    "SET_PIECE_FREE_KICK",
    "SET_PIECE_KICK_IN",
    "PENALTY",
    "DOUBLE_PENALTY",
  ].includes(event.phase);
}

export function matchesVideoEventKind(event: MatchEvent, kind: VideoLibraryEventKind): boolean {
  if (kind === "SHOTS") return event.type === "threat_recorded" && event.side === "FOR";
  if (kind === "THREATS") return event.type === "threat_recorded" && event.side === "AGAINST";
  if (kind === "LOSSES") return event.type === "possession_lost";
  if (kind === "FOULS") return event.type === "foul_recorded";
  if (kind === "CARDS") return event.type === "card_recorded";
  if (kind === "SET_PIECES") return event.type === "restart_recorded" || event.type === "foul_recorded" || isSetPieceThreat(event);
  if (kind === "SET_PIECE_CORNER") return (event.type === "restart_recorded" && event.restart === "CORNER") || (event.type === "threat_recorded" && event.phase === "SET_PIECE_CORNER");
  if (kind === "SET_PIECE_FREE_KICK") return event.type === "foul_recorded" || (event.type === "threat_recorded" && event.phase === "SET_PIECE_FREE_KICK");
  if (kind === "SET_PIECE_KICK_IN") return (event.type === "restart_recorded" && event.restart === "DANGEROUS_KICK_IN") || (event.type === "threat_recorded" && event.phase === "SET_PIECE_KICK_IN");
  if (kind === "SET_PIECE_PENALTY") return event.type === "threat_recorded" && event.phase === "PENALTY";
  return event.type === "threat_recorded" && event.phase === "DOUBLE_PENALTY";
}

function eventSide(event: MatchEvent): ThreatSide | null {
  return "side" in event && (event.side === "FOR" || event.side === "AGAINST") ? event.side : null;
}

function filterItems(items: VideoLibraryItem[], filters: VideoLibraryFilters): VideoLibraryItem[] {
  return items.filter((item) => {
    if (filters.source !== "ALL" && item.source !== filters.source) return false;
    if (filters.playerIds.length > 0 && !filters.playerIds.some((playerId) => item.playerIds.includes(playerId))) return false;
    if (filters.rivals.length > 0 && !filters.rivals.includes(canonicalVideoRival(item.opponent))) return false;
    if (filters.matchIds.length > 0 && !filters.matchIds.includes(item.matchId)) return false;
    if (filters.seasonIds.length > 0 && !filters.seasonIds.includes(item.seasonId)) return false;
    if (filters.periods.length > 0 && (!item.period || !filters.periods.includes(item.period))) return false;
    if (filters.venues.length > 0 && !filters.venues.includes(item.venue)) return false;
    if (filters.competitions.length > 0 && !filters.competitions.includes(item.competition)) return false;
    if (filters.matchdays.length > 0 && (!item.matchday || !filters.matchdays.includes(item.matchday))) return false;
    if (filters.dominantFeet.length > 0 && !filters.dominantFeet.some((foot) => item.dominantFeet.includes(foot))) return false;
    if (filters.verifiedOnly && !item.verified) return false;
    if (filters.side !== "ALL" && (item.source !== "EVENT" || eventSide(item.event) !== filters.side)) return false;
    if (filters.eventKinds.length > 0 && (item.source !== "EVENT" || !filters.eventKinds.some((kind) => matchesVideoEventKind(item.event, kind)))) return false;
    if (filters.phases.length > 0 && (item.source !== "EVENT" || item.event.type !== "threat_recorded" || !filters.phases.includes(item.event.phase))) return false;
    if (filters.outcomes.length > 0 && (item.source !== "EVENT" || item.event.type !== "threat_recorded" || !filters.outcomes.includes(item.event.outcome))) return false;
    if (filters.goalkeeperIds.length > 0 && (item.source !== "EVENT" || item.event.type !== "threat_recorded" || item.event.defensive?.goalkeeper.status !== "PLAYER" || !filters.goalkeeperIds.includes(item.event.defensive.goalkeeper.playerId))) return false;
    if (filters.originZones.length > 0 && (item.source !== "EVENT" || item.event.type !== "threat_recorded" || !filters.originZones.includes(deriveThreatOriginZone(item.event.origin, item.event.side)))) return false;
    if (filters.targetZones.length > 0) {
      if (item.source !== "EVENT" || item.event.type !== "threat_recorded" || !item.event.defensive || item.event.outcome === "FUERA") return false;
      const zone = deriveGoalZoneV1(item.event.defensive.goalTarget, GOAL_FRAME);
      if (zone.startsWith("OUT_") || !filters.targetZones.includes(zone as GoalZoneV1)) return false;
    }
    if (filters.themes.length > 0 && (item.source !== "CLIP" || !item.clip.category || !filters.themes.includes(item.clip.category))) return false;
    if (filters.tags.length > 0 && (item.source !== "CLIP" || !filters.tags.some((tag) => item.clip.tags.some((candidate) => candidate.toLocaleLowerCase("es") === tag.toLocaleLowerCase("es"))))) return false;
    return true;
  });
}

export function buildVideoLibraryItems(
  records: readonly DashboardMatchRecord[],
  filters: VideoLibraryFilters = EMPTY_VIDEO_LIBRARY_FILTERS,
  options: { dashboardScope?: DashboardScopeV2; includeClips?: boolean } = {},
): VideoLibraryItem[] {
  const activeRecords = activeVideoLibraryRecords(records);
  const clipsRequested = Boolean(options.includeClips || filters.source !== "EVENT" || filters.themes.length > 0 || filters.tags.length > 0);
  const scopedMatchIds = options.dashboardScope
    ? new Set(filterDashboardDataset(activeRecords, options.dashboardScope).map((record) => record.catalog.matchId))
    : null;
  const clipRecords = scopedMatchIds ? activeRecords.filter((record) => scopedMatchIds.has(record.catalog.matchId)) : activeRecords;
  const items: VideoLibraryItem[] = [
    ...eventItems(activeRecords, options.dashboardScope),
    ...(clipsRequested ? clipItems(clipRecords) : []),
  ];
  return filterItems(items, filters).sort((left, right) =>
    right.date.localeCompare(left.date) || left.matchId.localeCompare(right.matchId) || left.startSecond - right.startSecond,
  );
}

function normalizedTag(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function videoTagUsage(clips: readonly MatchVideoAnalysisClip[], tag: string): number {
  const key = normalizedTag(tag).toLocaleLowerCase("es");
  return clips.filter((clip) => clip.tags.some((candidate) => normalizedTag(candidate).toLocaleLowerCase("es") === key)).length;
}

export function renameVideoTag(clips: readonly MatchVideoAnalysisClip[], from: string, to: string, now = Date.now()): MatchVideoAnalysisClip[] {
  const source = normalizedTag(from).toLocaleLowerCase("es");
  const target = normalizedTag(to);
  if (!source || !target) return [...clips];
  return clips.map((clip) => {
    if (!clip.tags.some((tag) => normalizedTag(tag).toLocaleLowerCase("es") === source)) return clip;
    const tags = Array.from(new Map(clip.tags.map((tag) => {
      const value = normalizedTag(tag).toLocaleLowerCase("es") === source ? target : normalizedTag(tag);
      return [value.toLocaleLowerCase("es"), value];
    })).values());
    return { ...clip, tags, updatedAt: now };
  });
}

export function removeVideoTag(clips: readonly MatchVideoAnalysisClip[], tag: string, now = Date.now()): MatchVideoAnalysisClip[] {
  const key = normalizedTag(tag).toLocaleLowerCase("es");
  if (!key) return [...clips];
  return clips.map((clip) => clip.tags.some((candidate) => normalizedTag(candidate).toLocaleLowerCase("es") === key)
    ? { ...clip, tags: clip.tags.filter((candidate) => normalizedTag(candidate).toLocaleLowerCase("es") !== key), updatedAt: now }
    : clip);
}

export function nextReelIndex(items: readonly VideoLibraryItem[], current: number, direction: 1 | -1 = 1): number {
  if (items.length === 0) return -1;
  return (current + direction + items.length) % items.length;
}

export function shouldAdvanceReel(item: VideoLibraryItem | undefined, currentSecond: number, playing: boolean): boolean {
  return Boolean(playing && item && currentSecond >= item.endSecond);
}

export type ReelCutCompletion =
  | { kind: "WAIT" }
  | { kind: "NEXT"; index: number }
  | { kind: "FINISHED" };

export function reelCutCompletion(
  items: readonly VideoLibraryItem[],
  current: number,
  currentSecond: number,
  playing: boolean,
): ReelCutCompletion {
  const item = items[current];
  if (!shouldAdvanceReel(item, currentSecond, playing)) return { kind: "WAIT" };
  if (current >= items.length - 1) return { kind: "FINISHED" };
  return { kind: "NEXT", index: current + 1 };
}

export function shouldCorrectReelStart(currentSecond: number, startSecond: number, toleranceSeconds = 1.5): boolean {
  return Number.isFinite(currentSecond)
    && Number.isFinite(startSecond)
    && Math.abs(currentSecond - startSecond) > Math.max(0, toleranceSeconds);
}

export type VideoLibraryKeyboardAction = "TOGGLE_PLAYBACK" | "PREVIOUS" | "NEXT";

export function videoLibraryKeyboardAction(code: string, editableTarget: boolean): VideoLibraryKeyboardAction | null {
  if (editableTarget) return null;
  if (code === "Space") return "TOGGLE_PLAYBACK";
  if (code === "ArrowLeft") return "PREVIOUS";
  if (code === "ArrowRight") return "NEXT";
  return null;
}

export type VideoFilterMenuInteraction = "OPTION_SELECTED" | "OUTSIDE_POINTER" | "OTHER_MENU_OPENED" | "ESCAPE" | "HEADER_TOGGLE";

export function shouldCloseVideoFilterMenu(interaction: VideoFilterMenuInteraction): boolean {
  return interaction === "OUTSIDE_POINTER" || interaction === "OTHER_MENU_OPENED" || interaction === "ESCAPE";
}

export function dashboardReturnHref(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("from");
  Array.from(params.keys()).filter((key) => key.startsWith("v")).forEach((key) => params.delete(key));
  const query = params.toString();
  return `/dashboard${query ? `?${query}` : ""}`;
}
