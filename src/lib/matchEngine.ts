import {
  CardColor,
  CardRecordedEvent,
  DisciplineSummary,
  DisciplineSide,
  DefensiveThreatDetail,
  EventProvenance,
  EventPosition,
  FoulRecordedEvent,
  GameContext,
  GameStateChangedEvent,
  GameStateKind,
  GoalAssist,
  GoalkeeperReference,
  INFERIORITY_SLOT_ID,
  InferiorityCause,
  LegacyThreatImportedEvent,
  LineupInitializedEvent,
  LiveThreatPhase,
  LiveThreatOutcome,
  LiveThreatRecordedEvent,
  MATCH_EVENT_SCHEMA_VERSION,
  MatchEvent,
  NormalizedCoordinates,
  Player,
  LineupValidation,
  ReplayIssue,
  ReplayResult,
  SubstitutionEvent,
  ThreatOutcome,
  ThreatPhase,
  ThreatRecordedEvent,
  ThreatSide,
} from "../types";
import {
  deriveKeeperBodyZone,
  isOutcomeCompatibleWithGoalTarget,
  validGoalTarget,
} from "./goalTarget";

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

/** Proyección visual de cuenta atrás; no se persiste como fuente temporal. */
export function deriveRemainingMinute(
  elapsedMinute: number,
  periodDurationMinutes = REGULATION_MATCH_CLOCK.periodDurationMinutes,
): number {
  const duration = Math.max(1, Math.trunc(periodDurationMinutes));
  return duration - Math.min(duration, Math.max(0, Math.trunc(elapsedMinute)));
}

export interface ReplayOptions {
  currentClock?: Pick<EventPosition, "period" | "minute">;
  throughClock?: Pick<EventPosition, "period" | "minute">;
  throughPosition?: EventPosition;
  periodDurationMinutes?: number;
  foulAccumulationRules?: FoulAccumulationRules;
}

export interface FoulAccumulationRules {
  /** Umbrales de la competición. Vacío por defecto: ninguna regla implícita. */
  thresholds: readonly number[];
}

function participationMinute(
  period: number,
  minute: number,
  periodDurationMinutes: number,
): number {
  // El reloj interno representa tiempo transcurrido (0..20). La cuenta atrás
  // es una proyección de interfaz y no cambia esta fuente temporal.
  const completedPeriods = Math.max(0, period - 1) * periodDurationMinutes;
  const elapsedInPeriod = Math.max(0, minute);
  return completedPeriods + elapsedInPeriod;
}

export class MatchIntegrityError extends Error {
  constructor(public readonly issues: ReplayIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "MatchIntegrityError";
  }
}

export class EventDeletionBlockedError extends Error {
  constructor(
    public readonly eventId: string,
    public readonly blockingIssues: ReplayIssue[],
  ) {
    const uniqueBlockingEvents = new Set(
      blockingIssues.map((issue) => issue.eventId),
    ).size;
    const detail = blockingIssues[0]?.message;
    super(
      `No se puede eliminar este evento: ${uniqueBlockingEvents} evento${
        uniqueBlockingEvents === 1 ? "" : "s"
      } posterior${uniqueBlockingEvents === 1 ? "" : "es"} depende${
        uniqueBlockingEvents === 1 ? "" : "n"
      } de él. ${detail ?? "La cronología resultante no sería válida."} Edita o elimina primero ${
        uniqueBlockingEvents === 1 ? "ese evento" : "esos eventos"
      }.`,
    );
    this.name = "EventDeletionBlockedError";
  }
}

interface EventFactoryBase {
  id?: string;
  matchId: string;
  position: EventPosition;
  now?: number;
  provenance?: EventProvenance;
}

export interface LineupEventInput extends EventFactoryBase {
  squadPlayerIds: string[];
  onCourtPlayerIds: string[];
  goalkeeperPlayerId?: string;
}

export interface SubstitutionEventInput extends EventFactoryBase {
  playerOutId: string;
  playerInId: string;
  relatedCardEventId?: string;
}

