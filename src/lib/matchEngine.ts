import {
  CardColor,
  CardRecordedEvent,
  DisciplineSummary,
  DisciplineSide,
  EventPosition,
  FoulRecordedEvent,
  GameContext,
  GameStateChangedEvent,
  GameStateKind,
  INFERIORITY_SLOT_ID,
  LegacyThreatImportedEvent,
  LineupInitializedEvent,
  LiveThreatPhase,
  LiveThreatOutcome,
  LiveThreatRecordedEvent,
  MATCH_EVENT_SCHEMA_VERSION,
  MatchEvent,
  NormalizedCoordinates,
  Player,
  ReplayIssue,
  ReplayResult,
  SubstitutionEvent,
  ThreatOutcome,
  ThreatPhase,
  ThreatSide,
} from "../types";

export const MAX_ON_COURT = 5;

export interface MatchClockConfig {
  regulationPeriods: number;
  periodDurationMinutes: number;
}

export const REGULATION_MATCH_CLOCK: Readonly<MatchClockConfig> = {
  regulationPeriods: 2,
  periodDurationMinutes: 20,
};

export function normalizeMatchClock(
  period: number,
  minute: number,
  config: MatchClockConfig = REGULATION_MATCH_CLOCK,
): Pick<EventPosition, "period" | "minute"> {
  const regulationPeriods = Math.max(1, Math.trunc(config.regulationPeriods));
  const periodDurationMinutes = Math.max(
    1,
    Math.trunc(config.periodDurationMinutes),
  );
  return {
    period: Math.min(regulationPeriods, Math.max(1, Math.trunc(period))),
    minute: Math.min(periodDurationMinutes, Math.max(0, Math.trunc(minute))),
  };
}

/**
 * Proyecta el reloj por periodo sobre una línea temporal continua. El valor no
 * se persiste: siempre se deriva del periodo y minuto oficiales.
 * P2 0' representa el punto global 20; P2 1', el minuto global 21.
 */
export function deriveGlobalMinute(
  period: number,
  minute: number,
  periodDurationMinutes = REGULATION_MATCH_CLOCK.periodDurationMinutes,
): number {
  const duration = Math.max(1, Math.trunc(periodDurationMinutes));
  const safePeriod = Math.max(1, Math.trunc(period));
  const safeMinute = Math.min(duration, Math.max(0, Math.trunc(minute)));
  return (safePeriod - 1) * duration + safeMinute;
}

export interface ReplayOptions {
  currentClock?: Pick<EventPosition, "period" | "minute">;
  throughClock?: Pick<EventPosition, "period" | "minute">;
  periodDurationMinutes?: number;
}

function participationMinute(
  period: number,
  minute: number,
  periodDurationMinutes: number,
): number {
  // El minuto oficial identifica el intervalo en curso: al mostrar 1' todavía
  // han transcurrido 0 minutos completos de participación.
  const completedPeriods = Math.max(0, period - 1) * periodDurationMinutes;
  const elapsedInPeriod = Math.max(0, minute - 1);
  return completedPeriods + elapsedInPeriod;
}

export class MatchIntegrityError extends Error {
  constructor(public readonly issues: ReplayIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "MatchIntegrityError";
  }
}

interface EventFactoryBase {
  id?: string;
  matchId: string;
  position: EventPosition;
  now?: number;
}

export interface LineupEventInput extends EventFactoryBase {
  squadPlayerIds: string[];
  onCourtPlayerIds: string[];
}

export interface SubstitutionEventInput extends EventFactoryBase {
  playerOutId: string;
  playerInId: string;
}

export interface GameStateEventInput extends EventFactoryBase {
  state: GameStateKind;
  active: boolean;
}

export interface FoulEventInput extends EventFactoryBase {
  side: DisciplineSide;
  playerId: string;
}

export interface CardEventInput extends EventFactoryBase {
  side: DisciplineSide;
  color: CardColor;
  playerId?: string;
}

interface ThreatEventInput extends EventFactoryBase {
  side: ThreatSide;
  playerId?: string;
  origin: NormalizedCoordinates;
  sequenceId?: string;
  parentEventId?: string;
}

export interface LiveThreatEventInput extends ThreatEventInput {
  outcome: LiveThreatOutcome;
  phase: LiveThreatPhase;
}

export interface LegacyThreatEventInput extends ThreatEventInput {
  outcome: ThreatOutcome;
  phase?: ThreatPhase;
}

