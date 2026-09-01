import { create } from "zustand";

import {
  CreateMatchInput,
  addExtraPlayerToMatch,
  createDraftMatch,
  markMatchReady,
  selectStartingGoalkeeper,
  setTargetMinutes,
  startPreparedMatch,
  toggleCalledPlayer,
  toggleMatchStaff,
  toggleStarter,
  updateMatchDetails,
} from "../lib/preMatch";
import { browserMatchRepository } from "../lib/sync/localMatchRepository";
import { MatchSession, TeamRoster } from "../types";

interface PreMatchState {
  matches: Record<string, MatchSession>;
  errors: Record<string, string | null>;
  load: (matchId: string) => void;
  createMatch: (matchId: string, input: CreateMatchInput) => boolean;
  updateDetails: (matchId: string, changes: Partial<CreateMatchInput>) => void;
  toggleCalled: (matchId: string, roster: TeamRoster, playerId: string) => void;
  addExtraPlayer: (matchId: string, roster: TeamRoster, playerId: string) => void;
  toggleStarter: (matchId: string, roster: TeamRoster, playerId: string) => void;
  selectGoalkeeper: (matchId: string, roster: TeamRoster, playerId: string) => void;
  toggleStaff: (matchId: string, roster: TeamRoster, staffId: string) => void;
  setTarget: (matchId: string, playerId: string, minutes: number | null) => void;
  markReady: (matchId: string, roster: TeamRoster) => void;
  start: (matchId: string, roster: TeamRoster) => boolean;
  clearError: (matchId: string) => void;
}

function persisted(session: MatchSession): MatchSession {
  const result = browserMatchRepository.save(session);
  if (!result.ok) throw new Error(result.message);
  return {
    ...session,
    persistenceStatus: "saved",
    lastSavedAt: result.savedAt,
  };
}

export const usePreMatchStore = create<PreMatchState>((set, get) => {
  function change(
    matchId: string,
    updater: (session: MatchSession) => MatchSession,
  ): void {
    set((state) => {
      const current = state.matches[matchId] ?? browserMatchRepository.load(matchId);
      if (!current) {
        return {
          errors: { ...state.errors, [matchId]: "El partido no existe en este dispositivo." },
        };
      }
      try {
        const next = persisted(updater(current));
        return {
          matches: { ...state.matches, [matchId]: next },
          errors: { ...state.errors, [matchId]: null },
        };
      } catch (error) {
        return {
          errors: {
            ...state.errors,
            [matchId]: error instanceof Error ? error.message : "No se pudo guardar.",
          },
        };
      }
    });
  }

  return {
    matches: {},
    errors: {},
    load: (matchId) =>
      set((state) => {
        if (state.matches[matchId]) return state;
        const session = browserMatchRepository.load(matchId);
        return session
          ? { matches: { ...state.matches, [matchId]: session } }
          : { errors: { ...state.errors, [matchId]: "El partido no existe en este dispositivo." } };
      }),
    createMatch: (matchId, input) => {
      try {
        const session = persisted(createDraftMatch(matchId, input));
        set((state) => ({
          matches: { ...state.matches, [matchId]: session },
          errors: { ...state.errors, [matchId]: null },
        }));
        return true;
      } catch (error) {
        set((state) => ({
          errors: {
            ...state.errors,
            [matchId]: error instanceof Error ? error.message : "No se pudo crear.",
          },
        }));
        return false;
      }
    },
    updateDetails: (matchId, changes) => change(matchId, (session) => updateMatchDetails(session, changes)),
    toggleCalled: (matchId, roster, playerId) => change(matchId, (session) => toggleCalledPlayer(session, roster, playerId)),
    addExtraPlayer: (matchId, roster, playerId) => change(matchId, (session) => addExtraPlayerToMatch(session, roster, playerId)),
    toggleStarter: (matchId, roster, playerId) => change(matchId, (session) => toggleStarter(session, roster, playerId)),
    selectGoalkeeper: (matchId, roster, playerId) => change(matchId, (session) => selectStartingGoalkeeper(session, roster, playerId)),
    toggleStaff: (matchId, roster, staffId) => change(matchId, (session) => toggleMatchStaff(session, roster, staffId)),
    setTarget: (matchId, playerId, minutes) => change(matchId, (session) => setTargetMinutes(session, playerId, minutes)),
    markReady: (matchId, roster) => change(matchId, (session) => markMatchReady(session, roster)),
    start: (matchId, roster): boolean => {
      const before = get().matches[matchId] ?? browserMatchRepository.load(matchId);
      if (!before) return false;
      try {
        const next = persisted(startPreparedMatch(before, roster));
        set((state) => ({
          matches: { ...state.matches, [matchId]: next },
          errors: { ...state.errors, [matchId]: null },
        }));
        return next.preparation?.status === "LIVE";
      } catch (error) {
        set((state) => ({
          errors: {
            ...state.errors,
            [matchId]: error instanceof Error ? error.message : "No se pudo iniciar.",
          },
        }));
        return false;
      }
    },
    clearError: (matchId) => set((state) => ({ errors: { ...state.errors, [matchId]: null } })),
  };
});
