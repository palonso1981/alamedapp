import { create } from "zustand";

import {
  changeAdminLifecycle,
  createTeamProfile,
  updateRealTeam,
} from "../lib/adminDomain";
import {
  createMasterPlayer,
  createMasterStaff,
  findClubPlayerByIdentity,
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
  upsertSeasonPlayer,
  upsertSeasonStaff,
} from "../lib/seasonDomain";
import { browserTeamRepository } from "../lib/sync/localTeamRepository";
import {
  MasterPlayer,
  MasterStaffMember,
  TeamProfile,
  TeamWorkspace,
} from "../types";

interface TeamState {
  teams: Record<string, TeamWorkspace>;
  errors: Record<string, string | null>;
  ensureTeam: (teamId: string) => void;
  updateTeam: (teamId: string, changes: Partial<Pick<TeamProfile, "name" | "shortName" | "category" | "active">>) => void;
  createRealTeam: (scopeId: string, input: { name: string; shortName?: string }) => string | null;
  updateRealTeam: (scopeId: string, realTeamId: string, changes: Partial<Pick<TeamProfile, "name" | "shortName">>) => void;
  changeLifecycle: (scopeId: string, entityType: "TEAM" | "SEASON" | "PLAYER" | "STAFF", entityId: string, action: "ARCHIVE" | "REACTIVATE" | "DELETE") => void;
  createSeason: (teamId: string, input: CreateSeasonInput) => string | null;
  setCurrentSeason: (teamId: string, seasonId: string) => void;
  /** `null` crea solo la identidad de club, sin membership. */
  createPlayer: (teamId: string, input: MasterPlayerInput, seasonId?: string | null) => string | null;
  addPlayerToSeason: (teamId: string, seasonId: string, playerId: string, number?: number) => void;
  updatePlayer: (
    teamId: string,
    playerId: string,
    changes: Partial<MasterPlayerInput> & { active?: boolean },
    seasonId?: string,
  ) => void;
  createStaff: (teamId: string, input: MasterStaffInput, seasonId?: string) => string | null;
  updateStaff: (
    teamId: string,
    staffId: string,
    changes: Partial<MasterStaffInput> & { active?: boolean },
    seasonId?: string,
  ) => void;
  clearError: (teamId: string) => void;
}

function saveRoster(roster: TeamWorkspace): boolean {
  return browserTeamRepository.save(roster);
}

export const useTeamStore = create<TeamState>((set, get) => ({
  teams: {},
  errors: {},
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
      const duplicate = findClubPlayerByIdentity(roster.players, input.fullName);
      if (duplicate) throw new Error(`${duplicate.displayName} ya existe en el club. Usa su identidad existente.`);
      const seasonId = requestedSeasonId === null
        ? undefined
        : requestedSeasonId ?? currentSeason(roster)?.seasonId;
      const player = createMasterPlayer(
        // El dorsal es una propiedad de la membership; no debe ser único en todo el club.
        roster.players.map((item) => ({ ...item, active: false })),
        input,
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
        const seasonId = requestedSeasonId ?? currentSeason(roster)?.seasonId;
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
  createStaff: (teamId, input, requestedSeasonId) => {
    try {
      const roster = get().teams[teamId] ?? browserTeamRepository.load(teamId);
      const member = createMasterStaff(input);
      const seasonId = requestedSeasonId ?? currentSeason(roster)?.seasonId;
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
        const seasonId = requestedSeasonId ?? currentSeason(roster)?.seasonId;
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
