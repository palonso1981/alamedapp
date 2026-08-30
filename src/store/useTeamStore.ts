import { create } from "zustand";

import {
  createMasterPlayer,
  createMasterStaff,
  MasterPlayerInput,
  MasterStaffInput,
  updateMasterPlayer,
  updateMasterStaff,
} from "../lib/rosterDomain";
import { browserTeamRepository } from "../lib/sync/localTeamRepository";
import { MasterPlayer, MasterStaffMember, TeamRoster } from "../types";

interface TeamState {
  teams: Record<string, TeamRoster>;
  errors: Record<string, string | null>;
  ensureTeam: (teamId: string) => void;
  createPlayer: (teamId: string, input: MasterPlayerInput) => string | null;
  updatePlayer: (
    teamId: string,
    playerId: string,
    changes: Partial<MasterPlayerInput> & { active?: boolean },
  ) => void;
  createStaff: (teamId: string, input: MasterStaffInput) => string | null;
  updateStaff: (
    teamId: string,
    staffId: string,
    changes: Partial<MasterStaffInput> & { active?: boolean },
  ) => void;
  clearError: (teamId: string) => void;
}

function saveRoster(roster: TeamRoster): boolean {
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
  createPlayer: (teamId, input) => {
    try {
      const roster = get().teams[teamId] ?? browserTeamRepository.load(teamId);
      const player = createMasterPlayer(roster.players, input);
      const next = { ...roster, players: [...roster.players, player] };
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
  updatePlayer: (teamId, playerId, changes) =>
    set((state) => {
      const roster = state.teams[teamId] ?? browserTeamRepository.load(teamId);
      try {
        const next: TeamRoster = {
          ...roster,
          players: updateMasterPlayer(roster.players, playerId, changes),
        };
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
  createStaff: (teamId, input) => {
    try {
      const roster = get().teams[teamId] ?? browserTeamRepository.load(teamId);
      const member = createMasterStaff(input);
      const next = { ...roster, staff: [...roster.staff, member] };
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
  updateStaff: (teamId, staffId, changes) =>
    set((state) => {
      const roster = state.teams[teamId] ?? browserTeamRepository.load(teamId);
      try {
        const next: TeamRoster = {
          ...roster,
          staff: updateMasterStaff(roster.staff, staffId, changes),
        };
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