export interface EventEditChanges {
  period?: number;
  minute?: number;
  lineup?: Partial<
    Pick<LineupInitializedEvent, "squadPlayerIds" | "onCourtPlayerIds">
  >;
  substitution?: Partial<
    Pick<SubstitutionEvent, "playerOutId" | "playerInId">
  >;
  threat?: Partial<
    Pick<LiveThreatRecordedEvent, "side" | "playerId" | "origin" | "phase">
  > & { outcome?: ThreatOutcome };
  gameState?: Partial<Pick<GameStateChangedEvent, "state" | "active">>;
  foul?: Partial<Pick<FoulRecordedEvent, "side" | "playerId">>;
  card?: Partial<Pick<CardRecordedEvent, "side" | "color" | "playerId">>;
}

function createId(): string {
  return globalThis.crypto.randomUUID();
}

function eventBase(input: EventFactoryBase) {
  const now = input.now ?? Date.now();
  return {
    id: input.id ?? createId(),
    matchId: input.matchId,
    schemaVersion: MATCH_EVENT_SCHEMA_VERSION,
    period: input.position.period,
    minute: input.position.minute,
    order: input.position.order,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  } as const;
}

export function createLineupInitializedEvent(
  input: LineupEventInput,
): LineupInitializedEvent {
  return {
    ...eventBase(input),
    type: "lineup_initialized",
    squadPlayerIds: [...input.squadPlayerIds],
    onCourtPlayerIds: [...input.onCourtPlayerIds],
  };
}

export function createSubstitutionEvent(
  input: SubstitutionEventInput,
): SubstitutionEvent {
  return {
    ...eventBase(input),
    type: "substitution",
    playerOutId: input.playerOutId,
    playerInId: input.playerInId,
  };
}

export function createGameStateEvent(
  input: GameStateEventInput,
): GameStateChangedEvent {
  return {
    ...eventBase(input),
    type: "game_state_changed",
    state: input.state,
    active: input.active,
  };
}

export function createFoulEvent(input: FoulEventInput): FoulRecordedEvent {
  return {
    ...eventBase(input),
    type: "foul_recorded",
    side: input.side,
    source: "live",
    playerId: input.playerId,
  };
}

export function createCardEvent(input: CardEventInput): CardRecordedEvent {
  return {
    ...eventBase(input),
    type: "card_recorded",
    side: input.side,
    color: input.color,
    playerId: input.playerId,
  };
}

export function createLiveThreatEvent(
  input: LiveThreatEventInput,
): LiveThreatRecordedEvent {
  if (!["GOL", "PARADA", "FUERA"].includes(input.outcome)) {
    throw new Error("La captura V1 solo admite GOL, PARADA o FUERA.");
  }
  if (!input.phase || (input.phase as ThreatPhase) === "UNSPECIFIED") {
    throw new Error("La captura V1 requiere una fase válida.");
  }
  const base = eventBase(input);
  return {
    ...base,
    type: "threat_recorded",
    source: "live",
    side: input.side,
    playerId: input.playerId,
    origin: { ...input.origin },
    phase: input.phase,
    outcome: input.outcome,
    sequenceId: input.sequenceId ?? base.id,
    parentEventId: input.parentEventId,
  };
}

export function createLegacyThreatEvent(
  input: LegacyThreatEventInput,
): LegacyThreatImportedEvent {
  const base = eventBase(input);
  return {
    ...base,
    type: "threat_recorded",
    source: "legacy_import",
    side: input.side,
    playerId: input.playerId,
    origin: { ...input.origin },
    phase: input.phase ?? "UNSPECIFIED",
    outcome: input.outcome,
    sequenceId: input.sequenceId ?? base.id,
    parentEventId: input.parentEventId,
  };
}

export function compareEventPosition(a: MatchEvent, b: MatchEvent): number {
  return (
    a.period - b.period ||
    a.minute - b.minute ||
    a.order - b.order ||
    a.createdAt - b.createdAt ||
    a.id.localeCompare(b.id)
  );
}

export function sortEvents(events: MatchEvent[]): MatchEvent[] {
  return [...events].sort(compareEventPosition);
}

