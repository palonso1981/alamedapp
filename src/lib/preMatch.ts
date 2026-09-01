import { createLineupInitializedEvent } from "./matchEngine";
import { canPlayGoalkeeper, playerSnapshot, staffSnapshot } from "./rosterDomain";
import {
  CDA_CLUB_ID,
  CompetitionType,
  MatchPreparation,
  MatchSession,
  MatchVenue,
  TeamRoster,
} from "../types";

export const MAX_CALLED_PLAYERS = 13;
export const STARTER_COUNT = 5;

export interface CreateMatchInput {
  clubId?: string;
  teamId: string;
  seasonId: string;
  opponent: string;
  venue: MatchVenue;
  date: string;
  time?: string;
  competitionType?: CompetitionType;
  competitionOtherDetail?: string;
  competition?: string;
  category?: string;
  matchday?: number;
}

export interface PreparationValidation {
  valid: boolean;
  reasons: string[];
}

function cleaned(value?: string): string | undefined {
  const result = value?.trim();
  return result || undefined;
}

function assertEditable(session: MatchSession): MatchPreparation {
  const preparation = session.preparation;
  if (!preparation) throw new Error("El partido no tiene preparación asociada.");
  if (preparation.status === "LIVE" || preparation.status === "FINISHED") {
    throw new Error("El partido ya ha empezado; corrige la cronología desde Directo.");
  }
  return preparation;
}

function withRosterSnapshots(
  session: MatchSession,
  roster: TeamRoster,
  preparation: MatchPreparation,
): MatchSession {
  const playersById = new Map(roster.players.map((player) => [player.playerId, player]));
  const staffById = new Map(roster.staff.map((member) => [member.staffId, member]));
  return {
    ...session,
    preparation,
    players: preparation.calledPlayerIds.flatMap((id) => {
      const player = playersById.get(id);
      return player
        ? [playerSnapshot(player, id === preparation.startingGoalkeeperId)]
        : [];
    }),
    staff: preparation.selectedStaffIds.flatMap((id) => {
      const member = staffById.get(id);
      return member ? [staffSnapshot(member)] : [];
    }),
  };
}

export function createDraftMatch(
  matchId: string,
  input: CreateMatchInput,
  now = Date.now(),
): MatchSession {
  const opponent = input.opponent.trim();
  if (!opponent) throw new Error("El rival es obligatorio.");
  if (!input.date) throw new Error("La fecha es obligatoria.");
  if (!input.teamId.trim()) throw new Error("El equipo es obligatorio.");
  if (!input.seasonId.trim()) throw new Error("La temporada es obligatoria para partidos nuevos.");
  return {
    matchId,
    preparation: {
      clubId: input.clubId?.trim() || CDA_CLUB_ID,
      teamId: input.teamId,
      seasonId: input.seasonId,
      opponent,
      venue: input.venue,
      date: input.date,
      time: cleaned(input.time),
      competitionType: input.competitionType,
      competitionOtherDetail:
        input.competitionType === "OTHER"
          ? cleaned(input.competitionOtherDetail)
          : undefined,
      competition: cleaned(input.competition),
      category: cleaned(input.category),
      matchday:
        Number.isFinite(input.matchday) && (input.matchday ?? 0) > 0
          ? Math.trunc(input.matchday!)
          : undefined,
      status: "DRAFT",
      calledPlayerIds: [],
      starterPlayerIds: [],
      selectedStaffIds: [],
      extraPlayerIds: [],
      targetMinutes: {},
      createdAt: now,
      updatedAt: now,
    },
    players: [],
    staff: [],
    period: 1,
    minute: 0,
    periodMinutes: { 1: 0, 2: 0 },
    closedPeriods: [],
    periodCloseSnapshots: {},
    matchFinished: false,
    events: [],
    past: [],
    future: [],
    lastError: null,
    persistenceStatus: "idle",
    lastSavedAt: null,
  };
}

export function updateMatchDetails(
  session: MatchSession,
  changes: Partial<CreateMatchInput>,
  now = Date.now(),
): MatchSession {
  const preparation = assertEditable(session);
  const opponent = changes.opponent === undefined
    ? preparation.opponent
    : changes.opponent.trim();
  if (!opponent) throw new Error("El rival es obligatorio.");
  return {
    ...session,
    preparation: {
      ...preparation,
      opponent,
      clubId: changes.clubId ?? preparation.clubId ?? CDA_CLUB_ID,
      teamId: changes.teamId ?? preparation.teamId,
      seasonId: changes.seasonId ?? preparation.seasonId,
      venue: changes.venue ?? preparation.venue,
      date: changes.date ?? preparation.date,
      time: changes.time === undefined ? preparation.time : cleaned(changes.time),
      competitionType: changes.competitionType ?? preparation.competitionType,
      competitionOtherDetail:
        changes.competitionType !== undefined && changes.competitionType !== "OTHER"
          ? undefined
          : changes.competitionOtherDetail === undefined
            ? preparation.competitionOtherDetail
            : cleaned(changes.competitionOtherDetail),
      competition:
        changes.competition === undefined
          ? preparation.competition
          : cleaned(changes.competition),
      category:
        changes.category === undefined
          ? preparation.category
          : cleaned(changes.category),
      matchday: changes.matchday === undefined
        ? preparation.matchday
        : Number.isFinite(changes.matchday) && changes.matchday > 0
          ? Math.trunc(changes.matchday)
          : undefined,
      status: "DRAFT",
      updatedAt: now,
    },
  };
}

