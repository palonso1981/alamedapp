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

export interface DashboardCollectionNameContext {
  players?: ReadonlyArray<{ id: string; name: string }>;
  goalkeepers?: ReadonlyArray<{ id: string; name: string }>;
}

const PHASE_NAMES: Record<string, string> = {
  POSITIONAL: "Posicional", TRANSITION: "Transición", SET_PIECE_CORNER: "Córner",
  SET_PIECE_FREE_KICK: "Falta", SET_PIECE_KICK_IN: "Banda", FLYING_GOALKEEPER: "P-J",
  PENALTY: "Penalti", DOUBLE_PENALTY: "Doble penalti", UNSPECIFIED: "Sin fase",
};
const EVENT_NAMES: Record<string, string> = {
  SHOTS: "Remates", THREATS: "Amenazas", LOSSES: "Pérdidas", SET_PIECES: "ABP",
  SET_PIECE_CORNER: "Córner", SET_PIECE_FREE_KICK: "Falta", SET_PIECE_KICK_IN: "Banda cercana",
  SET_PIECE_PENALTY: "Penalti", SET_PIECE_DOUBLE_PENALTY: "Doble penalti", FOULS: "Faltas", CARDS: "Tarjetas",
};
const ZONE_NAMES: Record<string, string> = {
  LEFT: "Izquierda", CENTER: "Centro", RIGHT: "Derecha", Z1: "Zona cercana", Z2: "Zona media",
  Z3: "Zona lejana", TL: "Escuadra izq.", TC: "Alto centro", TR: "Escuadra der.",
  ML: "Media izq.", MC: "Centro portería", MR: "Media der.", BL: "Bajo izq.", BC: "Bajo centro", BR: "Bajo der.",
  LEFT_HIGH: "Escuadra izq.", CENTER_HIGH: "Alto centro", RIGHT_HIGH: "Escuadra der.",
  LEFT_LOW: "Bajo izq.", CENTER_LOW: "Bajo centro", RIGHT_LOW: "Bajo der.",
};

export function suggestedDashboardCollectionName(filters: VideoLibraryFilters, context: DashboardCollectionNameContext = {}, now = new Date()): string {
  const player = filters.playerIds.length === 1 ? context.players?.find((item) => item.id === filters.playerIds[0])?.name : undefined;
  const goalkeeper = filters.goalkeeperIds.length === 1 ? context.goalkeepers?.find((item) => item.id === filters.goalkeeperIds[0])?.name : undefined;
  const parts: string[] = [];
  if (goalkeeper) parts.push(`Portero ${goalkeeper}`);
  else if (player) parts.push(player);
  if (filters.side !== "ALL") parts.push(filters.side === "FOR" ? "CDA" : "Rival");
  const phase = filters.phases.length === 1 ? PHASE_NAMES[filters.phases[0]] : undefined;
  const event = filters.eventKinds.length === 1 ? EVENT_NAMES[filters.eventKinds[0]] : undefined;
  if (phase) parts.push(phase);
  if (event && event !== phase) parts.push(event);
  if (filters.outcomes.length === 1) parts.push(filters.outcomes[0] === "PARADA" ? "Paradas" : filters.outcomes[0][0] + filters.outcomes[0].slice(1).toLowerCase());
  else if (filters.outcomes.length === 2 && filters.outcomes.includes("GOL") && filters.outcomes.includes("PARADA")) parts.push("A puerta");
  const target = filters.targetZones.length === 1 ? ZONE_NAMES[filters.targetZones[0]] : undefined;
  const origin = filters.originZones.length === 1 ? ZONE_NAMES[filters.originZones[0]] : undefined;
  if (target) parts.push(target); else if (origin) parts.push(origin);
  if (!parts.length) parts.push(filters.matchIds.length === 1 ? "Partido" : "Análisis");
  const date = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(now).replaceAll("/", "-");
  return `${parts.slice(0, 5).join(" · ")} · ${date}`;
}