export function getNextOrder(
  events: MatchEvent[],
  period: number,
  minute: number,
): number {
  return (
    events
      .filter(
        (event) =>
          event.deletedAt === null &&
          event.period === period &&
          event.minute === minute,
      )
      .reduce((highest, event) => Math.max(highest, event.order), 0) + 1
  );
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function validPosition(event: MatchEvent): boolean {
  return (
    Number.isInteger(event.period) &&
    event.period >= 1 &&
    Number.isInteger(event.minute) &&
    event.minute >= 0 &&
    Number.isInteger(event.order) &&
    event.order >= 1
  );
}

function validCoordinates(coordinates: NormalizedCoordinates): boolean {
  return (
    Number.isFinite(coordinates.x) &&
    Number.isFinite(coordinates.y) &&
    coordinates.x >= 0 &&
    coordinates.x <= 1 &&
    coordinates.y >= 0 &&
    coordinates.y <= 1
  );
}

function issue(
  issues: ReplayIssue[],
  event: MatchEvent,
  code: ReplayIssue["code"],
  message: string,
) {
  issues.push({ eventId: event.id, code, message });
}

function gameContexts(
  onCourtPlayerIds: string[],
  superiorityActive: boolean,
  flyingGoalkeeperActive: boolean,
): GameContext[] {
  const contexts: GameContext[] = [];
  const inferiorityActive = onCourtPlayerIds.includes(INFERIORITY_SLOT_ID);

  if (!superiorityActive && !inferiorityActive) {
    contexts.push("EVEN");
  } else {
    if (superiorityActive) {
      contexts.push("SUPERIORITY");
    }
    if (inferiorityActive) {
      contexts.push("INFERIORITY");
    }
  }
  if (flyingGoalkeeperActive) {
    contexts.push("FLYING_GOALKEEPER");
  }
  return contexts;
}

function emptyDiscipline(): DisciplineSummary {
  return {
    for: { fouls: 0, yellowCards: 0, redCards: 0 },
    against: { fouls: 0, yellowCards: 0, redCards: 0 },
  };
}

export function replayMatch(
  players: Player[],
  events: MatchEvent[],
  options: ReplayOptions = {},
): ReplayResult {
  const playerIds = new Set(players.map((player) => player.id));
  let squadPlayerIds: string[] = [];
  let onCourtPlayerIds: string[] = [];
  let benchPlayerIds: string[] = [];
  let hasLineup = false;
  let superiorityActive = false;
  let flyingGoalkeeperActive = false;
  const dismissedPlayerIds = new Set<string>();
  const score = { for: 0, against: 0 };
  const discipline = emptyDiscipline();
  const disciplineByPeriod: Record<number, DisciplineSummary> = {};
  const periodDurationMinutes =
    options.periodDurationMinutes ??
    REGULATION_MATCH_CLOCK.periodDurationMinutes;
  const totalMinutes = new Map(players.map((player) => [player.id, 0]));
  const enteredAt = new Map<string, number>();
  let lastElapsedMinute = 0;
  const timeline: ReplayResult["timeline"] = [];
  const issues: ReplayIssue[] = [];
  const activeEvents = sortEvents(events).filter(
    (candidate) =>
      candidate.deletedAt === null &&
      (!options.throughClock ||
        candidate.period < options.throughClock.period ||
        (candidate.period === options.throughClock.period &&
          candidate.minute <= options.throughClock.minute)),
  );
  const matchIds = new Set(activeEvents.map((event) => event.matchId));
  const occupiedPositions = new Set<string>();
  const eventsById = new Map(events.map((event) => [event.id, event]));

  const refreshBench = () => {
    benchPlayerIds = squadPlayerIds.filter(
      (id) => !onCourtPlayerIds.includes(id),
    );
  };

  if (matchIds.size > 1) {
    for (const event of activeEvents) {
      issue(
        issues,
        event,
        "MATCH_ID_MISMATCH",
        "La cronología mezcla eventos de partidos diferentes.",
      );
    }
  }

  for (const event of activeEvents) {
    const positionKey = `${event.period}:${event.minute}:${event.order}`;
    if (occupiedPositions.has(positionKey)) {
      issue(
        issues,
        event,
        "DUPLICATE_ORDER",
        "Dos eventos comparten la misma posición cronológica.",
      );
    }
    occupiedPositions.add(positionKey);
  }

  for (const event of activeEvents) {
    let periodFoulNumber: number | undefined;
    const eventElapsedMinute = participationMinute(
      event.period,
      event.minute,
      periodDurationMinutes,
    );
    if (hasLineup) {
      const elapsed = Math.max(0, eventElapsedMinute - lastElapsedMinute);
      for (const playerId of onCourtPlayerIds) {
        if (playerIds.has(playerId)) {
          totalMinutes.set(playerId, (totalMinutes.get(playerId) ?? 0) + elapsed);
        }
      }
    }
    lastElapsedMinute = Math.max(lastElapsedMinute, eventElapsedMinute);

    if (!validPosition(event)) {
      issue(
        issues,
        event,
        "INVALID_POSITION",
        `El evento ${event.id} tiene una posición temporal inválida.`,
      );
    }

    if (event.type === "lineup_initialized") {
      const allKnown = event.squadPlayerIds.every((id) => playerIds.has(id));
      if (!allKnown) {
        issue(
          issues,
          event,
          "UNKNOWN_PLAYER",
          "La alineación contiene jugadores desconocidos.",
        );
      }
      if (
        !unique(event.squadPlayerIds) ||
        !unique(event.onCourtPlayerIds)
      ) {
        issue(
          issues,
          event,
          "DUPLICATE_PLAYER",
          "La alineación contiene jugadores duplicados.",
        );
      }
      if (event.onCourtPlayerIds.length > MAX_ON_COURT) {
        issue(
          issues,
          event,
          "TOO_MANY_ON_COURT",
          `La alineación supera el máximo de ${MAX_ON_COURT} plazas.`,
        );
      }
      if (
        event.onCourtPlayerIds.some(
          (id) => !event.squadPlayerIds.includes(id),
        )
      ) {
        issue(
          issues,
          event,
          "UNKNOWN_PLAYER",
          "Hay jugadores en pista que no pertenecen a la convocatoria.",
        );
      }

      squadPlayerIds = [...event.squadPlayerIds];
      onCourtPlayerIds = [...event.onCourtPlayerIds];
      refreshBench();
      enteredAt.clear();
      for (const playerId of onCourtPlayerIds) {
        enteredAt.set(playerId, eventElapsedMinute);
      }
      hasLineup = true;
    } else if (!hasLineup) {
      issue(
        issues,
        event,
        "MISSING_LINEUP",
        "No se puede aplicar un evento deportivo antes de iniciar la alineación.",
      );
    } else if (event.type === "substitution") {
      const incomingIsInferiority = event.playerInId === INFERIORITY_SLOT_ID;
      if (!onCourtPlayerIds.includes(event.playerOutId)) {
        issue(
          issues,
          event,
          "PLAYER_NOT_ON_COURT",
          "El jugador que sale no está en pista.",
        );
      }
      if (
        incomingIsInferiority &&
        onCourtPlayerIds.includes(INFERIORITY_SLOT_ID)
      ) {
        issue(
          issues,
          event,
          "INVALID_INFERIORITY_SLOT",
          "La plaza INFERIORIDAD ya está ocupando una posición.",
        );
      } else if (!incomingIsInferiority && !benchPlayerIds.includes(event.playerInId)) {
        issue(
          issues,
          event,
          "PLAYER_NOT_ON_BENCH",
          "El jugador que entra no está en el banquillo.",
        );
      }
      if (
        onCourtPlayerIds.includes(event.playerOutId) &&
        (incomingIsInferiority || benchPlayerIds.includes(event.playerInId)) &&
        !(
          incomingIsInferiority &&
          onCourtPlayerIds.includes(INFERIORITY_SLOT_ID)
        )
      ) {
        onCourtPlayerIds = onCourtPlayerIds.map((id) =>
          id === event.playerOutId ? event.playerInId : id,
        );
        enteredAt.delete(event.playerOutId);
        enteredAt.set(event.playerInId, eventElapsedMinute);
        refreshBench();
      }
    } else if (event.type === "threat_recorded") {
      if (!validCoordinates(event.origin)) {
        issue(
          issues,
          event,
          "INVALID_COORDINATES",
          "El origen de la amenaza debe usar coordenadas entre 0 y 1.",
        );
      }
      if (
        event.side === "FOR" &&
        (!event.playerId ||
          !playerIds.has(event.playerId) ||
          !onCourtPlayerIds.includes(event.playerId))
      ) {
        issue(
          issues,
          event,
          "INVALID_THREAT_AUTHOR",
          "Una amenaza propia debe pertenecer a un jugador que estaba en pista.",
        );
      }
      if (event.outcome === "GOL") {
        score[event.side === "FOR" ? "for" : "against"] += 1;
      }
      if (event.parentEventId) {
        const parent = eventsById.get(event.parentEventId);
        const parentSequenceId =
          parent?.type === "threat_recorded"
            ? parent.sequenceId ?? parent.id
            : null;
        if (
          !parent ||
          parent.type !== "threat_recorded" ||
          parent.matchId !== event.matchId ||
          compareEventPosition(parent, event) >= 0 ||
          (event.sequenceId ?? event.id) !== parentSequenceId
        ) {
          issue(
            issues,
            event,
            "INVALID_EVENT_LINK",
            "La continuación debe apuntar a una amenaza anterior de la misma secuencia.",
          );
        }
      }
    } else if (event.type === "game_state_changed") {
      if (event.state === "SUPERIORITY") {
        superiorityActive = event.active;
      } else {
        flyingGoalkeeperActive = event.active;
      }
    } else if (event.type === "foul_recorded") {
      if (
        event.source === "live" &&
        (!event.playerId || !squadPlayerIds.includes(event.playerId))
      ) {
        issue(
          issues,
          event,
          "INVALID_FOUL_PLAYER",
          "Una falta en directo debe identificar al jugador CDA implicado.",
        );
      } else if (event.playerId && !squadPlayerIds.includes(event.playerId)) {
        issue(
          issues,
          event,
          "INVALID_FOUL_PLAYER",
          "La falta referencia a un jugador que no pertenece a la convocatoria.",
        );
      }
      const teamKey = event.side === "FOR" ? "for" : "against";
      discipline[teamKey].fouls += 1;
      const periodDiscipline =
        disciplineByPeriod[event.period] ?? emptyDiscipline();
      periodDiscipline[teamKey].fouls += 1;
      disciplineByPeriod[event.period] = periodDiscipline;
      periodFoulNumber = periodDiscipline[teamKey].fouls;
    } else if (event.type === "card_recorded") {
      const teamDiscipline =
        discipline[event.side === "FOR" ? "for" : "against"];
      const periodTeamDiscipline = (
        disciplineByPeriod[event.period] ??= emptyDiscipline()
      )[event.side === "FOR" ? "for" : "against"];
      if (event.color === "YELLOW") {
        teamDiscipline.yellowCards += 1;
        periodTeamDiscipline.yellowCards += 1;
      } else {
        teamDiscipline.redCards += 1;
        periodTeamDiscipline.redCards += 1;
      }
      if (
        event.side === "FOR" &&
        (!event.playerId || !playerIds.has(event.playerId))
      ) {
        issue(
          issues,
          event,
          "INVALID_CARD_PLAYER",
          "Una tarjeta propia debe estar asociada a un jugador real.",
        );
      } else if (
        event.side === "FOR" &&
        event.color === "RED" &&
        event.playerId
      ) {
        dismissedPlayerIds.add(event.playerId);
      }
    }

    timeline.push({
      event,
      lineupPlayerIds: [...onCourtPlayerIds],
      benchPlayerIds: [...benchPlayerIds],
      gameContexts: gameContexts(
        onCourtPlayerIds,
        superiorityActive,
        flyingGoalkeeperActive,
      ),
      periodFoulNumber,
    });
  }

  const requestedCurrentMinute = options.currentClock
    ? participationMinute(
        options.currentClock.period,
        options.currentClock.minute,
        periodDurationMinutes,
      )
    : lastElapsedMinute;
  const currentElapsedMinute = Math.max(lastElapsedMinute, requestedCurrentMinute);
  const remainingElapsed = Math.max(0, currentElapsedMinute - lastElapsedMinute);
  for (const playerId of onCourtPlayerIds) {
    if (playerIds.has(playerId)) {
      totalMinutes.set(playerId, (totalMinutes.get(playerId) ?? 0) + remainingElapsed);
    }
  }

  const playerMinutes = Object.fromEntries(
    players.map((player) => {
      const onCourt = onCourtPlayerIds.includes(player.id);
      return [
        player.id,
        {
          totalMinutes: totalMinutes.get(player.id) ?? 0,
          currentStintMinutes: onCourt
            ? Math.max(0, currentElapsedMinute - (enteredAt.get(player.id) ?? currentElapsedMinute))
            : 0,
          onCourt,
        },
      ];
    }),
  );

  return {
    onCourtPlayerIds,
    benchPlayerIds,
    timeline,
    playerMinutes,
    score,
    discipline,
    disciplineByPeriod,
    superiorityActive,
    flyingGoalkeeperActive,
    inferiorityActive: onCourtPlayerIds.includes(INFERIORITY_SLOT_ID),
    dismissedPlayerIds: Array.from(dismissedPlayerIds),
    issues,
  };
}

export function assertValidChronology(
  players: Player[],
  events: MatchEvent[],
): void {
  const result = replayMatch(players, events);
  if (result.issues.length > 0) {
    throw new MatchIntegrityError(result.issues);
  }
}

function assertSameMatch(events: MatchEvent[], event: MatchEvent): void {
  if (events.some((candidate) => candidate.matchId !== event.matchId)) {
    throw new Error("No se pueden mezclar eventos de partidos diferentes.");
  }
  if (events.some((candidate) => candidate.id === event.id)) {
    throw new Error(`Ya existe un evento con ID ${event.id}.`);
  }
}

export function appendEvent(
  players: Player[],
  events: MatchEvent[],
  event: MatchEvent,
): MatchEvent[] {
  return appendEvents(players, events, [event]);
}

export function appendEvents(
  players: Player[],
  events: MatchEvent[],
  appendedEvents: MatchEvent[],
): MatchEvent[] {
  const combined = [...events];
  for (const event of appendedEvents) {
    assertSameMatch(combined, event);
    combined.push(event);
  }
  const next = sortEvents(combined);
  assertValidChronology(players, next);
  return next;
}

function normalizeOrders(events: MatchEvent[]): MatchEvent[] {
  const groups = new Map<string, MatchEvent[]>();
  for (const event of events.filter((candidate) => candidate.deletedAt === null)) {
    const key = `${event.period}:${event.minute}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  const positions = new Map<string, number>();
  groups.forEach((group) => {
    group.sort(compareEventPosition).forEach((event, index) => {
      positions.set(event.id, index + 1);
    });
  });

  return events.map((event) => ({
    ...event,
    order: positions.get(event.id) ?? event.order,
  }));
}

export function editEvent(
  players: Player[],
  events: MatchEvent[],
  eventId: string,
  changes: EventEditChanges,
  now = Date.now(),
): MatchEvent[] {
  const current = events.find((event) => event.id === eventId);
  if (!current) {
    throw new Error(`No existe el evento ${eventId}.`);
  }

  let edited: MatchEvent = {
    ...current,
    period: changes.period ?? current.period,
    minute: changes.minute ?? current.minute,
    updatedAt: now,
  };

  if (edited.type === "lineup_initialized" && changes.lineup) {
    edited = {
      ...edited,
      squadPlayerIds:
        changes.lineup.squadPlayerIds ?? edited.squadPlayerIds,
      onCourtPlayerIds:
        changes.lineup.onCourtPlayerIds ?? edited.onCourtPlayerIds,
    };
  } else if (edited.type === "substitution" && changes.substitution) {
    edited = { ...edited, ...changes.substitution };
  } else if (edited.type === "threat_recorded" && changes.threat) {
    if (
      edited.source === "live" &&
      changes.threat.outcome === "BLOQUEADO"
    ) {
      throw new Error("BLOQUEADO solo está permitido en eventos importados.");
    }
    if (
      edited.source === "live" &&
      (changes.threat.phase as ThreatPhase | undefined) === "UNSPECIFIED"
    ) {
      throw new Error("UNSPECIFIED solo está permitido en eventos importados.");
    }
    edited = { ...edited, ...changes.threat } as MatchEvent;
  } else if (edited.type === "game_state_changed" && changes.gameState) {
    edited = { ...edited, ...changes.gameState };
  } else if (edited.type === "foul_recorded" && changes.foul) {
    edited = { ...edited, ...changes.foul };
  } else if (edited.type === "card_recorded" && changes.card) {
    edited = { ...edited, ...changes.card };
  }

  const next = normalizeOrders(
    events.map((event) => (event.id === eventId ? edited : event)),
  );
  assertValidChronology(players, next);
  return sortEvents(next);
}

export function softDeleteEvent(
  players: Player[],
  events: MatchEvent[],
  eventId: string,
  now = Date.now(),
): MatchEvent[] {
  const current = events.find((event) => event.id === eventId);
  if (!current) {
    throw new Error(`No existe el evento ${eventId}.`);
  }
  if (current.type === "lineup_initialized") {
    throw new Error("La inicialización de la alineación no puede eliminarse.");
  }
  const next = normalizeOrders(
    events.map((event) =>
      event.id === eventId
        ? { ...event, deletedAt: now, updatedAt: now }
        : event,
    ),
  );
  assertValidChronology(players, next);
  return sortEvents(next);
}

export function restoreEvent(
  players: Player[],
  events: MatchEvent[],
  eventId: string,
  now = Date.now(),
): MatchEvent[] {
  if (!events.some((event) => event.id === eventId)) {
    throw new Error(`No existe el evento ${eventId}.`);
  }
  const next = normalizeOrders(
    events.map((event) =>
      event.id === eventId
        ? { ...event, deletedAt: null, updatedAt: now }
        : event,
    ),
  );
  assertValidChronology(players, next);
  return sortEvents(next);
}

export function reorderEvent(
  players: Player[],
  events: MatchEvent[],
  eventId: string,
  target: EventPosition,
  now = Date.now(),
): MatchEvent[] {
  const current = events.find((event) => event.id === eventId);
  if (!current) {
    throw new Error(`No existe el evento ${eventId}.`);
  }
  if (current.deletedAt !== null) {
    throw new Error("No se puede reordenar un evento eliminado.");
  }

  const moved: MatchEvent = {
    ...current,
    period: target.period,
    minute: target.minute,
    order: target.order,
    updatedAt: now,
  };
  const withoutCurrent = events.filter((event) => event.id !== eventId);
  const targetGroup = withoutCurrent
    .filter(
      (event) =>
        event.deletedAt === null &&
        event.period === target.period &&
        event.minute === target.minute,
    )
    .sort(compareEventPosition);
  const insertAt = Math.max(0, Math.min(target.order - 1, targetGroup.length));
  targetGroup.splice(insertAt, 0, moved);

  const targetOrders = new Map(
    targetGroup.map((event, index) => [event.id, index + 1]),
  );
  const next = normalizeOrders(
    [...withoutCurrent, moved].map((event) =>
      targetOrders.has(event.id)
        ? { ...event, order: targetOrders.get(event.id) as number }
        : event,
    ),
  );
  assertValidChronology(players, next);
  return sortEvents(next);
}

export type SameMinutePlacement = "BEFORE" | "AFTER";

/**
 * Mueve un evento respecto a otro sin permitir que el gesto cambie periodo o
 * minuto. BEFORE/AFTER se expresan en orden cronológico ascendente.
 */
export function moveEventWithinMinute(
  players: Player[],
  events: MatchEvent[],
  eventId: string,
  targetEventId: string,
  placement: SameMinutePlacement,
  now = Date.now(),
): MatchEvent[] {
  const current = events.find((event) => event.id === eventId);
  const target = events.find((event) => event.id === targetEventId);
  if (!current || !target) {
    throw new Error("No existe alguno de los eventos que se quiere reordenar.");
  }
  if (current.deletedAt !== null || target.deletedAt !== null) {
    throw new Error("No se pueden arrastrar eventos eliminados.");
  }
  if (
    current.period !== target.period ||
    current.minute !== target.minute
  ) {
    throw new Error("Arrastrar solo reordena eventos del mismo periodo y minuto.");
  }
  if (current.id === target.id) {
    return events;
  }

  const group = sortEvents(
    events.filter(
      (event) =>
        event.deletedAt === null &&
        event.period === current.period &&
        event.minute === current.minute,
    ),
  );
  const withoutCurrent = group.filter((event) => event.id !== current.id);
  const targetIndex = withoutCurrent.findIndex(
    (event) => event.id === target.id,
  );
  withoutCurrent.splice(
    placement === "BEFORE" ? targetIndex : targetIndex + 1,
    0,
    current,
  );

  const nextOrders = new Map(
    withoutCurrent.map((event, index) => [event.id, index + 1]),
  );
  const next = sortEvents(
    events.map((event) => {
      const nextOrder = nextOrders.get(event.id);
      if (nextOrder === undefined || nextOrder === event.order) {
        return event;
      }
      return { ...event, order: nextOrder, updatedAt: now };
    }),
  );
  assertValidChronology(players, next);
  return next;
}