export function toggleCalledPlayer(
  session: MatchSession,
  roster: TeamRoster,
  playerId: string,
  now = Date.now(),
): MatchSession {
  const preparation = assertEditable(session);
  const player = roster.players.find((candidate) => candidate.playerId === playerId);
  if (!player?.active) throw new Error("Solo pueden convocarse jugadores activos.");
  const selected = preparation.calledPlayerIds.includes(playerId);
  if (!selected && preparation.calledPlayerIds.length >= MAX_CALLED_PLAYERS) {
    throw new Error(`La convocatoria admite hasta ${MAX_CALLED_PLAYERS} jugadores.`);
  }
  const calledPlayerIds = selected
    ? preparation.calledPlayerIds.filter((id) => id !== playerId)
    : [...preparation.calledPlayerIds, playerId];
  const next: MatchPreparation = {
    ...preparation,
    status: "DRAFT",
    calledPlayerIds,
    extraPlayerIds: (preparation.extraPlayerIds ?? []).filter((id) => calledPlayerIds.includes(id)),
    starterPlayerIds: preparation.starterPlayerIds.filter((id) => calledPlayerIds.includes(id)),
    startingGoalkeeperId:
      preparation.startingGoalkeeperId && calledPlayerIds.includes(preparation.startingGoalkeeperId)
        ? preparation.startingGoalkeeperId
        : undefined,
    targetMinutes: Object.fromEntries(
      Object.entries(preparation.targetMinutes).filter(([id]) => calledPlayerIds.includes(id)),
    ),
    updatedAt: now,
  };
  return withRosterSnapshots(session, roster, next);
}

export function addExtraPlayerToMatch(
  session: MatchSession,
  roster: TeamRoster,
  playerId: string,
  now = Date.now(),
): MatchSession {
  const preparation = assertEditable(session);
  const player = roster.players.find((candidate) => candidate.playerId === playerId);
  if (!player) throw new Error("El jugador no existe en el club.");
  if (preparation.calledPlayerIds.includes(playerId)) return session;
  if (preparation.calledPlayerIds.length >= MAX_CALLED_PLAYERS) {
    throw new Error(`La convocatoria admite hasta ${MAX_CALLED_PLAYERS} jugadores.`);
  }
  const next: MatchPreparation = {
    ...preparation,
    status: "DRAFT",
    extraPlayerIds: Array.from(new Set([...(preparation.extraPlayerIds ?? []), playerId])),
    calledPlayerIds: [...preparation.calledPlayerIds, playerId],
    updatedAt: now,
  };
  return withRosterSnapshots(session, roster, next);
}

export function toggleStarter(
  session: MatchSession,
  roster: TeamRoster,
  playerId: string,
  now = Date.now(),
): MatchSession {
  const preparation = assertEditable(session);
  if (!preparation.calledPlayerIds.includes(playerId)) {
    throw new Error("El titular debe pertenecer a la convocatoria.");
  }
  const selected = preparation.starterPlayerIds.includes(playerId);
  if (!selected && preparation.starterPlayerIds.length >= STARTER_COUNT) {
    throw new Error("Ya hay cinco titulares seleccionados.");
  }
  const starterPlayerIds = selected
    ? preparation.starterPlayerIds.filter((id) => id !== playerId)
    : [...preparation.starterPlayerIds, playerId];
  const next: MatchPreparation = {
    ...preparation,
    status: preparation.status,
    starterPlayerIds,
    startingGoalkeeperId:
      preparation.startingGoalkeeperId && starterPlayerIds.includes(preparation.startingGoalkeeperId)
        ? preparation.startingGoalkeeperId
        : undefined,
    updatedAt: now,
  };
  return withRosterSnapshots(session, roster, next);
}

export function selectStartingGoalkeeper(
  session: MatchSession,
  roster: TeamRoster,
  playerId: string,
  now = Date.now(),
): MatchSession {
  const preparation = assertEditable(session);
  const player = roster.players.find((candidate) => candidate.playerId === playerId);
  if (!preparation.starterPlayerIds.includes(playerId) || !player || !canPlayGoalkeeper(player)) {
    throw new Error("El portero inicial debe ser un portero incluido en el quinteto.");
  }
  return withRosterSnapshots(session, roster, {
    ...preparation,
    status: preparation.status,
    startingGoalkeeperId: playerId,
    updatedAt: now,
  });
}

