import { changeMatchLifecycle } from "./adminDomain";
import { browserMatchRepository } from "./sync/localMatchRepository";

export function changeStoredMatchLifecycle(
  matchId: string,
  action: "ARCHIVE" | "REACTIVATE" | "DELETE",
): { ok: true; eventCount: number } | { ok: false; message: string } {
  const session = browserMatchRepository.load(matchId);
  if (!session) return { ok: false, message: "El partido no existe en este dispositivo." };
  try {
    const next = changeMatchLifecycle(session, action);
    const saved = browserMatchRepository.save(next);
    return saved.ok
      ? { ok: true, eventCount: session.events.length }
      : { ok: false, message: saved.message };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo actualizar el partido." };
  }
}
