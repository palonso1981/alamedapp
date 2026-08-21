import {
  EventPosition,
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

export interface ReplayOptions {
  currentClock?: Pick<EventPosition, "period" | "minute">;
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

interface ThreatEventInput extends EventFactoryBase {
  side: ThreatSide;
  playerId?: string;
  origin: NormalizedCoordinates;
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

export function createLiveThreatEvent(
  input: LiveThreatEventInput,
): LiveThreatRecordedEvent {
  if (!["GOL", "PARADA", "FUERA"].includes(input.outcome)) {
    throw new Error("La captura V1 solo admite GOL, PARADA o FUERA.");
  }
  if (!input.phase || (input.phase as ThreatPhase) === "UNSPECIFIED") {
    throw new Error("La captura V1 requiere una fase válida.");
  }
  return {
    ...eventBase(input),
    type: "threat_recorded",
    source: "live",
    side: input.side,
    playerId: input.playerId,
    origin: { ...input.origin },
    phase: input.phase,
    outcome: input.outcome,
  };
}

export function createLegacyThreatEvent(
  input: LegacyThreatEventInput,
): LegacyThreatImportedEvent {
  return {
    ...eventBase(input),
    type: "threat_recorded",
    source: "legacy_import",
    side: input.side,
    playerId: input.playerId,
    origin: { ...input.origin },
    phase: input.phase ?? "UNSPECIFIED",
    outcome: input.outcome,
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
  const periodDurationMinutes = options.periodDurationMinutes ?? 20;
  const totalMinutes = new Map(players.map((player) => [player.id, 0]));
  const enteredAt = new Map<string, number>();
  let lastElapsedMinute = 0;
  const timeline: ReplayResult["timeline"] = [];
  const issues: ReplayIssue[] = [];
  const activeEvents = sortEvents(events).filter(
    (candidate) => candidate.deletedAt === null,
  );
  const matchIds = new Set(activeEvents.map((event) => event.matchId));
  const occupiedPositions = new Set<string>();

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
    const eventElapsedMinute = participationMinute(
      event.period,
      event.minute,
      periodDurationMinutes,
    );
    if (hasLineup) {
      const elapsed = Math.max(0, eventElapsedMinute - lastElapsedMinute);
      for (const playerId of onCourtPlayerIds) {
        totalMinutes.set(playerId, (totalMinutes.get(playerId) ?? 0) + elapsed);
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
      benchPlayerIds = squadPlayerIds.filter(
        (id) => !onCourtPlayerIds.includes(id),
      );
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
      if (!onCourtPlayerIds.includes(event.playerOutId)) {
        issue(
          issues,
          event,
          "PLAYER_NOT_ON_COURT",
          "El jugador que sale no está en pista.",
        );
      }
      if (!benchPlayerIds.includes(event.playerInId)) {
        issue(
          issues,
          event,
          "PLAYER_NOT_ON_BENCH",
          "El jugador que entra no está en el banquillo.",
        );
      }
      if (
        onCourtPlayerIds.includes(event.playerOutId) &&
        benchPlayerIds.includes(event.playerInId)
      ) {
        onCourtPlayerIds = onCourtPlayerIds.map((id) =>
          id === event.playerOutId ? event.playerInId : id,
        );
        benchPlayerIds = benchPlayerIds.map((id) =>
          id === event.playerInId ? event.playerOutId : id,
        );
        enteredAt.delete(event.playerOutId);
        enteredAt.set(event.playerInId, eventElapsedMinute);
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
        (!event.playerId || !onCourtPlayerIds.includes(event.playerId))
      ) {
        issue(
          issues,
          event,
          "INVALID_THREAT_AUTHOR",
          "Una amenaza propia debe pertenecer a un jugador que estaba en pista.",
        );
      }
    }

    timeline.push({
      event,
      lineupPlayerIds: [...onCourtPlayerIds],
      benchPlayerIds: [...benchPlayerIds],
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
    totalMinutes.set(playerId, (totalMinutes.get(playerId) ?? 0) + remainingElapsed);
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
  assertSameMatch(events, event);
  const next = sortEvents([...events, event]);
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
