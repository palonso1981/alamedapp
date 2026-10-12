import { DashboardMatchRecord } from "./dashboardAnalytics";
import { DashboardScopeV2, scopeToSearchParams } from "./dashboardV2";
import { buildVideoLibraryItems, EMPTY_VIDEO_LIBRARY_FILTERS, VideoLibraryFilters, VideoLibraryItem, videoLibraryFiltersToSearchParams } from "./videoLibrary";

export type DashboardVideoOverride = Partial<Pick<VideoLibraryFilters,
  "side" | "playerIds" | "goalkeeperIds" | "matchIds" | "eventKinds" | "phases" | "outcomes" | "originZones" | "targetZones"
>>;

export function dashboardScopeToVideoFilters(scope: DashboardScopeV2, override: DashboardVideoOverride = {}): VideoLibraryFilters {
  const specificPhases = scope.phases.filter((phase) => phase !== "SET_PIECE");
  const setPieces = scope.phases.includes("SET_PIECE") ? ["SET_PIECES" as const] : [];
  const side = scope.threatSides.length === 1 ? scope.threatSides[0] : "ALL";
  return {
    ...EMPTY_VIDEO_LIBRARY_FILTERS,
    source: "EVENT",
    side,
    playerIds: scope.playerIds,
    goalkeeperIds: scope.goalkeeperIds,
    matchIds: scope.matchIds,
    rivals: scope.rivals,
    eventKinds: setPieces,
    phases: specificPhases,
    outcomes: scope.outcomeGroup === "ON_TARGET" && scope.outcomes.length === 0 ? ["GOL", "PARADA"] : scope.outcomes,
    seasonIds: scope.seasonId ? [scope.seasonId] : [],
    periods: scope.period === "ALL" ? [] : [scope.period],
    venues: scope.venues,
    competitions: scope.competition === "ALL" ? [] : [scope.competition],
    originZones: scope.originZones,
    targetZones: scope.targetZones,
    ...override,
  };
}

export function dashboardVideoItems(records: readonly DashboardMatchRecord[], scope: DashboardScopeV2, override: DashboardVideoOverride = {}): VideoLibraryItem[] {
  return buildVideoLibraryItems(records, dashboardScopeToVideoFilters(scope, override), { dashboardScope: scope, includeClips: false });
}

export function dashboardVideoHref(scope: DashboardScopeV2, override: DashboardVideoOverride = {}, current = ""): string {
  const params = new URLSearchParams(current);
  params.set("from", "dashboard");
  const dashboard = scopeToSearchParams(scope, "a");
  Array.from(new Set(Array.from(dashboard.keys()))).forEach((key) => params.delete(key));
  dashboard.forEach((value, key) => params.append(key, value));
  const video = videoLibraryFiltersToSearchParams(dashboardScopeToVideoFilters(scope, override), params.toString(), "EVENT");
  return `/video?${video.toString()}`;
}

export function suggestedDashboardCollectionName(filters: VideoLibraryFilters, now = new Date()): string {
  const context = filters.matchIds.length === 1 ? "Partido" : filters.playerIds.length === 1 ? "Jugador" : filters.eventKinds.length === 1 ? filters.eventKinds[0].replaceAll("_", " ") : "Análisis";
  const date = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(now);
  return `${context} · ${date}`;
}
