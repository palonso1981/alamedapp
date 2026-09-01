import {
  CDA_CLUB_ID,
  ClubProfile,
  MasterPlayer,
  MasterStaffMember,
  Season,
  SeasonPlayer,
  SeasonStaff,
  TeamProfile,
  TeamRoster,
  TeamWorkspace,
} from "../types";

export interface CreateSeasonInput {
  teamId?: string;
  label: string;
  startDate?: string;
  endDate?: string;
  copyFromSeasonId?: string;
  copyLegacyRoster?: boolean;
}

export interface UpdateSeasonPlayerInput {
  number?: number;
  primaryPosition?: SeasonPlayer["primaryPosition"];
  active?: boolean;
}

export interface UpdateSeasonStaffInput {
  role?: SeasonStaff["role"];
  customRole?: string;
  active?: boolean;
}

function cleanRequired(value: string, label: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} es obligatorio.`);
  return cleaned;
}

function cleanOptional(value?: string): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function validDate(value?: string): string | undefined {
  const cleaned = cleanOptional(value);
  if (!cleaned) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned) || Number.isNaN(Date.parse(`${cleaned}T00:00:00Z`))) {
    throw new Error("La fecha de temporada no es válida.");
  }
  return cleaned;
}

function validNumber(number: number): number {
  const normalized = Math.trunc(number);
  if (!Number.isFinite(number) || normalized < 0 || normalized > 99) {
    throw new Error("El dorsal debe estar entre 0 y 99.");
  }
  return normalized;
}

export function defaultTeamProfile(teamId: string, now = Date.now(), clubId: string = CDA_CLUB_ID): TeamProfile {
  return {
    teamId,
    clubId,
    name: teamId === CDA_CLUB_ID ? "Equipo legacy" : teamId,
    shortName: teamId === CDA_CLUB_ID ? "LEGACY" : teamId.slice(0, 8).toUpperCase(),
    active: true,
    createdAt: now,
    updatedAt: now,
    revision: 0,
  };
}

export function defaultClubProfile(now = Date.now(), clubId: string = CDA_CLUB_ID): ClubProfile {
  return {
    clubId,
    name: clubId === CDA_CLUB_ID ? "Club Deportivo Alameda" : "Club",
    shortName: clubId === CDA_CLUB_ID ? "CD Alameda" : undefined,
    active: true,
    createdAt: now,
    updatedAt: now,
    revision: 0,
  };
}

export function emptyTeamWorkspace(teamId: string, now = Date.now(), club?: ClubProfile): TeamWorkspace {
  const resolvedClub = club ?? defaultClubProfile(now, teamId);
  return {
    teamId,
    clubId: teamId,
    club: resolvedClub,
    teams: [],
    team: defaultTeamProfile(teamId, now, teamId),
    players: [],
    staff: [],
    seasons: [],
    seasonPlayers: [],
    seasonStaff: [],
  };
}

export function currentSeason(workspace: TeamWorkspace, teamId?: string): Season | undefined {
  return workspace.seasons.find(
    (season) => season.current && season.active && !season.archivedAt && !season.deletedAt && (!teamId || season.teamId === teamId),
  );
}

export function seasonById(
  workspace: TeamWorkspace,
  seasonId?: string,
): Season | undefined {
  return seasonId
    ? workspace.seasons.find((season) => season.seasonId === seasonId)
    : currentSeason(workspace);
}

export function assertSeasonScope(
  workspace: TeamWorkspace,
  teamId: string,
  seasonId: string,
): Season {
  const team = workspace.teams.find((item) => item.teamId === teamId && item.clubId === workspace.clubId && item.active && !item.archivedAt && !item.deletedAt);
  if (!team) throw new Error("El equipo no pertenece al club actual o no está activo.");
  const season = workspace.seasons.find((item) => item.seasonId === seasonId && item.teamId === teamId && (item.clubId ?? workspace.clubId) === workspace.clubId && item.active && !item.archivedAt && !item.deletedAt);
  if (!season) throw new Error("La temporada no pertenece al equipo y club seleccionados.");
  return season;
}

export function updateTeamProfile(
  workspace: TeamWorkspace,
  changes: Partial<Pick<TeamProfile, "name" | "shortName" | "category" | "active">>,
  now = Date.now(),
): TeamWorkspace {
  return {
    ...workspace,
    team: {
      ...workspace.team,
      name: changes.name === undefined
        ? workspace.team.name
        : cleanRequired(changes.name, "El nombre del equipo"),
      shortName: changes.shortName === undefined
        ? workspace.team.shortName
        : cleanRequired(changes.shortName, "El nombre corto"),
      category: changes.category === undefined
        ? workspace.team.category
        : cleanOptional(changes.category),
      active: changes.active ?? workspace.team.active,
      updatedAt: now,
    },
  };
}

export function createSeason(
  workspace: TeamWorkspace,
  input: CreateSeasonInput,
  options: { seasonId?: string; now?: number } = {},
): TeamWorkspace {
  const now = options.now ?? Date.now();
  const seasonId = options.seasonId ?? globalThis.crypto.randomUUID();
  if (workspace.seasons.some((season) => season.seasonId === seasonId)) {
    throw new Error("El identificador de temporada ya existe.");
  }
  const label = cleanRequired(input.label, "El nombre de temporada");
  const startDate = validDate(input.startDate);
  const endDate = validDate(input.endDate);
  if (startDate && endDate && startDate > endDate) {
    throw new Error("La fecha de fin no puede ser anterior al inicio.");
  }
  const teamId = input.teamId ?? workspace.teamId;
  const firstSeason = !workspace.seasons.some((item) => item.teamId === teamId && !item.deletedAt);
  const season: Season = {
    seasonId,
    clubId: workspace.clubId,
    teamId,
    label,
    startDate,
    endDate,
    current: firstSeason,
    active: true,
    createdAt: now,
    updatedAt: now,
    revision: 0,
  };

  let copiedPlayers: SeasonPlayer[] = [];
  let copiedStaff: SeasonStaff[] = [];
  if (input.copyFromSeasonId) {
    if (!workspace.seasons.some((item) => item.seasonId === input.copyFromSeasonId)) {
      throw new Error("La temporada de origen no existe.");
    }
    copiedPlayers = workspace.seasonPlayers
      .filter((membership) => membership.seasonId === input.copyFromSeasonId)
      .map((membership) => ({ ...membership, clubId: workspace.clubId, teamId, seasonId, createdAt: now, updatedAt: now }));
    copiedStaff = workspace.seasonStaff
      .filter((membership) => membership.seasonId === input.copyFromSeasonId)
      .map((membership) => ({ ...membership, clubId: workspace.clubId, teamId, seasonId, createdAt: now, updatedAt: now }));
  } else if (input.copyLegacyRoster) {
    copiedPlayers = workspace.players.map((player) => ({
      clubId: workspace.clubId,
      teamId,
      seasonId,
      playerId: player.playerId,
      number: player.number,
      primaryPosition: player.primaryPosition,
      active: player.active,
      createdAt: now,
      updatedAt: now,
    }));
    copiedStaff = workspace.staff.map((member) => ({
      clubId: workspace.clubId,
      teamId,
      seasonId,
      staffId: member.staffId,
      role: member.role,
      customRole: member.customRole,
      active: member.active,
      createdAt: now,
      updatedAt: now,
    }));
  }

  return {
    ...workspace,
    seasons: [...workspace.seasons, season],
    seasonPlayers: [...workspace.seasonPlayers, ...copiedPlayers],
    seasonStaff: [...workspace.seasonStaff, ...copiedStaff],
  };
}

export function setCurrentSeason(
  workspace: TeamWorkspace,
  seasonId: string,
  now = Date.now(),
): TeamWorkspace {
  const target = workspace.seasons.find((season) => season.seasonId === seasonId);
  if (!target?.active) throw new Error("La temporada actual debe estar activa.");
  return {
    ...workspace,
    seasons: workspace.seasons.map((season) => ({
      ...season,
      current: season.teamId === target.teamId ? season.seasonId === seasonId : season.current,
      updatedAt: season.teamId !== target.teamId || season.current === (season.seasonId === seasonId) ? season.updatedAt : now,
    })),
  };
}

export function upsertSeasonPlayer(
  workspace: TeamWorkspace,
  seasonId: string,
  playerId: string,
  changes: UpdateSeasonPlayerInput,
  now = Date.now(),
): TeamWorkspace {
  const player = workspace.players.find((item) => item.playerId === playerId);
  if (!player) throw new Error("El jugador maestro no existe.");
  if (!workspace.seasons.some((season) => season.seasonId === seasonId)) {
    throw new Error("La temporada no existe.");
  }
  const current = workspace.seasonPlayers.find(
    (item) => item.seasonId === seasonId && item.playerId === playerId,
  );
  const next: SeasonPlayer = {
    clubId: workspace.clubId,
    teamId: workspace.seasons.find((season) => season.seasonId === seasonId)?.teamId ?? workspace.teamId,
    seasonId,
    playerId,
    number: changes.number === undefined
      ? current?.number ?? player.number
      : validNumber(changes.number),
    primaryPosition: changes.primaryPosition === undefined
      ? current?.primaryPosition ?? player.primaryPosition
      : changes.primaryPosition,
    active: changes.active ?? current?.active ?? player.active,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  if (next.active) {
    const duplicate = workspace.seasonPlayers.find(
      (item) =>
        item.seasonId === seasonId &&
        item.playerId !== playerId &&
        item.active &&
        item.number === next.number,
    );
    if (duplicate) throw new Error(`El dorsal ${next.number} ya está usado en esta temporada.`);
  }
  return {
    ...workspace,
    seasonPlayers: [
      ...workspace.seasonPlayers.filter(
        (item) => !(item.seasonId === seasonId && item.playerId === playerId),
      ),
      next,
    ],
  };
}

export function upsertSeasonStaff(
  workspace: TeamWorkspace,
  seasonId: string,
  staffId: string,
  changes: UpdateSeasonStaffInput,
  now = Date.now(),
): TeamWorkspace {
  const member = workspace.staff.find((item) => item.staffId === staffId);
  if (!member) throw new Error("La persona de staff no existe.");
  if (!workspace.seasons.some((season) => season.seasonId === seasonId)) {
    throw new Error("La temporada no existe.");
  }
  const current = workspace.seasonStaff.find(
    (item) => item.seasonId === seasonId && item.staffId === staffId,
  );
  const next: SeasonStaff = {
    clubId: workspace.clubId,
    teamId: workspace.seasons.find((season) => season.seasonId === seasonId)?.teamId ?? workspace.teamId,
    seasonId,
    staffId,
    role: changes.role ?? current?.role ?? member.role,
    customRole: changes.customRole === undefined
      ? current?.customRole ?? member.customRole
      : cleanOptional(changes.customRole),
    active: changes.active ?? current?.active ?? member.active,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  return {
    ...workspace,
    seasonStaff: [
      ...workspace.seasonStaff.filter(
        (item) => !(item.seasonId === seasonId && item.staffId === staffId),
      ),
      next,
    ],
  };
}

/**
 * Resuelve la plantilla visible de una temporada sin mutar las identidades
 * maestras. Si no existe membership se usa el dato legacy de forma explícita.
 */
export function rosterForSeason(
  workspace: TeamWorkspace,
  seasonId?: string,
): TeamRoster {
  if (!seasonId) {
    return { teamId: workspace.teamId, players: workspace.players, staff: workspace.staff };
  }
  const playerMemberships = new Map(
    workspace.seasonPlayers
      .filter((item) => item.seasonId === seasonId)
      .map((item) => [item.playerId, item]),
  );
  const staffMemberships = new Map(
    workspace.seasonStaff
      .filter((item) => item.seasonId === seasonId)
      .map((item) => [item.staffId, item]),
  );
  return {
    teamId: workspace.seasons.find((season) => season.seasonId === seasonId)?.teamId ?? workspace.teamId,
    players: workspace.players.filter((player) => !player.deletedAt).map((player): MasterPlayer => {
      const membership = playerMemberships.get(player.playerId);
      return membership
        ? {
            ...player,
            number: membership.number,
            primaryPosition: membership.primaryPosition,
            active: membership.active && !membership.archivedAt && !membership.deletedAt && !player.archivedAt,
          }
        : { ...player, active: false };
    }),
    staff: workspace.staff.filter((member) => !member.deletedAt).map((member): MasterStaffMember => {
      const membership = staffMemberships.get(member.staffId);
      return membership
        ? {
            ...member,
            role: membership.role,
            customRole: membership.customRole,
            active: membership.active && !membership.archivedAt && !membership.deletedAt && !member.archivedAt,
          }
        : { ...member, active: false };
    }),
  };
}

/** Añade identidades del club a una convocatoria puntual sin crear membership. */
export function rosterWithExtraPlayers(
  workspace: TeamWorkspace,
  seasonId: string | undefined,
  extraPlayerIds: readonly string[] = [],
): TeamRoster {
  const roster = rosterForSeason(workspace, seasonId);
  const extras = new Set(extraPlayerIds);
  return {
    ...roster,
    players: roster.players.map((player) => extras.has(player.playerId)
      ? { ...player, active: !player.deletedAt && !player.archivedAt }
      : player),
  };
}

export function clubExtraPlayerCandidates(
  workspace: TeamWorkspace,
  excludedPlayerIds: readonly string[] = [],
  query = "",
  includeArchived = false,
): MasterPlayer[] {
  const excluded = new Set(excludedPlayerIds);
  const normalized = query.trim().toLocaleLowerCase("es");
  return workspace.players.filter((player) =>
    !player.deletedAt &&
    ((player.active && !player.archivedAt) || (includeArchived && Boolean(player.archivedAt))) &&
    !excluded.has(player.playerId) &&
    (!normalized || `${player.fullName} ${player.displayName} ${player.number}`.toLocaleLowerCase("es").includes(normalized)),
  );
}
