import {
  CDA_CLUB_ID,
  MasterPlayer,
  MasterStaffMember,
  MatchSession,
  Season,
  TeamProfile,
  TeamWorkspace,
} from "../types";

export type AdminEntityType = "TEAM" | "SEASON" | "PLAYER" | "STAFF" | "MATCH";

export interface DeletionImpact {
  entityType: AdminEntityType;
  entityId: string;
  seasons: number;
  players: number;
  staff: number;
  matches: number;
  events: number;
  historicalReferences: boolean;
}

export interface MatchImpactSource {
  matchId: string;
  teamId?: string;
  seasonId?: string;
  playerIds?: string[];
  staffIds?: string[];
  eventCount?: number;
  deletedAt?: number;
}

function required(value: string, label: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} es obligatorio.`);
  return cleaned;
}

function optional(value?: string): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

export function createTeamProfile(
  workspace: TeamWorkspace,
  input: { name: string; shortName?: string },
  options: { teamId?: string; now?: number } = {},
): TeamWorkspace {
  const now = options.now ?? Date.now();
  const name = required(input.name, "El nombre del equipo");
  const shortName = optional(input.shortName) ?? name.slice(0, 10);
  const teamId = options.teamId ?? globalThis.crypto.randomUUID();
  if (workspace.teams.some((team) => team.teamId === teamId)) {
    throw new Error("El identificador del equipo ya existe.");
  }
  const team: TeamProfile = {
    teamId,
    clubId: workspace.clubId || CDA_CLUB_ID,
    name,
    shortName,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  return { ...workspace, teams: [...workspace.teams, team] };
}

export function updateRealTeam(
  workspace: TeamWorkspace,
  teamId: string,
  changes: Partial<Pick<TeamProfile, "name" | "shortName">>,
  now = Date.now(),
): TeamWorkspace {
  const current = workspace.teams.find((team) => team.teamId === teamId && !team.deletedAt);
  if (!current) throw new Error("El equipo no existe.");
  return {
    ...workspace,
    teams: workspace.teams.map((team) => team.teamId === teamId ? {
      ...team,
      name: changes.name === undefined ? team.name : required(changes.name, "El nombre del equipo"),
      shortName: changes.shortName === undefined ? team.shortName : optional(changes.shortName) ?? team.shortName,
      updatedAt: now,
    } : team),
  };
}

function lifecycle<T extends { active: boolean; archivedAt?: number; deletedAt?: number; updatedAt: number }>(
  entity: T,
  action: "ARCHIVE" | "REACTIVATE" | "DELETE",
  now: number,
): T {
  if (entity.deletedAt) throw new Error("La entidad ya está eliminada.");
  if (action === "ARCHIVE") return { ...entity, active: false, archivedAt: entity.archivedAt ?? now, updatedAt: now };
  if (action === "REACTIVATE") return { ...entity, active: true, archivedAt: undefined, updatedAt: now };
  return { ...entity, active: false, archivedAt: undefined, deletedAt: now, updatedAt: now };
}

export function changeAdminLifecycle(
  workspace: TeamWorkspace,
  entityType: Exclude<AdminEntityType, "MATCH">,
  entityId: string,
  action: "ARCHIVE" | "REACTIVATE" | "DELETE",
  now = Date.now(),
): TeamWorkspace {
  if (entityType === "TEAM") {
    if (!workspace.teams.some((item) => item.teamId === entityId)) throw new Error("El equipo no existe.");
    return { ...workspace, teams: workspace.teams.map((item) => item.teamId === entityId ? lifecycle(item, action, now) : item) };
  }
  if (entityType === "SEASON") {
    if (!workspace.seasons.some((item) => item.seasonId === entityId)) throw new Error("La temporada no existe.");
    return {
      ...workspace,
      seasons: workspace.seasons.map((item) => item.seasonId === entityId
        ? { ...lifecycle(item, action, now), current: action === "REACTIVATE" ? item.current : false }
        : item),
    };
  }
  if (entityType === "PLAYER") {
    if (!workspace.players.some((item) => item.playerId === entityId)) throw new Error("El jugador no existe.");
    return { ...workspace, players: workspace.players.map((item) => item.playerId === entityId ? lifecycle(item, action, now) : item) };
  }
  if (!workspace.staff.some((item) => item.staffId === entityId)) throw new Error("El miembro de staff no existe.");
  return { ...workspace, staff: workspace.staff.map((item) => item.staffId === entityId ? lifecycle(item, action, now) : item) };
}

export function availableTeams(workspace: TeamWorkspace, includeArchived = false): TeamProfile[] {
  const real = workspace.teams.filter((team) => !team.deletedAt && (includeArchived || !team.archivedAt));
  const hasLegacy = workspace.seasons.some((season) => season.teamId === workspace.teamId) ||
    (workspace.teams.length === 0 && (workspace.players.length > 0 || workspace.staff.length > 0));
  return hasLegacy && !real.some((team) => team.teamId === workspace.teamId)
    ? [{ ...workspace.team, name: workspace.team.name === "CD Alameda" ? "Equipo legacy" : workspace.team.name }, ...real]
    : real;
}

export function clubPlayers(workspace: TeamWorkspace, includeArchived = false): MasterPlayer[] {
  return workspace.players.filter((player) => !player.deletedAt && (includeArchived || !player.archivedAt));
}

export function clubStaff(workspace: TeamWorkspace, includeArchived = false): MasterStaffMember[] {
  return workspace.staff.filter((member) => !member.deletedAt && (includeArchived || !member.archivedAt));
}

export function calculateDeletionImpact(
  workspace: TeamWorkspace,
  entityType: AdminEntityType,
  entityId: string,
  matches: MatchImpactSource[] = [],
): DeletionImpact {
  const relevantMatches = matches.filter((match) => {
    if (match.deletedAt) return false;
    if (entityType === "MATCH") return match.matchId === entityId;
    if (entityType === "TEAM") return match.teamId === entityId;
    if (entityType === "SEASON") return match.seasonId === entityId;
    if (entityType === "PLAYER") return match.playerIds?.includes(entityId);
    return match.staffIds?.includes(entityId);
  });
  const seasons = entityType === "TEAM"
    ? workspace.seasons.filter((season) => season.teamId === entityId && !season.deletedAt).length
    : entityType === "SEASON" ? 1 : 0;
  const seasonIds = new Set(
    entityType === "TEAM"
      ? workspace.seasons.filter((season) => season.teamId === entityId).map((season) => season.seasonId)
      : entityType === "SEASON" ? [entityId] : [],
  );
  const players = entityType === "PLAYER" ? 1 : workspace.seasonPlayers.filter(
    (membership) => seasonIds.has(membership.seasonId) && !membership.deletedAt,
  ).length;
  const staff = entityType === "STAFF" ? 1 : workspace.seasonStaff.filter(
    (membership) => seasonIds.has(membership.seasonId) && !membership.deletedAt,
  ).length;
  const events = relevantMatches.reduce((sum, match) => sum + (match.eventCount ?? 0), 0);
  return {
    entityType,
    entityId,
    seasons,
    players,
    staff,
    matches: relevantMatches.length,
    events,
    historicalReferences: relevantMatches.length > 0 || events > 0,
  };
}

export function impactSummary(impact: DeletionImpact): string {
  const parts = [
    impact.seasons ? `${impact.seasons} temporada${impact.seasons === 1 ? "" : "s"}` : "",
    impact.players ? `${impact.players} jugador${impact.players === 1 ? "" : "es"}` : "",
    impact.staff ? `${impact.staff} miembro${impact.staff === 1 ? "" : "s"} de staff` : "",
    impact.matches ? `${impact.matches} partido${impact.matches === 1 ? "" : "s"}` : "",
    impact.events ? `${impact.events} evento${impact.events === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Sin dependencias conocidas";
}

export function isSeasonVisible(season: Season, includeArchived = false): boolean {
  return !season.deletedAt && (includeArchived || !season.archivedAt);
}

export function changeMatchLifecycle(
  session: MatchSession,
  action: "ARCHIVE" | "REACTIVATE" | "DELETE",
  now = Date.now(),
): MatchSession {
  if (!session.preparation) throw new Error("El partido no tiene preparación asociada.");
  if (session.preparation.deletedAt) throw new Error("El partido ya está eliminado.");
  const preparation = action === "ARCHIVE"
    ? { ...session.preparation, archivedAt: session.preparation.archivedAt ?? now, updatedAt: now }
    : action === "REACTIVATE"
      ? { ...session.preparation, archivedAt: undefined, updatedAt: now }
      : { ...session.preparation, archivedAt: undefined, deletedAt: now, updatedAt: now };
  return { ...session, preparation };
}
