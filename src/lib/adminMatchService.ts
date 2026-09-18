import { assignLegacyMatchSeason, changeMatchLifecycle } from "./adminDomain";
import { browserMatchRepository, LocalMatchRepository } from "./sync/localMatchRepository";
import { TeamWorkspace } from "../types";

export function changeStoredMatchLifecycle(
  matchId: string,
  action: "ARCHIVE" | "REACTIVATE" | "DELETE",
): { ok: true; eventCount: number; pending: number } | { ok: false; message: string } {
  return changeStoredMatchLifecycleInRepository(browserMatchRepository, matchId, action);
}

export function changeStoredMatchLifecycleInRepository(
  repository: Pick<LocalMatchRepository, "load" | "save">,
  matchId: string,
  action: "ARCHIVE" | "REACTIVATE" | "DELETE",
): { ok: true; eventCount: number; pending: number } | { ok: false; message: string } {
  const session = repository.load(matchId);
  if (!session) return { ok: false, message: "El partido no existe en este dispositivo." };
  try {
    const next = changeMatchLifecycle(session, action);
    const saved = repository.save(next);
    return saved.ok
      ? { ok: true, eventCount: session.events.length, pending: saved.pending }
      : { ok: false, message: saved.message };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo actualizar el partido." };
  }
}

export function assignStoredMatchSeason(
  matchId: string,
  workspace: TeamWorkspace,
  seasonId: string,
): { ok: true } | { ok: false; message: string } {
  const session = browserMatchRepository.load(matchId);
  if (!session?.preparation) return { ok: false, message: "El partido no existe en este dispositivo." };
  try {
    const saved = browserMatchRepository.save(assignLegacyMatchSeason(session, workspace, seasonId));
    return saved.ok ? { ok: true } : { ok: false, message: saved.message };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo asignar la temporada." };
  }
}