export interface GameStateEventInput extends EventFactoryBase {
  state: GameStateKind;
  active: boolean;
  playerId?: string;
}

export interface FoulEventInput extends EventFactoryBase {
  side: DisciplineSide;
  playerId?: string | null;
  origin?: NormalizedCoordinates;
}

export interface CardEventInput extends EventFactoryBase {
  side: DisciplineSide;
  color: CardColor;
  playerId?: string;
  staffId?: string;
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
  assist?: GoalAssist;
  defensive?: DefensiveThreatDetail;
  pendingReview?: boolean;
}

export interface LegacyThreatEventInput extends ThreatEventInput {
  outcome: ThreatOutcome;
  phase?: ThreatPhase;
}

export interface EventEditChanges {
  period?: number;
  minute?: number;
  pendingReview?: boolean;
  lineup?: Partial<
    Pick<LineupInitializedEvent, "squadPlayerIds" | "onCourtPlayerIds">
  >;
  substitution?: Partial<
    Pick<SubstitutionEvent, "playerOutId" | "playerInId">
  >;
  threat?: Partial<
    Pick<LiveThreatRecordedEvent, "side" | "playerId" | "origin" | "phase" | "sequenceId" | "parentEventId">
  > & {
    outcome?: ThreatOutcome;
    assist?: GoalAssist | null;
    defensive?: DefensiveThreatDetail | null;
  };
  gameState?: Partial<Pick<GameStateChangedEvent, "state" | "active" | "playerId">>;
  foul?: Partial<Pick<FoulRecordedEvent, "side" | "playerId" | "origin">>;
  card?: Partial<Pick<CardRecordedEvent, "side" | "color">> & {
    playerId?: string | null;
    staffId?: string | null;
  };
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
    pendingReview: false,
    provenance: input.provenance ?? "LIVE",
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
    ...(input.goalkeeperPlayerId
      ? { goalkeeperPlayerId: input.goalkeeperPlayerId }
      : {}),
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
    relatedCardEventId: input.relatedCardEventId,
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
    playerId: input.active ? input.playerId : undefined,
  };
}

export function createFoulEvent(input: FoulEventInput): FoulRecordedEvent {
  return {
    ...eventBase(input),
    type: "foul_recorded",
    side: input.side,
    source: "live",
    playerId: input.playerId ?? null,
    origin: input.origin ? { ...input.origin } : undefined,
  };
}

export function createCardEvent(input: CardEventInput): CardRecordedEvent {
  return {
    ...eventBase(input),
    type: "card_recorded",
    side: input.side,
    color: input.color,
    playerId: input.playerId,
    staffId: input.staffId,
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
    assist: input.assist ? { ...input.assist } : undefined,
    defensive: input.defensive
      ? {
          ...input.defensive,
          goalTarget: { ...input.defensive.goalTarget },
          goalkeeper: { ...input.defensive.goalkeeper },
        }
      : undefined,
    pendingReview:
      input.pendingReview === true ||
      input.assist?.status === "PENDING" ||
      input.defensive?.goalkeeper.status === "PENDING",
  };
}

