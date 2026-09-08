import { CDA_CLUB_ID, CompetitionType, MatchSession, MatchVenue, TeamWorkspace } from "../types";
import { browserMatchRepository, LocalMatchRepository } from "./sync/localMatchRepository";

export interface MatchMetadataChanges {
  seasonId?: string;
  opponent: string;
  venue: MatchVenue;
  date: string;
  time?: string | null;
  competitionType?: CompetitionType | null;
  competitionOtherDetail?: string | null;
  competition?: string | null;
  matchday?: number | null;
  opponentCategory?: string | null;
}

function optional(value?: string | null): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function validDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("La fecha no es válida.");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("La fecha no es válida.");
  }
  return value;
}

function validTime(value?: string | null): string | undefined {
  const cleaned = optional(value);
  if (cleaned && !/^([01]\d|2[0-3]):[0-5]\d$/.test(cleaned)) throw new Error("La hora no es válida.");
  return cleaned;
}

export function updateExistingMatchMetadata(
  session: MatchSession,
  workspace: TeamWorkspace,
  changes: MatchMetadataChanges,
  now = Date.now(),
): MatchSession {
  const preparation = session.preparation;
  if (!preparation) throw new Error("El partido no tiene preparación asociada.");
  if (preparation.deletedAt) throw new Error("Un partido eliminado no se puede editar.");
  const clubId = preparation.clubId ?? CDA_CLUB_ID;
  if (clubId !== workspace.clubId) throw new Error("El partido pertenece a otro club.");
  const team = workspace.teams.find((item) => item.teamId === preparation.teamId)
    ?? (workspace.teamId === preparation.teamId ? workspace.team : undefined);
  if (!team || team.deletedAt || (team.clubId ?? workspace.clubId) !== workspace.clubId) {
    throw new Error("El equipo original del partido ya no está disponible en este club.");
  }
  const seasonId = changes.seasonId ?? preparation.seasonId;
  if (seasonId) {
    const season = workspace.seasons.find((item) =>
      item.seasonId === seasonId
      && item.teamId === preparation.teamId
      && (item.clubId ?? workspace.clubId) === workspace.clubId
      && !item.deletedAt,
    );
    if (!season) throw new Error("La temporada no pertenece al equipo original del partido.");
  }
  const opponent = changes.opponent.trim();
  if (!opponent) throw new Error("El rival es obligatorio.");
  const matchday = changes.matchday == null
    ? undefined
    : Number.isFinite(changes.matchday) && Number.isInteger(changes.matchday) && changes.matchday > 0
      ? changes.matchday
      : (() => { throw new Error("La jornada debe ser un número entero positivo."); })();
  const competitionType = changes.competitionType ?? undefined;
  return {
    ...session,
    preparation: {
      ...preparation,
      seasonId,
      opponent,
      venue: changes.venue,
      date: validDate(changes.date),
      time: validTime(changes.time),
      competitionType,
      competitionOtherDetail: competitionType === "OTHER" ? optional(changes.competitionOtherDetail) : undefined,
      competition: optional(changes.competition),
      matchday,
      opponentCategory: optional(changes.opponentCategory),
      updatedAt: now,
    },
  };
}

export function updateStoredMatchMetadata(
  matchId: string,
  workspace: TeamWorkspace,
  changes: MatchMetadataChanges,
  repository: LocalMatchRepository = browserMatchRepository,
): { ok: true; session: MatchSession; pending: number } | { ok: false; message: string } {
  const session = repository.load(matchId);
  if (!session) return { ok: false, message: "El partido no existe en este dispositivo." };
  try {
    const next = updateExistingMatchMetadata(session, workspace, changes);
    const saved = repository.save(next);
    return saved.ok
      ? { ok: true, session: next, pending: saved.pending }
      : { ok: false, message: saved.message };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo editar el partido." };
  }
}
