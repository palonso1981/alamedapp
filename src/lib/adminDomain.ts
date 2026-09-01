import {
  CDA_CLUB_ID,
  MasterPlayer,
  MasterStaffMember,
  MatchSession,
  Season,
  TeamProfile,
  TeamWorkspace,
} from "../types";

export type AdminEntityType = "CLUB" | "TEAM" | "SEASON" | "PLAYER" | "STAFF" | "MATCH";

export interface DeletionImpact {
  entityType: AdminEntityType;
  entityId: string;
  teams: number;
  seasons: number;
  players: number;
  staff: number;
  matches: number;
  events: number;
  historicalReferences: boolean;
}

export interface MatchImpactSource {
  matchId: string;
  clubId?: string;
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
    revision: 0,
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
      revision: (team.revision ?? 0) + 1,
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
  entityType: Exclude<AdminEntityType, "CLUB" | "MATCH">,
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
  const real = workspace.teams.filter((team) => !team.deletedAt && (includeArchived || (team.active && !team.archivedAt)));
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
    if (entityType === "CLUB") return (match.clubId ?? CDA_CLUB_ID) === entityId;
    if (entityType === "TEAM") return match.teamId === entityId;
    if (entityType === "SEASON") return match.seasonId === entityId;
    if (entityType === "PLAYER") return match.playerIds?.includes(entityId);
    return match.staffIds?.includes(entityId);
  });
  const seasons = entityType === "CLUB"
    ? workspace.seasons.filter((season) => !season.deletedAt).length
    : entityType === "TEAM"
    ? workspace.seasons.filter((season) => season.teamId === entityId && !season.deletedAt).length
    : entityType === "SEASON" ? 1 : 0;
  const seasonIds = new Set(
    entityType === "CLUB"
      ? workspace.seasons.map((season) => season.seasonId)
      : entityType === "TEAM"
      ? workspace.seasons.filter((season) => season.teamId === entityId).map((season) => season.seasonId)
      : entityType === "SEASON" ? [entityId] : [],
  );
  const players = entityType === "CLUB"
    ? workspace.players.filter((player) => !player.deletedAt).length
    : entityType === "PLAYER" ? 1 : workspace.seasonPlayers.filter(
    (membership) => seasonIds.has(membership.seasonId) && !membership.deletedAt,
  ).length;
  const staff = entityType === "CLUB"
    ? workspace.staff.filter((member) => !member.deletedAt).length
    : entityType === "STAFF" ? 1 : workspace.seasonStaff.filter(
    (membership) => seasonIds.has(membership.seasonId) && !membership.deletedAt,
  ).length;
  const events = relevantMatches.reduce((sum, match) => sum + (match.eventCount ?? 0), 0);
  return {
    entityType,
    entityId,
    teams: entityType === "CLUB" ? workspace.teams.filter((team) => !team.deletedAt).length : entityType === "TEAM" ? 1 : 0,
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
    impact.teams ? `${impact.teams} equipo${impact.teams === 1 ? "" : "s"}` : "",
    impact.seasons ? `${impact.seasons} temporada${impact.seasons === 1 ? "" : "s"}` : "",
    impact.players ? `${impact.players} jugador${impact.players === 1 ? "" : "es"}` : "",
    impact.staff ? `${impact.staff} miembro${impact.staff === 1 ? "" : "s"} de staff` : "",
    impact.matches ? `${impact.matches} partido${impact.matches === 1 ? "" : "s"}` : "",
    impact.events ? `${impact.events} evento${impact.events === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Sin dependencias conocidas";
}

export function isSeasonVisible(season: Season, includeArchived = false): boolean {
  return !season.deletedAt && (includeArchived || (season.active && !season.archivedAt));
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

export function assignLegacyMatchSeason(
  session: MatchSession,
  workspace: TeamWorkspace,
  seasonId: string,
  now = Date.now(),
): MatchSession {
  if (!session.preparation) throw new Error("El partido no tiene preparación asociada.");
  if (session.preparation.seasonId) throw new Error("El partido ya tiene temporada asignada.");
  const matchClubId = session.preparation.clubId ?? CDA_CLUB_ID;
  if (matchClubId !== workspace.clubId) throw new Error("El partido pertenece a otro club.");
  const season = workspace.seasons.find((item) => item.seasonId === seasonId && item.active && !item.archivedAt && !item.deletedAt);
  if (!season) throw new Error("La temporada no está disponible.");
  if (session.preparation.teamId !== workspace.teamId && session.preparation.teamId !== season.teamId) {
    throw new Error("La temporada pertenece a otro equipo.");
  }
  return {
    ...session,
    preparation: {
      ...session.preparation,
      clubId: matchClubId,
      teamId: season.teamId,
      seasonId: season.seasonId,
      updatedAt: now,
    },
  };
}
