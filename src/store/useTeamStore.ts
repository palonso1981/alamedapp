import { create } from "zustand";

import {
  changeClubLifecycle as changeClubLifecycleDomain,
  chooseCurrentClub,
  createClubWorkspace,
  updateClub as updateClubDomain,
} from "../lib/clubDomain";
import { loadClubRegistry, saveClubRegistry } from "../lib/clubRegistry";
import {
  changeAdminLifecycle,
  createTeamProfile,
  updateRealTeam,
} from "../lib/adminDomain";
import {
  createMasterPlayer,
  createMasterStaff,
  MasterPlayerInput,
  MasterStaffInput,
  updateMasterPlayer,
  updateMasterStaff,
} from "../lib/rosterDomain";
import {
  createSeason as createSeasonDomain,
  CreateSeasonInput,
  currentSeason,
  setCurrentSeason as setCurrentSeasonDomain,
  updateTeamProfile,
  updateSeasonDetails as updateSeasonDetailsDomain,
  upsertSeasonPlayer,
  upsertSeasonStaff,
} from "../lib/seasonDomain";
import { browserTeamRepository } from "../lib/sync/localTeamRepository";
import {
  CDA_CLUB_ID,
  ClubProfile,
  ManagedPlayerPhoto,
  MasterPlayer,
  MasterStaffMember,
  TeamProfile,
  TeamWorkspace,
} from "../types";

interface TeamState {
  teams: Record<string, TeamWorkspace>;
  errors: Record<string, string | null>;
  clubIds: string[];
  currentClubId: string;
  registryReady: boolean;
  ensureRegistry: () => void;
  createClub: (input: { name: string; shortName?: string }) => string | null;
  setCurrentClub: (clubId: string) => void;
  updateClub: (clubId: string, changes: Partial<Pick<ClubProfile, "name" | "shortName">>) => void;
  changeClubLifecycle: (clubId: string, action: "ARCHIVE" | "REACTIVATE" | "DELETE") => void;
  ensureTeam: (teamId: string) => void;
  updateTeam: (teamId: string, changes: Partial<Pick<TeamProfile, "name" | "shortName" | "category" | "active">>) => void;
  createRealTeam: (scopeId: string, input: { name: string; shortName?: string }) => string | null;
  updateRealTeam: (scopeId: string, realTeamId: string, changes: Partial<Pick<TeamProfile, "name" | "shortName">>) => void;
  changeLifecycle: (scopeId: string, entityType: "TEAM" | "SEASON" | "PLAYER" | "STAFF", entityId: string, action: "ARCHIVE" | "REACTIVATE" | "DELETE") => void;
  createSeason: (teamId: string, input: CreateSeasonInput) => string | null;
  updateSeasonDetails: (teamId: string, seasonId: string, changes: { label?: string; category?: string; startDate?: string; endDate?: string }) => void;
  setCurrentSeason: (teamId: string, seasonId: string) => void;
  /** `null` crea solo la identidad de club, sin membership. */
  createPlayer: (teamId: string, input: MasterPlayerInput, seasonId?: string | null) => string | null;
  addPlayerToSeason: (teamId: string, seasonId: string, playerId: string, number?: number) => void;
  updatePlayer: (
    teamId: string,
    playerId: string,
    changes: Partial<MasterPlayerInput> & { active?: boolean },
    seasonId?: string | null,
  ) => void;
  setPlayerManagedPhoto: (teamId: string, playerId: string, photo: ManagedPlayerPhoto | null) => boolean;
  createStaff: (teamId: string, input: MasterStaffInput, seasonId?: string | null) => string | null;
  updateStaff: (
    teamId: string,
    staffId: string,
    changes: Partial<MasterStaffInput> & { active?: boolean },
    seasonId?: string | null,
  ) => void;
  clearError: (teamId: string) => void;
}

function saveRoster(roster: TeamWorkspace): boolean {
  return browserTeamRepository.save(roster);
}

