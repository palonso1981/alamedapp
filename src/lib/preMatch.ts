import { createLineupInitializedEvent } from "./matchEngine";
import { playerSnapshot, staffSnapshot } from "./rosterDomain";
import {
  CDA_TEAM_ID,
  MatchPreparation,
  MatchSession,
  MatchVenue,
  TeamRoster,
} from "../types";

export const MAX_CALLED_PLAYERS = 13;
export const STARTER_COUNT = 5;

export interface CreateMatchInput {
  opponent: string;
  venue: MatchVenue;
  date: string;
  time?: string;
  competition?: string;
  category?: string;
  matchday?: string;
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
  return {
    matchId,
    preparation: {
      teamId: CDA_TEAM_ID,
      opponent,
      venue: input.venue,
      date: input.date,
      time: cleaned(input.time),
      competition: cleaned(input.competition),
      category: cleaned(input.category),
      matchday: cleaned(input.matchday),
      status: "DRAFT",
      calledPlayerIds: [],
      starterPlayerIds: [],
      selectedStaffIds: [],
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
      venue: changes.venue ?? preparation.venue,
      date: changes.date ?? preparation.date,
      time: changes.time === undefined ? preparation.time : cleaned(changes.time),
      competition:
        changes.competition === undefined
          ? preparation.competition
          : cleaned(changes.competition),
      category:
        changes.category === undefined
          ? preparation.category
          : cleaned(changes.category),
      matchday:
        changes.matchday === undefined
          ? preparation.matchday
          : cleaned(changes.matchday),
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
    status: "DRAFT",
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
  if (!preparation.starterPlayerIds.includes(playerId) || player?.role !== "GOALKEEPER") {
    throw new Error("El portero inicial debe ser un portero incluido en el quinteto.");
  }
  return withRosterSnapshots(session, roster, {
    ...preparation,
    status: "DRAFT",
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
    status: "DRAFT",
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
      status: "DRAFT",
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
  if (preparation.starterPlayerIds.length !== STARTER_COUNT) reasons.push("Selecciona exactamente cinco titulares.");
  if (preparation.starterPlayerIds.some((id) => !preparation.calledPlayerIds.includes(id))) reasons.push("Todos los titulares deben estar convocados.");
  const goalkeeper = roster.players.find((player) => player.playerId === preparation.startingGoalkeeperId);
  if (!goalkeeper || goalkeeper.role !== "GOALKEEPER" || !preparation.starterPlayerIds.includes(goalkeeper.playerId)) reasons.push("Selecciona un portero funcional entre los cinco titulares.");
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