export function createLegacyThreatEvent(
  input: LegacyThreatEventInput,
): LegacyThreatImportedEvent {
  const base = eventBase({ ...input, provenance: input.provenance ?? "IMPORT" });
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
    assist: undefined,
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

function sequenceRootThreat(
  events: MatchEvent[],
  event: ThreatRecordedEvent,
): ThreatRecordedEvent | undefined {
  const sequenceId = event.sequenceId ?? event.id;
  const canonicalRoot = events.find(
    (candidate): candidate is ThreatRecordedEvent =>
      candidate.type === "threat_recorded" && candidate.id === sequenceId,
  );
  if (canonicalRoot) return canonicalRoot;

  let current: ThreatRecordedEvent | undefined = event;
  const visited = new Set<string>();
  while (current?.parentEventId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = events.find(
      (candidate): candidate is ThreatRecordedEvent =>
        candidate.type === "threat_recorded" &&
        candidate.id === current?.parentEventId,
    );
    if (!parent) break;
    current = parent;
  }
  return current;
}

/**
 * La fase analítica de una continuación procede siempre de la raíz. El helper
 * permite consumir cronologías antiguas sin convertir la fase en otro estado.
 */
export function effectiveThreatPhase(
  events: MatchEvent[],
  event: ThreatRecordedEvent,
): ThreatPhase {
  return sequenceRootThreat(events, event)?.phase ?? event.phase;
}

/**
 * Mantiene el campo redundante de fase de eventos locales antiguos coherente
 * con la raíz. Se conserva por compatibilidad de esquema, no como verdad
 * independiente.
 */
export function synchronizeThreatSequencePhases(
  events: MatchEvent[],
  now?: number,
): MatchEvent[] {
  return events.map((event) => {
    if (event.type !== "threat_recorded" || !event.parentEventId) return event;
    const phase = effectiveThreatPhase(events, event);
    if (event.phase === phase) return event;
    return {
      ...event,
      phase,
      ...(now === undefined ? {} : { updatedAt: now }),
    } as MatchEvent;
  });
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

function goalkeeperRole(player: Player, flyingGoalkeeperActive: boolean): boolean {
  const role = player.position?.trim().toUpperCase().replaceAll("_", "-") ?? "";
  if (flyingGoalkeeperActive) {
    return role === "PORTERO-JUGADOR" || role === "FLYING-GOALKEEPER";
  }
  return player.goalkeeperCapable === true || role === "PORTERO" || role === "GOALKEEPER";
}

/** Resuelve solo una identidad respaldada por rol y presencia en pista. */
export function deriveGoalkeeperReference(
  players: Player[],
  onCourtPlayerIds: readonly string[],
  flyingGoalkeeperActive: boolean,
  flyingGoalkeeperPlayerId?: string,
  explicitGoalkeeperPlayerId?: string,
): GoalkeeperReference {
  const onCourt = new Set(onCourtPlayerIds);
  if (
    flyingGoalkeeperActive &&
    flyingGoalkeeperPlayerId &&
    onCourt.has(flyingGoalkeeperPlayerId)
  ) {
    return {
      status: "PLAYER",
      playerId: flyingGoalkeeperPlayerId,
      resolution: "REPLAY",
    };
  }
  if (
    !flyingGoalkeeperActive &&
    explicitGoalkeeperPlayerId &&
    onCourt.has(explicitGoalkeeperPlayerId) &&
    players.some((player) => player.id === explicitGoalkeeperPlayerId)
  ) {
    return {
      status: "PLAYER",
      playerId: explicitGoalkeeperPlayerId,
      resolution: "REPLAY",
    };
  }
  const candidates = players.filter(
    (player) =>
      onCourt.has(player.id) && goalkeeperRole(player, flyingGoalkeeperActive),
  );
  return candidates.length === 1
    ? { status: "PLAYER", playerId: candidates[0].id, resolution: "REPLAY" }
    : { status: "PENDING" };
}

function positionAtOrBefore(event: MatchEvent, target: EventPosition): boolean {
  return (
    event.period < target.period ||
    (event.period === target.period && event.minute < target.minute) ||
    (event.period === target.period &&
      event.minute === target.minute &&
      event.order <= target.order)
  );
}

export function goalkeeperAtPosition(
  players: Player[],
  events: MatchEvent[],
  position: EventPosition,
): GoalkeeperReference {
  const replay = replayMatch(players, events, { throughPosition: position });
  return replay.lineupValidation.goalkeeper;
}

/**
 * Recalcula referencias derivables cuando cambia la cronología. Una selección
 * manual solo se conserva en P-J si la persona seguía realmente en pista.
 */
export function reconcileDefensiveGoalkeepers(
  players: Player[],
  events: MatchEvent[],
): MatchEvent[] {
  const withoutDefensive = events.map((event) =>
    event.type === "threat_recorded" && event.defensive
      ? { ...event, defensive: undefined }
      : event,
  ) as MatchEvent[];

  return events.map((event) => {
    if (event.type !== "threat_recorded" || !event.defensive) return event;
    const snapshot = replayMatch(players, withoutDefensive, {
      throughPosition: {
        period: event.period,
        minute: event.minute,
        order: event.order,
      },
    });
    const derived = snapshot.lineupValidation.goalkeeper;
    const manualStillValid =
      derived.status === "PENDING" &&
      event.defensive.goalkeeper.status === "PLAYER" &&
      event.defensive.goalkeeper.resolution === "MANUAL" &&
      snapshot.onCourtPlayerIds.includes(event.defensive.goalkeeper.playerId);
    const goalkeeper = manualStillValid
      ? event.defensive.goalkeeper
      : derived;
    if (
      JSON.stringify(goalkeeper) === JSON.stringify(event.defensive.goalkeeper)
    ) {
      return event;
    }
    return {
      ...event,
      defensive: { ...event.defensive, goalkeeper },
      pendingReview:
        goalkeeper.status === "PENDING" ? true : event.pendingReview,
    };
  });
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
  superiorityActive: boolean,
  flyingGoalkeeperActive: boolean,
  inferiorityActive: boolean,
): GameContext[] {
  const contexts: GameContext[] = [];

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

export function validateLineupState(
  players: Player[],
  onCourtPlayerIds: readonly string[],
  flyingGoalkeeperActive: boolean,
  inferiorityCause?: InferiorityCause,
  flyingGoalkeeperPlayerId?: string,
  explicitGoalkeeperPlayerId?: string,
): LineupValidation {
  const playerIds = new Set(players.map((player) => player.id));
  const actualPlayersOnCourt = onCourtPlayerIds.filter((id) =>
    playerIds.has(id),
  ).length;
  const slotPresent = onCourtPlayerIds.includes(INFERIORITY_SLOT_ID);
  const justifiedInferiority = slotPresent && Boolean(inferiorityCause);
  const expectedPlayersOnCourt = justifiedInferiority ? 4 : MAX_ON_COURT;
  const goalkeeper = deriveGoalkeeperReference(
    players,
    onCourtPlayerIds,
    flyingGoalkeeperActive,
    flyingGoalkeeperPlayerId,
    explicitGoalkeeperPlayerId,
  );
  const reasons: LineupValidation["reasons"] = [];

  if (slotPresent && !inferiorityCause) {
    reasons.push({
      code: "UNJUSTIFIED_INFERIORITY",
      message: "La plaza INFERIORIDAD no está justificada por una roja propia activa.",
    });
  }
  if (actualPlayersOnCourt < expectedPlayersOnCourt) {
    reasons.push({
      code: "MISSING_PLAYERS",
      message: `${actualPlayersOnCourt}/${expectedPlayersOnCourt} jugadores reales en pista.`,
    });
  } else if (actualPlayersOnCourt > expectedPlayersOnCourt) {
    reasons.push({
      code: "TOO_MANY_PLAYERS",
      message: `${actualPlayersOnCourt}/${expectedPlayersOnCourt} jugadores reales en pista.`,
    });
  }
  if (goalkeeper.status === "PENDING") {
    reasons.push({
      code: "GOALKEEPER_UNRESOLVED",
      message: "No se puede determinar un único portero funcional en pista.",
    });
  }

  return {
    valid: reasons.length === 0,
    captureBlocked: reasons.length > 0,
    actualPlayersOnCourt,
    expectedPlayersOnCourt,
    goalkeeper,
    inferiorityCause: justifiedInferiority ? inferiorityCause : undefined,
    reasons,
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
  let flyingGoalkeeperPlayerId: string | undefined;
  let explicitGoalkeeperPlayerId: string | undefined;
  let inferiorityCause: InferiorityCause | undefined;
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
          candidate.minute <= options.throughClock.minute)) &&
      (!options.throughPosition ||
        positionAtOrBefore(candidate, options.throughPosition)),
  );
  const matchIds = new Set(activeEvents.map((event) => event.matchId));
  const occupiedPositions = new Set<string>();
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const activeRedCardsById = new Map<string, CardRecordedEvent>();
  const latestRedCardByPlayer = new Map<string, CardRecordedEvent>();
  const foulThresholds = Array.from(
    new Set(
      (options.foulAccumulationRules?.thresholds ?? [])
        .map((value) => Math.trunc(value))
        .filter((value) => value > 0),
    ),
  ).sort((a, b) => a - b);

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
    let periodFoulsBefore: number | undefined;
    let periodFoulsAfter: number | undefined;
    let reachedFoulThresholds: number[] | undefined;
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
      if (
        event.goalkeeperPlayerId &&
        (!event.onCourtPlayerIds.includes(event.goalkeeperPlayerId) ||
          !playerIds.has(event.goalkeeperPlayerId))
      ) {
        issue(
          issues,
          event,
          "INVALID_GOALKEEPER",
          "El portero funcional explícito debe ser un jugador convocado y en pista.",
        );
      }

      squadPlayerIds = [...event.squadPlayerIds];
      onCourtPlayerIds = [...event.onCourtPlayerIds];
      const legacyGoalkeeperCandidates = event.onCourtPlayerIds.filter((playerId) => {
        const player = players.find((candidate) => candidate.id === playerId);
        return player && (player.goalkeeperCapable || goalkeeperRole(player, false));
      });
      explicitGoalkeeperPlayerId =
        event.goalkeeperPlayerId &&
        event.onCourtPlayerIds.includes(event.goalkeeperPlayerId)
          ? event.goalkeeperPlayerId
          : legacyGoalkeeperCandidates.length === 1
            ? legacyGoalkeeperCandidates[0]
            : undefined;
      inferiorityCause = undefined;
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
      const explicitCause = event.relatedCardEventId
        ? activeRedCardsById.get(event.relatedCardEventId)
        : undefined;
      const legacyCause = !event.relatedCardEventId
        ? latestRedCardByPlayer.get(event.playerOutId)
        : undefined;
      const causeCard = explicitCause ?? legacyCause;
      const validCause =
        incomingIsInferiority &&
        causeCard?.side === "FOR" &&
        causeCard.color === "RED" &&
        causeCard.playerId === event.playerOutId &&
        compareEventPosition(causeCard, event) < 0
          ? causeCard
          : undefined;
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
        if (explicitGoalkeeperPlayerId === event.playerOutId) {
          explicitGoalkeeperPlayerId = incomingIsInferiority
            ? undefined
            : event.playerInId;
        }
        if (flyingGoalkeeperPlayerId === event.playerOutId) {
          flyingGoalkeeperPlayerId = incomingIsInferiority
            ? undefined
            : event.playerInId;
        }
        enteredAt.delete(event.playerOutId);
        enteredAt.set(event.playerInId, eventElapsedMinute);
        refreshBench();
        if (incomingIsInferiority) {
          inferiorityCause = validCause
            ? {
                cardEventId: validCause.id,
                substitutionEventId: event.id,
                playerId: event.playerOutId,
                inferredFromLegacy: !event.relatedCardEventId,
              }
            : undefined;
        } else if (event.playerOutId === INFERIORITY_SLOT_ID) {
          inferiorityCause = undefined;
        }
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
      if (event.assist) {
        const assistIsCompatible =
          event.side === "FOR" &&
          event.outcome === "GOL" &&
          (event.assist.status !== "PLAYER" ||
            (event.assist.playerId !== event.playerId &&
              onCourtPlayerIds.includes(event.assist.playerId)));
        if (!assistIsCompatible) {
          issue(
            issues,
            event,
            "INVALID_ASSIST",
            "La asistencia debe corresponder a otro jugador que estaba en pista en el gol CDA.",
          );
        }
      }
      if (event.defensive) {
        const detail = event.defensive;
        const defensiveOutcome =
          event.outcome === "BLOQUEADO" ? null : event.outcome;
        const expectedGoalkeeper = deriveGoalkeeperReference(
          players,
          onCourtPlayerIds,
          flyingGoalkeeperActive,
          flyingGoalkeeperPlayerId,
          explicitGoalkeeperPlayerId,
        );
        if (
          event.side !== "AGAINST" ||
          !validGoalTarget(detail.goalTarget) ||
          !defensiveOutcome ||
          !isOutcomeCompatibleWithGoalTarget(
            detail.goalTarget,
            defensiveOutcome,
          )
        ) {
          issue(
            issues,
            event,
            "INVALID_GOAL_TARGET",
            "El destino de portería debe ser válido y coherente con el resultado rival.",
          );
        }
        if (
          detail.goalkeeper.status === "PLAYER" &&
          (!playerIds.has(detail.goalkeeper.playerId) ||
            !onCourtPlayerIds.includes(detail.goalkeeper.playerId) ||
            (expectedGoalkeeper.status === "PLAYER" &&
              expectedGoalkeeper.playerId !== detail.goalkeeper.playerId))
        ) {
          issue(
            issues,
            event,
            "INVALID_GOALKEEPER",
            "El portero debe ser un jugador que estaba en pista en ese instante.",
          );
        }
        const validSave = event.outcome === "PARADA"
          ? detail.version === 1
            ? Boolean(
                detail.saveOutcome &&
                  detail.keeperBodyZone === deriveKeeperBodyZone(detail.goalTarget),
              )
            : Boolean(detail.saveOutcome && detail.keeperBodyPart)
          : detail.saveOutcome === undefined &&
            (detail.version === 1
              ? detail.keeperBodyZone === undefined
              : detail.keeperBodyPart === undefined);
        if (!validSave) {
          issue(
            issues,
            event,
            "INVALID_SAVE_DETAIL",
            "La parada requiere zona corporal y desenlace; gol y fuera no admiten esos campos.",
          );
        }
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
          parent.deletedAt !== null ||
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
        } else if (
          event.source === "live" &&
          event.side === "AGAINST" &&
          (parent.source !== "live" ||
            parent.side !== "AGAINST" ||
            parent.outcome !== "PARADA" ||
            parent.defensive?.saveOutcome !== "REBOUND")
        ) {
          issue(
            issues,
            event,
            "INVALID_EVENT_LINK",
            "Una segunda jugada rival solo puede continuar una parada con rechace.",
          );
        } else if (
          parent.type === "threat_recorded" &&
          event.phase !== effectiveThreatPhase(events, event)
        ) {
          issue(
            issues,
            event,
            "INVALID_EVENT_LINK",
            "La fase de una continuación debe heredarse de la raíz de su secuencia.",
          );
        }
      }
    } else if (event.type === "game_state_changed") {
      if (event.state === "SUPERIORITY") {
        superiorityActive = event.active;
      } else {
        flyingGoalkeeperActive = event.active;
        if (!event.active) {
          flyingGoalkeeperPlayerId = undefined;
        } else if (
          event.playerId &&
          playerIds.has(event.playerId) &&
          onCourtPlayerIds.includes(event.playerId)
        ) {
          flyingGoalkeeperPlayerId = event.playerId;
        } else {
          flyingGoalkeeperPlayerId = undefined;
          if (event.playerId) {
            issue(
              issues,
              event,
              "INVALID_GAME_STATE_PLAYER",
              "El portero-jugador debe ser un jugador que estaba en pista.",
            );
          }
        }
      }
    } else if (event.type === "foul_recorded") {
      if (event.origin && !validCoordinates(event.origin)) {
        issue(
          issues,
          event,
          "INVALID_COORDINATES",
          "La ubicación opcional de la falta debe usar coordenadas entre 0 y 1.",
        );
      }
      if (event.playerId && !squadPlayerIds.includes(event.playerId)) {
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
      periodFoulsBefore = periodDiscipline[teamKey].fouls;
      periodDiscipline[teamKey].fouls += 1;
      disciplineByPeriod[event.period] = periodDiscipline;
      periodFoulNumber = periodDiscipline[teamKey].fouls;
      periodFoulsAfter = periodFoulNumber;
      reachedFoulThresholds = foulThresholds.filter(
        (threshold) =>
          (periodFoulsBefore ?? 0) < threshold &&
          (periodFoulsAfter ?? 0) >= threshold,
      );
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
      const ownTargetCount = Number(Boolean(event.playerId)) + Number(Boolean(event.staffId));
      if (event.side === "FOR" && ownTargetCount !== 1) {
        issue(
          issues,
          event,
          "INVALID_CARD_TARGET",
          "Una tarjeta propia debe identificar exactamente a un jugador o miembro del cuerpo técnico.",
        );
      } else if (
        event.side === "FOR" &&
        event.playerId &&
        !playerIds.has(event.playerId)
      ) {
        issue(
          issues,
          event,
          "INVALID_CARD_PLAYER",
          "La tarjeta referencia a un jugador desconocido.",
        );
      } else if (
        event.side === "FOR" &&
        event.color === "RED" &&
        event.playerId
      ) {
        dismissedPlayerIds.add(event.playerId);
        activeRedCardsById.set(event.id, event);
        latestRedCardByPlayer.set(event.playerId, event);
      }
    }

    timeline.push({
      event,
      lineupPlayerIds: [...onCourtPlayerIds],
      benchPlayerIds: [...benchPlayerIds],
      gameContexts: gameContexts(
        superiorityActive,
        flyingGoalkeeperActive,
        Boolean(
          inferiorityCause &&
            onCourtPlayerIds.includes(INFERIORITY_SLOT_ID),
        ),
      ),
      periodFoulNumber,
      periodFoulsBefore,
      periodFoulsAfter,
      reachedFoulThresholds,
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
  const lineupValidation = validateLineupState(
    players,
    onCourtPlayerIds,
    flyingGoalkeeperActive,
    inferiorityCause,
    flyingGoalkeeperPlayerId,
    explicitGoalkeeperPlayerId,
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
    flyingGoalkeeperPlayerId,
    inferiorityActive: Boolean(lineupValidation.inferiorityCause),
    lineupValidation,
    dismissedPlayerIds: Array.from(dismissedPlayerIds),
    issues,
  };
}

export interface SecondPeriodLineupProposal {
  playerIds: string[];
  goalkeeperPlayerId?: string;
}

/**
 * Propone P2 desde el último estado efectivo de P1. Si P2 ya fue inicializada,
 * devuelve esa única alineación para que recarga y retry sean idempotentes.
 */
export function proposeSecondPeriodLineup(
  players: Player[],
  events: MatchEvent[],
): SecondPeriodLineupProposal {
  const initialized = sortEvents(events)
    .filter(
      (event) =>
        event.deletedAt === null &&
        event.type === "lineup_initialized" &&
        event.period === 2,
    )
    .at(-1);
  if (initialized?.type === "lineup_initialized") {
    return {
      playerIds: [...initialized.onCourtPlayerIds],
      goalkeeperPlayerId: initialized.goalkeeperPlayerId,
    };
  }
  const replay = replayMatch(players, events, {
    currentClock: {
      period: 1,
      minute: REGULATION_MATCH_CLOCK.periodDurationMinutes,
    },
    throughClock: {
      period: 1,
      minute: REGULATION_MATCH_CLOCK.periodDurationMinutes,
    },
  });
  return {
    playerIds: replay.onCourtPlayerIds.filter(
      (playerId) => playerId !== INFERIORITY_SLOT_ID,
    ),
    goalkeeperPlayerId:
      replay.lineupValidation.goalkeeper.status === "PLAYER"
        ? replay.lineupValidation.goalkeeper.playerId
        : undefined,
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
  const next = sortEvents(reconcileDefensiveGoalkeepers(players, combined));
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

  if (
    current.type === "threat_recorded" &&
    current.parentEventId &&
    changes.threat?.phase !== undefined &&
    changes.threat.phase !== effectiveThreatPhase(events, current)
  ) {
    throw new Error(
      "La fase de una segunda jugada se edita desde la amenaza raíz.",
    );
  }

  let edited: MatchEvent = {
    ...current,
    period: changes.period ?? current.period,
    minute: changes.minute ?? current.minute,
    pendingReview: changes.pendingReview ?? current.pendingReview,
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
    const { assist, defensive, ...threatChanges } = changes.threat;
    edited = {
      ...edited,
      ...threatChanges,
      ...(assist === null ? { assist: undefined } : assist ? { assist } : {}),
      ...(defensive === null
        ? { defensive: undefined }
        : defensive
          ? { defensive }
          : {}),
      pendingReview:
        changes.pendingReview ?? (assist?.status === "PENDING"
          ? true
          : edited.assist?.status === "PENDING" && assist
            ? false
            : edited.pendingReview),
    } as MatchEvent;
  } else if (edited.type === "game_state_changed" && changes.gameState) {
    edited = { ...edited, ...changes.gameState };
  } else if (edited.type === "foul_recorded" && changes.foul) {
    edited = { ...edited, ...changes.foul };
  } else if (edited.type === "card_recorded" && changes.card) {
    const { playerId, staffId, ...cardChanges } = changes.card;
    edited = {
      ...edited,
      ...cardChanges,
      ...(playerId === null ? { playerId: undefined } : playerId ? { playerId } : {}),
      ...(staffId === null ? { staffId: undefined } : staffId ? { staffId } : {}),
    };
  }

  if (
    edited.type === "threat_recorded" &&
    edited.assist &&
    (edited.side !== "FOR" || edited.outcome !== "GOL")
  ) {
    edited = {
      ...edited,
      assist: undefined,
      pendingReview:
        changes.pendingReview ??
        (edited.assist.status === "PENDING" ? false : edited.pendingReview),
    };
  }

  if (
    edited.type === "threat_recorded" &&
    edited.assist?.status === "PENDING"
  ) {
    edited = { ...edited, pendingReview: true };
  }

  if (
    edited.type === "threat_recorded" &&
    edited.defensive &&
    edited.side !== "AGAINST"
  ) {
    edited = { ...edited, defensive: undefined };
  }

  if (
    edited.type === "threat_recorded" &&
    edited.defensive?.goalkeeper.status === "PENDING"
  ) {
    edited = { ...edited, pendingReview: true };
  }

  let editedEvents = events.map((event) =>
    event.id === eventId ? edited : event,
  );
  if (
    edited.type === "threat_recorded" &&
    !edited.parentEventId &&
    changes.threat?.phase !== undefined
  ) {
    const sequenceId = edited.sequenceId ?? edited.id;
    editedEvents = editedEvents.map((event) =>
      event.type === "threat_recorded" &&
      event.id !== edited.id &&
      (event.sequenceId ?? event.id) === sequenceId
        ? ({ ...event, phase: edited.phase, updatedAt: now } as MatchEvent)
        : event,
    );
  }
  editedEvents = synchronizeThreatSequencePhases(editedEvents, now);
  const next = reconcileDefensiveGoalkeepers(players, normalizeOrders(
    editedEvents,
  ));
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
  const next = reconcileDefensiveGoalkeepers(players, normalizeOrders(
    events.map((event) =>
      event.id === eventId
        ? { ...event, deletedAt: now, updatedAt: now }
        : event,
    ),
  ));
  try {
    assertValidChronology(players, next);
  } catch (error) {
    if (error instanceof MatchIntegrityError) {
      throw new EventDeletionBlockedError(eventId, error.issues);
    }
    throw error;
  }
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
  const next = reconcileDefensiveGoalkeepers(players, normalizeOrders(
    events.map((event) =>
      event.id === eventId
        ? { ...event, deletedAt: null, updatedAt: now }
        : event,
    ),
  ));
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
  const next = reconcileDefensiveGoalkeepers(players, normalizeOrders(
    [...withoutCurrent, moved].map((event) =>
      targetOrders.has(event.id)
        ? { ...event, order: targetOrders.get(event.id) as number }
        : event,
    ),
  ));
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
  const next = reconcileDefensiveGoalkeepers(players, sortEvents(
    events.map((event) => {
      const nextOrder = nextOrders.get(event.id);
      if (nextOrder === undefined || nextOrder === event.order) {
        return event;
      }
      return { ...event, order: nextOrder, updatedAt: now };
    }),
  ));
  assertValidChronology(players, next);
  return next;
}