export const useTeamStore = create<TeamState>((set, get) => ({
  teams: {},
  errors: {},
  clubIds: [CDA_CLUB_ID],
  currentClubId: CDA_CLUB_ID,
  registryReady: false,
  ensureRegistry: () =>
    set((state) => {
      if (state.registryReady) return state;
      const registry = loadClubRegistry();
      const teams = { ...state.teams };
      for (const clubId of registry.clubIds) teams[clubId] ??= browserTeamRepository.load(clubId);
      const currentClubId = chooseCurrentClub(registry, Object.values(teams).map((workspace) => workspace.club));
      const nextRegistry = { ...registry, currentClubId };
      saveClubRegistry(nextRegistry);
      return { teams, clubIds: nextRegistry.clubIds, currentClubId, registryReady: true };
    }),
  createClub: (input) => {
    try {
      const workspace = createClubWorkspace(input);
      if (!saveRoster(workspace)) throw new Error("No se pudo guardar el club.");
      const registry = loadClubRegistry();
      const nextRegistry = {
        ...registry,
        clubIds: Array.from(new Set([...registry.clubIds, workspace.clubId])),
        currentClubId: workspace.clubId,
      };
      if (!saveClubRegistry(nextRegistry)) throw new Error("No se pudo guardar el selector de club.");
      set((state) => ({
        teams: { ...state.teams, [workspace.clubId]: workspace },
        clubIds: nextRegistry.clubIds,
        currentClubId: workspace.clubId,
        registryReady: true,
        errors: { ...state.errors, [workspace.clubId]: null },
      }));
      return workspace.clubId;
    } catch (error) {
      set((state) => ({ errors: { ...state.errors, [state.currentClubId]: error instanceof Error ? error.message : "No se pudo crear el club." } }));
      return null;
    }
  },
  setCurrentClub: (clubId) => {
    const workspace = get().teams[clubId] ?? browserTeamRepository.load(clubId);
    if (!workspace.club.active || workspace.club.archivedAt || workspace.club.deletedAt) return;
    const registry = loadClubRegistry();
    const nextRegistry = { ...registry, clubIds: Array.from(new Set([...registry.clubIds, clubId])), currentClubId: clubId };
    if (!saveClubRegistry(nextRegistry)) return;
    set((state) => ({ teams: { ...state.teams, [clubId]: workspace }, clubIds: nextRegistry.clubIds, currentClubId: clubId, registryReady: true }));
  },
  updateClub: (clubId, changes) =>
    set((state) => {
      const workspace = state.teams[clubId] ?? browserTeamRepository.load(clubId);
      try {
        const next = updateClubDomain(workspace, changes);
        if (!saveRoster(next)) throw new Error("No se pudo guardar el club.");
        return { teams: { ...state.teams, [clubId]: next }, errors: { ...state.errors, [clubId]: null } };
      } catch (error) {
        return { errors: { ...state.errors, [clubId]: error instanceof Error ? error.message : "No se pudo editar el club." } };
      }
    }),
  changeClubLifecycle: (clubId, action) => {
    const workspace = get().teams[clubId] ?? browserTeamRepository.load(clubId);
    try {
      const next = changeClubLifecycleDomain(workspace, action);
      if (!saveRoster(next)) throw new Error("No se pudo guardar el club.");
      const registry = loadClubRegistry();
      const all = registry.clubIds.map((id) => id === clubId ? next : get().teams[id] ?? browserTeamRepository.load(id));
      const currentClubId = chooseCurrentClub(registry, all.map((item) => item.club));
      const nextRegistry = { ...registry, currentClubId };
      saveClubRegistry(nextRegistry);
      set((state) => ({ teams: { ...state.teams, [clubId]: next }, currentClubId, clubIds: nextRegistry.clubIds, errors: { ...state.errors, [clubId]: null } }));
    } catch (error) {
      set((state) => ({ errors: { ...state.errors, [clubId]: error instanceof Error ? error.message : "No se pudo cambiar el club." } }));
    }
  },
  ensureTeam: (teamId) =>
    set((state) =>
      state.teams[teamId]
        ? state
        : {
            teams: { ...state.teams, [teamId]: browserTeamRepository.load(teamId) },
          },
    ),
  updateTeam: (teamId, changes) =>
    set((state) => {
      const workspace = state.teams[teamId] ?? browserTeamRepository.load(teamId);
      try {
        const next = updateTeamProfile(workspace, changes);
        if (!saveRoster(next)) throw new Error("No se pudo guardar el equipo.");
        return {
          teams: { ...state.teams, [teamId]: next },
          errors: { ...state.errors, [teamId]: null },
        };
      } catch (error) {
        return { errors: { ...state.errors, [teamId]: error instanceof Error ? error.message : "No se pudo editar." } };
      }
    }),
  createRealTeam: (scopeId, input) => {
    try {
      const workspace = get().teams[scopeId] ?? browserTeamRepository.load(scopeId);
      const realTeamId = globalThis.crypto.randomUUID();
      const next = createTeamProfile(workspace, input, { teamId: realTeamId });
      if (!saveRoster(next)) throw new Error("No se pudo guardar el equipo.");
      set((state) => ({ teams: { ...state.teams, [scopeId]: next }, errors: { ...state.errors, [scopeId]: null } }));
      return realTeamId;
    } catch (error) {
      set((state) => ({ errors: { ...state.errors, [scopeId]: error instanceof Error ? error.message : "No se pudo crear el equipo." } }));
      return null;
    }
  },
  updateRealTeam: (scopeId, realTeamId, changes) =>
    set((state) => {
      const workspace = state.teams[scopeId] ?? browserTeamRepository.load(scopeId);
      try {
        const next = updateRealTeam(workspace, realTeamId, changes);
        if (!saveRoster(next)) throw new Error("No se pudo guardar el equipo.");
        return { teams: { ...state.teams, [scopeId]: next }, errors: { ...state.errors, [scopeId]: null } };
      } catch (error) {
        return { errors: { ...state.errors, [scopeId]: error instanceof Error ? error.message : "No se pudo editar." } };
      }
    }),
  changeLifecycle: (scopeId, entityType, entityId, action) =>
    set((state) => {
      const workspace = state.teams[scopeId] ?? browserTeamRepository.load(scopeId);
      try {
        const next = changeAdminLifecycle(workspace, entityType, entityId, action);
        if (!saveRoster(next)) throw new Error("No se pudo guardar el cambio.");
        return { teams: { ...state.teams, [scopeId]: next }, errors: { ...state.errors, [scopeId]: null } };
      } catch (error) {
        return { errors: { ...state.errors, [scopeId]: error instanceof Error ? error.message : "No se pudo cambiar." } };
      }
    }),
  createSeason: (teamId, input) => {
    try {
      const workspace = get().teams[teamId] ?? browserTeamRepository.load(teamId);
      const seasonId = globalThis.crypto.randomUUID();
      const next = createSeasonDomain(workspace, input, { seasonId });
      if (!saveRoster(next)) throw new Error("No se pudo guardar la temporada.");
      set((state) => ({
        teams: { ...state.teams, [teamId]: next },
        errors: { ...state.errors, [teamId]: null },
      }));
      return seasonId;
    } catch (error) {
      set((state) => ({
        errors: { ...state.errors, [teamId]: error instanceof Error ? error.message : "No se pudo crear la temporada." },
      }));
      return null;
    }
  },
  updateSeasonDetails: (teamId, seasonId, changes) =>
    set((state) => {
      const workspace = state.teams[teamId] ?? browserTeamRepository.load(teamId);
      try {
        const next = updateSeasonDetailsDomain(workspace, seasonId, changes);
        if (!saveRoster(next)) throw new Error("No se pudo guardar la temporada.");
        return { teams: { ...state.teams, [teamId]: next }, errors: { ...state.errors, [teamId]: null } };
      } catch (error) {
        return { errors: { ...state.errors, [teamId]: error instanceof Error ? error.message : "No se pudo editar la temporada." } };
      }
    }),
  setCurrentSeason: (teamId, seasonId) =>
    set((state) => {
      const workspace = state.teams[teamId] ?? browserTeamRepository.load(teamId);
      try {
        const next = setCurrentSeasonDomain(workspace, seasonId);
        if (!saveRoster(next)) throw new Error("No se pudo guardar la temporada actual.");
        return {
          teams: { ...state.teams, [teamId]: next },
          errors: { ...state.errors, [teamId]: null },
        };
      } catch (error) {
        return { errors: { ...state.errors, [teamId]: error instanceof Error ? error.message : "No se pudo cambiar." } };
      }
    }),
  createPlayer: (teamId, input, requestedSeasonId) => {
    try {
      const roster = get().teams[teamId] ?? browserTeamRepository.load(teamId);
      const seasonId = requestedSeasonId === null
        ? undefined
        : requestedSeasonId ?? currentSeason(roster)?.seasonId;
      const player = createMasterPlayer(
        // El dorsal es una propiedad de la membership; no debe ser único en todo el club.
        roster.players.map((item) => ({ ...item, active: false })),
        input,
        { clubId: roster.clubId },
      );
      let next: TeamWorkspace = { ...roster, players: [...roster.players, player] };
      if (seasonId) {
        next = upsertSeasonPlayer(next, seasonId, player.playerId, {
          number: input.number,
          primaryPosition: input.primaryPosition,
          active: true,
        });
      }
      if (!saveRoster(next)) throw new Error("No se pudo guardar la plantilla.");
      set((state) => ({
        teams: { ...state.teams, [teamId]: next },
        errors: { ...state.errors, [teamId]: null },
      }));
      return player.playerId;
    } catch (error) {
      set((state) => ({
        errors: {
          ...state.errors,
          [teamId]: error instanceof Error ? error.message : "No se pudo crear.",
        },
      }));
      return null;
    }
  },
  addPlayerToSeason: (teamId, seasonId, playerId, number) =>
    set((state) => {
      const workspace = state.teams[teamId] ?? browserTeamRepository.load(teamId);
      try {
        const player = workspace.players.find((item) => item.playerId === playerId && !item.deletedAt);
        if (!player) throw new Error("El jugador del club no existe.");
        const next = upsertSeasonPlayer(workspace, seasonId, playerId, {
          number: number ?? player.number,
          primaryPosition: player.primaryPosition,
          active: true,
        });
        if (!saveRoster(next)) throw new Error("No se pudo añadir a la plantilla.");
        return { teams: { ...state.teams, [teamId]: next }, errors: { ...state.errors, [teamId]: null } };
      } catch (error) {
        return { errors: { ...state.errors, [teamId]: error instanceof Error ? error.message : "No se pudo añadir." } };
      }
    }),
  updatePlayer: (teamId, playerId, changes, requestedSeasonId) =>
    set((state) => {
      const roster = state.teams[teamId] ?? browserTeamRepository.load(teamId);
      try {
        const seasonId = requestedSeasonId === null ? undefined : requestedSeasonId ?? currentSeason(roster)?.seasonId;
        const masterChanges = seasonId
          ? { ...changes, number: undefined, primaryPosition: undefined, active: undefined }
          : changes;
        let next: TeamWorkspace = {
          ...roster,
          players: updateMasterPlayer(roster.players, playerId, masterChanges),
        };
        if (seasonId) {
          next = upsertSeasonPlayer(next, seasonId, playerId, {
            number: changes.number,
            primaryPosition: changes.primaryPosition,
            active: changes.active,
          });
        }
        if (!saveRoster(next)) throw new Error("No se pudo guardar la plantilla.");
        return {
          teams: { ...state.teams, [teamId]: next },
          errors: { ...state.errors, [teamId]: null },
        };
      } catch (error) {
        return {
          errors: {
            ...state.errors,
            [teamId]: error instanceof Error ? error.message : "No se pudo editar.",
          },
        };
      }
    }),
  setPlayerManagedPhoto: (teamId, playerId, photo) => {
    const roster = get().teams[teamId] ?? browserTeamRepository.load(teamId);
    try {
      const next: TeamWorkspace = { ...roster, players: updateMasterPlayer(roster.players, playerId, { managedPhoto: photo }) };
      if (!saveRoster(next)) throw new Error("No se pudo guardar la referencia de la foto.");
      set((state) => ({ teams: { ...state.teams, [teamId]: next }, errors: { ...state.errors, [teamId]: null } }));
      return true;
    } catch (error) {
      set((state) => ({ errors: { ...state.errors, [teamId]: error instanceof Error ? error.message : "No se pudo guardar la foto." } }));
      return false;
    }
  },
  createStaff: (teamId, input, requestedSeasonId) => {
    try {
      const roster = get().teams[teamId] ?? browserTeamRepository.load(teamId);
      const member = createMasterStaff(input, { clubId: roster.clubId });
      const seasonId = requestedSeasonId === null ? undefined : requestedSeasonId ?? currentSeason(roster)?.seasonId;
      let next: TeamWorkspace = { ...roster, staff: [...roster.staff, member] };
      if (seasonId) {
        next = upsertSeasonStaff(next, seasonId, member.staffId, {
          role: input.role,
          customRole: input.customRole,
          active: true,
        });
      }
      if (!saveRoster(next)) throw new Error("No se pudo guardar la plantilla.");
      set((state) => ({
        teams: { ...state.teams, [teamId]: next },
        errors: { ...state.errors, [teamId]: null },
      }));
      return member.staffId;
    } catch (error) {
      set((state) => ({
        errors: {
          ...state.errors,
          [teamId]: error instanceof Error ? error.message : "No se pudo crear.",
        },
      }));
      return null;
    }
  },
  updateStaff: (teamId, staffId, changes, requestedSeasonId) =>
    set((state) => {
      const roster = state.teams[teamId] ?? browserTeamRepository.load(teamId);
      try {
        const seasonId = requestedSeasonId === null ? undefined : requestedSeasonId ?? currentSeason(roster)?.seasonId;
        const masterChanges = seasonId
          ? { ...changes, role: undefined, customRole: undefined, active: undefined }
          : changes;
        let next: TeamWorkspace = {
          ...roster,
          staff: updateMasterStaff(roster.staff, staffId, masterChanges),
        };
        if (seasonId) {
          next = upsertSeasonStaff(next, seasonId, staffId, {
            role: changes.role,
            customRole: changes.customRole,
            active: changes.active,
          });
        }
        if (!saveRoster(next)) throw new Error("No se pudo guardar la plantilla.");
        return {
          teams: { ...state.teams, [teamId]: next },
          errors: { ...state.errors, [teamId]: null },
        };
      } catch (error) {
        return {
          errors: {
            ...state.errors,
            [teamId]: error instanceof Error ? error.message : "No se pudo editar.",
          },
        };
      }
    }),
  clearError: (teamId) =>
    set((state) => ({ errors: { ...state.errors, [teamId]: null } })),
}));

export type { MasterPlayer, MasterStaffMember };