export function toggleMatchStaff(
  session: MatchSession,
  roster: TeamRoster,
  staffId: string,
  now = Date.now(),
): MatchSession {
  const preparation = assertEditable(session);
  const member = roster.staff.find((candidate) => candidate.staffId === staffId);
  if (!member?.active) throw new Error("Solo puede seleccionarse staff activo.");
  const selected = preparation.selectedStaffIds.includes(staffId);
  return withRosterSnapshots(session, roster, {
    ...preparation,
    status: preparation.status,
    selectedStaffIds: selected
      ? preparation.selectedStaffIds.filter((id) => id !== staffId)
      : [...preparation.selectedStaffIds, staffId],
    updatedAt: now,
  });
}

export function setTargetMinutes(
  session: MatchSession,
  playerId: string,
  targetMinutes: number | null,
  now = Date.now(),
): MatchSession {
  const preparation = assertEditable(session);
  if (!preparation.calledPlayerIds.includes(playerId)) {
    throw new Error("Solo puede planificarse un jugador convocado.");
  }
  const targets = { ...preparation.targetMinutes };
  if (targetMinutes === null || !Number.isFinite(targetMinutes)) delete targets[playerId];
  else targets[playerId] = Math.max(0, Math.min(40, Math.trunc(targetMinutes)));
  return {
    ...session,
    preparation: {
      ...preparation,
      status: preparation.status,
      targetMinutes: targets,
      updatedAt: now,
    },
  };
}

export function validatePreparation(
  session: MatchSession,
  roster: TeamRoster,
): PreparationValidation {
  const preparation = session.preparation;
  if (!preparation) return { valid: false, reasons: ["Falta la preparación del partido."] };
  const reasons: string[] = [];
  if (!preparation.opponent.trim()) reasons.push("Indica el rival.");
  if (!preparation.date) reasons.push("Indica la fecha.");
  if (preparation.calledPlayerIds.length < STARTER_COUNT) reasons.push("Convoca al menos cinco jugadores.");
  if (preparation.calledPlayerIds.length > MAX_CALLED_PLAYERS) reasons.push("La convocatoria supera 13 jugadores.");
  if (preparation.calledPlayerIds.some((id) => !roster.players.some((player) => player.playerId === id))) reasons.push("La convocatoria contiene jugadores que ya no existen en Plantilla.");
  return { valid: reasons.length === 0, reasons };
}

export function validateStartingLineup(
  session: MatchSession,
  roster: TeamRoster,
): PreparationValidation {
  const preparation = session.preparation;
  const base = validatePreparation(session, roster);
  if (!preparation) return base;
  const reasons = [...base.reasons];
  if (preparation.starterPlayerIds.length !== STARTER_COUNT) reasons.push("Selecciona exactamente cinco titulares.");
  if (preparation.starterPlayerIds.some((id) => !preparation.calledPlayerIds.includes(id))) reasons.push("Todos los titulares deben estar convocados.");
  const goalkeeper = roster.players.find((player) => player.playerId === preparation.startingGoalkeeperId);
  if (!goalkeeper || !canPlayGoalkeeper(goalkeeper) || !preparation.starterPlayerIds.includes(goalkeeper.playerId)) reasons.push("Selecciona un portero funcional entre los cinco titulares.");
  return { valid: reasons.length === 0, reasons };
}

export function markMatchReady(
  session: MatchSession,
  roster: TeamRoster,
  now = Date.now(),
): MatchSession {
  const validation = validatePreparation(session, roster);
  if (!validation.valid) throw new Error(validation.reasons.join(" "));
  return {
    ...session,
    preparation: { ...session.preparation!, status: "READY", updatedAt: now },
  };
}

export function startPreparedMatch(
  session: MatchSession,
  roster: TeamRoster,
  now = Date.now(),
): MatchSession {
  if (
    session.preparation?.status === "LIVE" &&
    session.events.some((event) => event.type === "lineup_initialized")
  ) {
    return session;
  }
  const ready = markMatchReady(session, roster, now);
  const startValidation = validateStartingLineup(ready, roster);
  if (!startValidation.valid) throw new Error(startValidation.reasons.join(" "));
  const preparation = ready.preparation!;
  const lineup = createLineupInitializedEvent({
    id: `lineup-${session.matchId}-initial`,
    matchId: session.matchId,
    position: { period: 1, minute: 0, order: 1 },
    squadPlayerIds: preparation.calledPlayerIds,
    onCourtPlayerIds: preparation.starterPlayerIds,
    goalkeeperPlayerId: preparation.startingGoalkeeperId,
    now,
  });
  return {
    ...ready,
    period: 1,
    minute: 0,
    periodMinutes: { 1: 0, 2: 0 },
    closedPeriods: [],
    periodCloseSnapshots: {},
    matchFinished: false,
    events: [lineup],
    past: [],
    future: [],
    preparation: {
      ...preparation,
      status: "LIVE",
      startedAt: preparation.startedAt ?? now,
      updatedAt: now,
    },
  };
}

export function plannedMinutes(preparation?: MatchPreparation): number | null {
  if (!preparation || Object.keys(preparation.targetMinutes).length === 0) return null;
  return Object.values(preparation.targetMinutes).reduce((total, minutes) => total + minutes, 0);
}
