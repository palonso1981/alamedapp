import { CDA_CLUB_ID, ClubProfile, TeamWorkspace } from "../types";
import { emptyTeamWorkspace } from "./seasonDomain";

export interface ClubRegistryState {
  schemaVersion: 1;
  clubIds: string[];
  currentClubId: string;
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

export function defaultClubRegistry(): ClubRegistryState {
  return { schemaVersion: 1, clubIds: [CDA_CLUB_ID], currentClubId: CDA_CLUB_ID };
}

export function createClubWorkspace(
  input: { name: string; shortName?: string },
  options: { clubId?: string; now?: number } = {},
): TeamWorkspace {
  const now = options.now ?? Date.now();
  const clubId = options.clubId ?? globalThis.crypto.randomUUID();
  const club: ClubProfile = {
    clubId,
    name: required(input.name, "El nombre del club"),
    shortName: optional(input.shortName),
    active: true,
    createdAt: now,
    updatedAt: now,
    revision: 0,
  };
  return emptyTeamWorkspace(clubId, now, club);
}

export function updateClub(
  workspace: TeamWorkspace,
  changes: Partial<Pick<ClubProfile, "name" | "shortName">>,
  now = Date.now(),
): TeamWorkspace {
  return {
    ...workspace,
    club: {
      ...workspace.club,
      name: changes.name === undefined ? workspace.club.name : required(changes.name, "El nombre del club"),
      shortName: changes.shortName === undefined ? workspace.club.shortName : optional(changes.shortName),
      updatedAt: now,
      revision: workspace.club.revision + 1,
    },
  };
}

export function changeClubLifecycle(
  workspace: TeamWorkspace,
  action: "ARCHIVE" | "REACTIVATE" | "DELETE",
  now = Date.now(),
): TeamWorkspace {
  if (workspace.club.deletedAt) throw new Error("El club ya está eliminado.");
  const club: ClubProfile = action === "ARCHIVE"
    ? { ...workspace.club, active: false, archivedAt: workspace.club.archivedAt ?? now, updatedAt: now, revision: workspace.club.revision + 1 }
    : action === "REACTIVATE"
      ? { ...workspace.club, active: true, archivedAt: undefined, updatedAt: now, revision: workspace.club.revision + 1 }
      : { ...workspace.club, active: false, archivedAt: undefined, deletedAt: now, updatedAt: now, revision: workspace.club.revision + 1 };
  return { ...workspace, club };
}

export function chooseCurrentClub(
  registry: ClubRegistryState,
  clubs: readonly ClubProfile[],
): string {
  const current = clubs.find((club) => club.clubId === registry.currentClubId && club.active && !club.archivedAt && !club.deletedAt);
  if (current) return current.clubId;
  return clubs.find((club) => club.active && !club.archivedAt && !club.deletedAt)?.clubId ?? registry.currentClubId;
}

export function clubVisible(club: ClubProfile, includeArchived = false): boolean {
  return !club.deletedAt && (includeArchived || !club.archivedAt);
}
