import { create } from "zustand";

import {
  appendEvent,
  appendEvents,
  createCardEvent,
  createFoulEvent,
  createFoulCountAdjustmentEvent,
  createGameStateEvent,
  createLineupInitializedEvent,
  createLiveThreatEvent,
  createPossessionLostEvent,
  createRestartEvent,
  createSubstitutionEvent,
  goalkeeperAtPosition,
  editEvent as editChronologyEvent,
  EventEditChanges,
  getNextOrder,
  moveEventWithinMinute as moveChronologyEventWithinMinute,
  normalizeMatchClock,
  REGULATION_MATCH_CLOCK,
  replayMatch,
  reorderEvent as reorderChronologyEvent,
  restoreEvent as restoreChronologyEvent,
  SameMinutePlacement,
  softDeleteEvent as softDeleteChronologyEvent,
} from "../lib/matchEngine";
import { browserMatchRepository } from "../lib/sync/localMatchRepository";
import {
  CardColor,
  DefensiveThreatDetailV2,
  DisciplineSide,
  EventPosition,
  GameStateKind,
  GoalAssist,
  GoalTargetCoordinates,
  INFERIORITY_SLOT_ID,
  LiveThreatPhase,
  LiveThreatOutcome,
  MatchEvent,
  MatchSession,
  MatchVideoEventOverride,
  MatchVideoSegment,
  NormalizedCoordinates,
  Player,
  KeeperBodyPart,
  SaveOutcome,
  RestartKind,
  RestartSpatialSide,
  StaffMember,
} from "../types";

const HISTORY_LIMIT = 100;

export const DEMO_PLAYERS: Player[] = [
  { id: "p1", name: "Mario", number: 10, dominantFoot: "RIGHT" },
  { id: "p2", name: "Pablo", number: 7, dominantFoot: "LEFT" },
  { id: "p3", name: "Lucas", number: 4, dominantFoot: "RIGHT" },
  { id: "p4", name: "Hugo", number: 5, dominantFoot: "RIGHT" },
  {
    id: "p5",
    name: "Dani",
    number: 1,
    position: "PORTERO",
    dominantFoot: "RIGHT",
  },
  { id: "p6", name: "Álex", number: 11, dominantFoot: "RIGHT" },
  { id: "p7", name: "Marcos", number: 8, dominantFoot: "LEFT" },
  { id: "p8", name: "Leo", number: 9, dominantFoot: "RIGHT" },
  { id: "p9", name: "Iván", number: 2, dominantFoot: "RIGHT" },
  { id: "p10", name: "Sergio", number: 3, dominantFoot: "LEFT" },
  { id: "p11", name: "Raúl", number: 12, dominantFoot: "RIGHT" },
  { id: "p12", name: "Nico", number: 14, dominantFoot: "BOTH" },
];

export const DEMO_STAFF: StaffMember[] = [
  { id: "staff-coach", name: "Entrenador", role: "Entrenador" },
  { id: "staff-assistant", name: "Segundo", role: "Segundo entrenador" },
  { id: "staff-delegate", name: "Delegado", role: "Delegado" },
];

export const DEMO_EXTRA_PLAYER: Player = {
  id: "p13",
  name: "Joel",
  number: 15,
  dominantFoot: "RIGHT",
};

export const CLEAN_GOAL_DEMO_MATCH_ID = "prueba-porteria";
export const secondPeriodLineupEventId = (matchId: string) =>
  `${matchId}:lineup:p2`;
const DEMO_MATCH_IDS = new Set([
  "prueba",
  "prueba-8",
  CLEAN_GOAL_DEMO_MATCH_ID,
]);

function demoPlayersForMatch(matchId: string): Player[] {
  return matchId === "prueba-8"
    ? [...DEMO_PLAYERS, DEMO_EXTRA_PLAYER]
    : DEMO_PLAYERS;
}

function mergeById<T extends { id: string }>(
  current: T[],
  expected: T[],
): T[] {
  const currentIds = new Set(current.map((item) => item.id));
  return [
    ...current,
    ...expected
      .filter((item) => !currentIds.has(item.id))
      .map((item) => ({ ...item })),
  ];
}

function upgradeDemoChronology(
  events: MatchEvent[],
  squadPlayerIds: string[],
): MatchEvent[] {
  return events.map((event) =>
    event.type === "lineup_initialized"
      ? {
          ...event,
          squadPlayerIds: Array.from(
            new Set([...event.squadPlayerIds, ...squadPlayerIds]),
          ),
        }
      : event,
  );
}

/**
 * Migra únicamente fixtures demo conocidos. Conserva reloj, eventos e historial;
 * solo incorpora personas ausentes y amplía la convocatoria de la alineación.
 */
export function upgradeDemoSession(session: MatchSession): MatchSession {
  if (!DEMO_MATCH_IDS.has(session.matchId)) {
    return session;
  }
  const players = mergeById(session.players, demoPlayersForMatch(session.matchId));
  const staff = mergeById(session.staff, DEMO_STAFF);
  const squadPlayerIds = players.map((player) => player.id);
  return {
    ...session,
    players,
    staff,
    events: upgradeDemoChronology(session.events, squadPlayerIds),
    past: session.past.map((events) =>
      upgradeDemoChronology(events, squadPlayerIds),
    ),
    future: session.future.map((events) =>
      upgradeDemoChronology(events, squadPlayerIds),
    ),
  };
}

interface RecordThreatInput {
  id?: string;
  side: DisciplineSide;
  playerId?: string;
  origin: NormalizedCoordinates;
  outcome: LiveThreatOutcome;
  phase: LiveThreatPhase;
  sequenceId?: string;
  parentEventId?: string;
  restartEventId?: string;
  assist?: GoalAssist;
  observedAt?: number;
  defensiveCapture?: {
    goalTarget: GoalTargetCoordinates;
    keeperBodyPart?: KeeperBodyPart;
    saveOutcome?: SaveOutcome;
  };
}

interface MatchState {
  matches: Record<string, MatchSession>;
  ensureMatch: (matchId: string) => void;
  incrementMinute: (matchId: string) => void;
  decrementMinute: (matchId: string) => void;
  setClock: (matchId: string, period: number, minute: number) => void;
  changePeriod: (matchId: string, period: number) => void;
  finishCurrentPeriod: (matchId: string) => void;
  startSecondPeriod: (
    matchId: string,
    onCourtPlayerIds: string[],
    goalkeeperPlayerId: string,
  ) => void;
  resumeFirstPeriod: (matchId: string) => void;
  startPeriodReview: (matchId: string, period: number) => void;
  startFinishedReview: (matchId: string) => void;
  validateReview: (matchId: string) => void;
  reopenReview: (matchId: string) => void;
  setReviewMinute: (matchId: string, minute: number) => void;
  stopPeriodReview: (matchId: string) => void;
  recordThreat: (matchId: string, input: RecordThreatInput) => void;
  toggleGameState: (
    matchId: string,
    state: GameStateKind,
    playerId?: string,
    side?: DisciplineSide,
    observedAt?: number,
  ) => void;
  recordRestart: (
    matchId: string,
    side: DisciplineSide,
    restart: RestartKind,
    spatialSide: RestartSpatialSide,
    observedAt?: number,
  ) => void;
  adjustFoulCount: (matchId: string, side: DisciplineSide, delta: 1 | -1) => void;
  recordFoul: (
    matchId: string,
    side: DisciplineSide,
    playerId?: string | null,
    origin?: NormalizedCoordinates,
    observedAt?: number,
  ) => void;
  recordPossessionLost: (matchId: string, playerId: string, observedAt?: number) => void;
  recordCard: (
    matchId: string,
    side: DisciplineSide,
    color: CardColor,
    playerId?: string,
    causesInferiority?: boolean,
    observedAt?: number,
  ) => void;
  recordStaffCard: (
    matchId: string,
    staffId: string,
    color: CardColor,
    observedAt?: number,
  ) => void;
  setPendingReview: (
    matchId: string,
    eventId: string,
    pendingReview: boolean,
  ) => void;
  swapPlayer: (matchId: string, playerOutId: string, playerInId: string, observedAt?: number) => void;
  editEvent: (
    matchId: string,
    eventId: string,
    changes: EventEditChanges,
  ) => void;
  softDeleteEvent: (matchId: string, eventId: string) => void;
  restoreEvent: (matchId: string, eventId: string) => void;
  reorderEvent: (
    matchId: string,
    eventId: string,
    target: EventPosition,
  ) => void;
  moveEventWithinMinute: (
    matchId: string,
    eventId: string,
    targetEventId: string,
    placement: SameMinutePlacement,
  ) => void;
  editAndReorderEvent: (
    matchId: string,
    eventId: string,
    target: EventPosition,
    changes: EventEditChanges,
  ) => void;
  undo: (matchId: string) => void;
  redo: (matchId: string) => void;
  clearError: (matchId: string) => void;
  resetDemo: (matchId: string) => void;
  setVideoSegments: (matchId: string, segments: MatchVideoSegment[]) => void;
  setVideoEventOverrides: (matchId: string, overrides: MatchVideoEventOverride[]) => void;
}

export function createSession(matchId: string): MatchSession {
  const players = demoPlayersForMatch(matchId).map((player) => ({ ...player }));
  const staff = DEMO_STAFF.map((member) => ({ ...member }));
  const lineup = createLineupInitializedEvent({
    matchId,
    position: { period: 1, minute: 0, order: 1 },
    squadPlayerIds: players.map((player) => player.id),
    onCourtPlayerIds: players.slice(0, 5).map((player) => player.id),
    goalkeeperPlayerId: players.slice(0, 5).find((player) =>
      player.position?.toUpperCase().includes("PORTERO"),
    )?.id,
  });
  const initialMinute = 0;
  return {
    matchId,
    players,
    staff,
    period: 1,
    minute: initialMinute,
    periodMinutes: { 1: initialMinute, 2: 0 },
    closedPeriods: [],
    periodCloseSnapshots: {},
    matchFinished: false,
    events: [lineup],
    past: [],
    future: [],
    lastError: null,
    persistenceStatus: "idle",
    lastSavedAt: null,
  };
}

function withClock(
  session: MatchSession,
  period: number,
  minute: number,
): MatchSession {
  const clock = normalizeMatchClock(period, minute);
  return {
    ...session,
    ...clock,
    periodMinutes: {
      ...session.periodMinutes,
      [clock.period]: clock.minute,
    },
  };
}

function persistSession(session: MatchSession): MatchSession {
  const result = browserMatchRepository.save(session);
  if (result.ok) {
    return {
      ...session,
      persistenceStatus: "saved",
      lastSavedAt: result.savedAt,
    };
  }
  if (result.unavailable && typeof window === "undefined") {
    return session;
  }
  return {
    ...session,
    persistenceStatus: "error",
    lastError: result.message,
  };
}

function updateSession(
  state: MatchState,
  matchId: string,
  updater: (session: MatchSession) => MatchSession,
): Pick<MatchState, "matches"> {
  const current = state.matches[matchId];
  if (!current) {
    return { matches: state.matches };
  }
  return {
    matches: {
      ...state.matches,
      [matchId]: updater(current),
    },
  };
}

function updateAndPersistSession(
  state: MatchState,
  matchId: string,
  updater: (session: MatchSession) => MatchSession,
): Pick<MatchState, "matches"> {
  return updateSession(state, matchId, (session) =>
    persistSession(updater(session)),
  );
}

function commitEvents(
  session: MatchSession,
  events: MatchEvent[],
): MatchSession {
  return {
    ...session,
    events,
    past: [...session.past, session.events].slice(-HISTORY_LIMIT),
    future: [],
    lastError: null,
  };
}

function command(
  session: MatchSession,
  operation: () => MatchEvent[],
): MatchSession {
  try {
    return commitEvents(session, operation());
  } catch (error) {
    return {
      ...session,
      lastError:
        error instanceof Error ? error.message : "No se pudo aplicar la acción.",
    };
  }
}

function assertPeriodOpen(session: MatchSession): void {
  if (session.matchFinished || session.closedPeriods?.includes(session.period)) {
    throw new Error(
      session.matchFinished
        ? "Partido finalizado. Reabre la cronología para revisar, no para capturar."
        : `P${session.period} está cerrado. Inicia el siguiente periodo para continuar.`,
    );
  }
}

function captureClock(session: MatchSession): EventPosition {
  if (session.reviewPeriod !== undefined) {
    if (
      !session.closedPeriods?.includes(session.reviewPeriod)
    ) {
      throw new Error("El contexto de revisión ya no es válido.");
    }
    return {
      period: session.reviewPeriod,
      minute: session.reviewMinute ?? REGULATION_MATCH_CLOCK.periodDurationMinutes,
      order: 1,
    };
  }
  if (session.matchFinished) {
    throw new Error("Partido finalizado. Entra en revisión para corregir la cronología.");
  }
  assertPeriodOpen(session);
  return { period: session.period, minute: session.minute, order: 1 };
}

function captureProvenance(session: MatchSession) {
  return session.reviewPeriod !== undefined ? "MANUAL_REVIEW" as const : "LIVE" as const;
}

function pendingRestartId(
  events: MatchEvent[],
  side: DisciplineSide,
  phase: LiveThreatPhase,
): string | undefined {
  const compatible =
    phase === "SET_PIECE_CORNER"
      ? "CORNER"
      : phase === "SET_PIECE_KICK_IN"
        ? "DANGEROUS_KICK_IN"
        : undefined;
  if (!compatible) return undefined;
  const recent = [...events]
    .filter((event) => event.deletedAt === null && "side" in event && event.side === side)
    .sort((a, b) =>
      a.period - b.period || a.minute - b.minute || a.order - b.order || a.createdAt - b.createdAt,
    )
    .reverse();
  const restart = recent.find((event) => event.type === "restart_recorded");
  if (!restart || restart.type !== "restart_recorded" || restart.restart !== compatible) {
    return undefined;
  }
  const interveningThreat = recent.find(
    (event) => event.type === "threat_recorded" &&
      (event.period > restart.period ||
        (event.period === restart.period && (event.minute > restart.minute ||
          (event.minute === restart.minute && event.order > restart.order)))),
  );
  return interveningThreat ? undefined : restart.id;
}

function assertSportsCaptureAllowed(session: MatchSession): void {
  const clock = captureClock(session);
  const validation = replayMatch(session.players, session.events, {
    throughClock: clock,
  }).lineupValidation;
  if (!validation.captureBlocked) return;
  throw new Error(
    `Alineación bloqueada: ${validation.reasons
      .map((reason) => reason.message)
      .join(" ")} Corrige la cronología o la sustitución antes de registrar otra acción.`,
  );
}

export const useMatchStore = create<MatchState>((set) => ({
  matches: {},

  ensureMatch: (matchId) =>
    set((state) => {
      if (state.matches[matchId]) {
        return state;
      }
      const loaded = browserMatchRepository.load(matchId);
      let session: MatchSession;
      if (!loaded) {
        session = persistSession(createSession(matchId));
      } else {
        const upgraded = upgradeDemoSession(loaded);
        session = upgraded === loaded ? loaded : persistSession(upgraded);
      }
      return {
        matches: {
          ...state.matches,
          [matchId]: session,
        },
      };
    }),

  incrementMinute: (matchId) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        withClock(session, session.period, session.minute + 1),
      ),
    ),

  decrementMinute: (matchId) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        withClock(session, session.period, session.minute - 1),
      ),
    ),

  setClock: (matchId, period, minute) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        withClock(session, period, minute),
      ),
    ),

  changePeriod: (matchId, period) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) => {
        const targetPeriod = normalizeMatchClock(period, 0).period;
        if (session.closedPeriods?.includes(targetPeriod)) {
          return {
            ...session,
            lastError:
              "La parte está finalizada. Entra en revisión sin cambiar el periodo activo.",
          };
        }
        return withClock(
          { ...session, reviewPeriod: undefined, reviewMinute: undefined, lastError: null },
          targetPeriod,
          session.periodMinutes[targetPeriod] ?? 0,
        );
      }),
    ),

  finishCurrentPeriod: (matchId) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) => {
        if (session.closedPeriods?.includes(session.period)) return session;
        const finishedClock = withClock(
          session,
          session.period,
          REGULATION_MATCH_CLOCK.periodDurationMinutes,
        );
        return {
          ...finishedClock,
          closedPeriods: Array.from(
            new Set([...(finishedClock.closedPeriods ?? []), finishedClock.period]),
          ),
          periodCloseSnapshots: {
            ...(finishedClock.periodCloseSnapshots ?? {}),
            [finishedClock.period]: session.minute,
          },
          reviewPeriod: undefined,
          reviewMinute: undefined,
          matchFinished:
            finishedClock.period === REGULATION_MATCH_CLOCK.regulationPeriods,
          reviewStatus:
            finishedClock.period === REGULATION_MATCH_CLOCK.regulationPeriods
              ? "NOT_REVIEWED"
              : session.reviewStatus,
          reviewRevision:
            finishedClock.period === REGULATION_MATCH_CLOCK.regulationPeriods
              ? session.reviewRevision ?? 0
              : session.reviewRevision,
          preparation: finishedClock.preparation
            ? {
                ...finishedClock.preparation,
                status:
                  finishedClock.period === REGULATION_MATCH_CLOCK.regulationPeriods
                    ? "FINISHED"
                    : finishedClock.preparation.status,
                updatedAt: Date.now(),
              }
            : undefined,
          lastError: null,
        };
      }),
    ),

  startSecondPeriod: (matchId, onCourtPlayerIds, goalkeeperPlayerId) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) => {
        if (!session.closedPeriods?.includes(1) || session.matchFinished) {
          return {
            ...session,
            lastError: "Finaliza P1 antes de iniciar la segunda parte.",
          };
        }
        const existing = session.events.find(
          (event) =>
            event.deletedAt === null &&
            event.type === "lineup_initialized" &&
            event.period === 2,
        );
        if (existing) {
          if (session.period === 2) return { ...session, lastError: null };
          return withClock(
            { ...session, reviewPeriod: undefined, reviewMinute: undefined, lastError: null },
            2,
            session.periodMinutes[2] ?? 0,
          );
        }

        const initialized = command(session, () => {
          const uniquePlayerIds = Array.from(new Set(onCourtPlayerIds));
          const p1Replay = replayMatch(session.players, session.events, {
            throughClock: {
              period: 1,
              minute: REGULATION_MATCH_CLOCK.periodDurationMinutes,
            },
          });
          const squadPlayerIds = Array.from(
            new Set([
              ...p1Replay.onCourtPlayerIds,
              ...p1Replay.benchPlayerIds,
            ]),
          ).filter((playerId) => playerId !== INFERIORITY_SLOT_ID);
          if (
            uniquePlayerIds.length !== 5 ||
            uniquePlayerIds.some((playerId) => !squadPlayerIds.includes(playerId))
          ) {
            throw new Error("El inicio de P2 requiere cinco jugadores convocados distintos.");
          }
          if (!goalkeeperPlayerId || !uniquePlayerIds.includes(goalkeeperPlayerId)) {
            throw new Error("Elige quién ejercerá de portero funcional al iniciar P2.");
          }
          const lineup = createLineupInitializedEvent({
            id: secondPeriodLineupEventId(matchId),
            matchId,
            position: { period: 2, minute: 0, order: 1 },
            squadPlayerIds,
            onCourtPlayerIds: uniquePlayerIds,
            goalkeeperPlayerId,
          });
          return appendEvent(session.players, session.events, lineup);
        });
        if (initialized.lastError) return initialized;
        return withClock(
          {
            ...initialized,
            reviewPeriod: undefined,
            reviewMinute: undefined,
            lastError: null,
          },
          2,
          0,
        );
      }),
    ),

  resumeFirstPeriod: (matchId) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) => {
        const p2HasEvents = session.events.some(
          (event) => event.type !== "lineup_initialized" && event.period === 2,
        );
        const previousMinute = session.periodCloseSnapshots?.[1];
        if (
          session.period !== 1 ||
          !session.closedPeriods?.includes(1) ||
          p2HasEvents ||
          previousMinute === undefined
        ) {
          return {
            ...session,
            lastError:
              session.period === 2 || p2HasEvents
                ? "P2 ya ha comenzado. Revisa P1 sin convertirla en periodo activo."
                : "No existe un minuto previo seguro para reanudar P1.",
          };
        }
        const remainingSnapshots = Object.fromEntries(
          Object.entries(session.periodCloseSnapshots ?? {}).filter(
            ([period]) => period !== "1",
          ),
        );
        return withClock(
          {
            ...session,
            closedPeriods: (session.closedPeriods ?? []).filter((period) => period !== 1),
            periodCloseSnapshots: remainingSnapshots,
            reviewPeriod: undefined,
            reviewMinute: undefined,
            matchFinished: false,
            lastError: null,
          },
          1,
          previousMinute,
        );
      }),
    ),

  startPeriodReview: (matchId, period) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) => {
        const target = normalizeMatchClock(period, 0).period;
        if (!session.closedPeriods?.includes(target) || (!session.matchFinished && target === session.period)) {
          return {
            ...session,
            lastError: "Solo puede revisarse deliberadamente un periodo ya finalizado.",
          };
        }
        return {
          ...session,
          reviewPeriod: target,
          reviewMinute: REGULATION_MATCH_CLOCK.periodDurationMinutes,
          lastError: null,
        };
      }),
    ),

  startFinishedReview: (matchId) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) => {
        if (!session.matchFinished) {
          return { ...session, lastError: "El partido todavía no está finalizado." };
        }
        if (session.reviewStatus === "VALIDATED") {
          return {
            ...session,
            lastError: "El partido está validado. Reabre la revisión de forma deliberada.",
          };
        }
        const closedPeriods = session.closedPeriods?.length
          ? session.closedPeriods
          : Array.from(
              { length: REGULATION_MATCH_CLOCK.regulationPeriods },
              (_, index) => index + 1,
            );
        const target = Math.max(...closedPeriods);
        return {
          ...session,
          closedPeriods,
          reviewPeriod: target,
          reviewMinute: session.periodMinutes[target] ?? REGULATION_MATCH_CLOCK.periodDurationMinutes,
          reviewStatus: "IN_REVIEW",
          reviewStartedAt: session.reviewStartedAt ?? Date.now(),
          lastError: null,
        };
      }),
    ),

  validateReview: (matchId) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) => {
        if (!session.matchFinished) {
          return { ...session, lastError: "Solo puede validarse un partido finalizado." };
        }
        return {
          ...session,
          reviewStatus: "VALIDATED",
          reviewRevision: (session.reviewRevision ?? 0) + 1,
          reviewValidatedAt: Date.now(),
          reviewPeriod: undefined,
          reviewMinute: undefined,
          lastError: null,
        };
      }),
    ),

  reopenReview: (matchId) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) => {
        if (!session.matchFinished || session.reviewStatus !== "VALIDATED") {
          return { ...session, lastError: "Solo puede reabrirse una revisión validada." };
        }
        return {
          ...session,
          reviewStatus: "IN_REVIEW",
          reviewRevision: (session.reviewRevision ?? 0) + 1,
          reviewReopenedAt: Date.now(),
          lastError: null,
        };
      }),
    ),

  setReviewMinute: (matchId, minute) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        session.reviewPeriod === undefined
          ? { ...session, lastError: "Entra primero en revisión de un periodo." }
          : {
              ...session,
              reviewMinute: normalizeMatchClock(session.reviewPeriod, minute).minute,
              lastError: null,
            },
      ),
    ),

  stopPeriodReview: (matchId) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) => ({
        ...session,
        reviewPeriod: undefined,
        reviewMinute: undefined,
        lastError: null,
      })),
    ),

  recordThreat: (matchId, input) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          assertSportsCaptureAllowed(session);
          const clock = captureClock(session);
          if (input.side === "FOR" && input.outcome === "GOL" && !input.assist) {
            throw new Error("Un gol CDA requiere decidir la asistencia.");
          }
          const order = getNextOrder(
            session.events,
            clock.period,
            clock.minute,
          );
          const defensive: DefensiveThreatDetailV2 | undefined =
            input.side === "AGAINST" && input.defensiveCapture
              ? {
                  version: 2,
                  goalTarget: input.defensiveCapture.goalTarget,
                  goalkeeper: goalkeeperAtPosition(
                    session.players,
                    session.events,
                    {
                      period: clock.period,
                      minute: clock.minute,
                      order: Math.max(0, order - 1),
                    },
                  ),
                  keeperBodyPart: input.defensiveCapture.keeperBodyPart,
                  saveOutcome: input.defensiveCapture.saveOutcome,
                }
              : undefined;
          const event = createLiveThreatEvent({
            id: input.id,
            matchId,
            position: {
              period: clock.period,
              minute: clock.minute,
              order,
            },
            side: input.side,
            playerId: input.playerId,
            origin: input.origin,
            outcome: input.outcome,
            phase: input.phase,
            sequenceId: input.sequenceId,
            parentEventId: input.parentEventId,
            restartEventId: input.restartEventId ?? pendingRestartId(session.events, input.side, input.phase),
            assist: input.assist,
            defensive,
            provenance: captureProvenance(session),
            observedAt: input.observedAt,
          });
          return appendEvent(session.players, session.events, event);
        }),
      ),
    ),

  toggleGameState: (matchId, stateKind, playerId, side = "FOR", observedAt) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          if (stateKind === "SUPERIORITY") {
            assertSportsCaptureAllowed(session);
          }
          const clock = captureClock(session);
          const replay = replayMatch(session.players, session.events, {
            throughClock: clock,
          });
          const active =
            stateKind === "SUPERIORITY"
              ? replay.superiorityActive
              : side === "AGAINST"
                ? replay.flyingGoalkeeperAgainstActive
                : replay.flyingGoalkeeperActive;
          if (
            stateKind === "FLYING_GOALKEEPER" &&
            side === "FOR" &&
            !active &&
            (!playerId || !replay.onCourtPlayerIds.includes(playerId))
          ) {
            throw new Error(
              "Selecciona qué jugador en pista asume la portería.",
            );
          }
          const event = createGameStateEvent({
            matchId,
            position: {
              period: clock.period,
              minute: clock.minute,
              order: getNextOrder(
                session.events,
                clock.period,
                clock.minute,
              ),
            },
            state: stateKind,
            active: !active,
            playerId:
              stateKind === "FLYING_GOALKEEPER" && side === "FOR" && !active
                ? playerId
                : undefined,
            side: stateKind === "FLYING_GOALKEEPER" ? side : undefined,
            provenance: captureProvenance(session),
            observedAt,
          });
          return appendEvent(session.players, session.events, event);
        }),
      ),
    ),

  recordRestart: (matchId, side, restart, spatialSide, observedAt) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          assertSportsCaptureAllowed(session);
          const clock = captureClock(session);
          return appendEvent(session.players, session.events, createRestartEvent({
            matchId,
            position: { ...clock, order: getNextOrder(session.events, clock.period, clock.minute) },
            side,
            restart,
            spatialSide,
            provenance: captureProvenance(session),
            observedAt,
          }));
        }),
      ),
    ),

  adjustFoulCount: (matchId, side, delta) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          assertSportsCaptureAllowed(session);
          const clock = captureClock(session);
          const current = replayMatch(session.players, session.events, { throughClock: clock }).disciplineByPeriod[clock.period];
          const count = side === "FOR" ? current?.for.fouls ?? 0 : current?.against.fouls ?? 0;
          if (delta < 0 && count === 0) throw new Error("El contador de faltas ya está en cero.");
          return appendEvent(session.players, session.events, createFoulCountAdjustmentEvent({
            matchId,
            position: { ...clock, order: getNextOrder(session.events, clock.period, clock.minute) },
            side,
            delta,
            provenance: captureProvenance(session),
          }));
        }),
      ),
    ),

  recordFoul: (matchId, side, playerId, origin, observedAt) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          assertSportsCaptureAllowed(session);
          const clock = captureClock(session);
          const event = createFoulEvent({
            matchId,
            position: {
              period: clock.period,
              minute: clock.minute,
              order: getNextOrder(
                session.events,
                clock.period,
                clock.minute,
              ),
            },
            side,
            playerId,
            origin,
            provenance: captureProvenance(session),
            observedAt,
          });
          return appendEvent(session.players, session.events, event);
        }),
      ),
    ),

  recordPossessionLost: (matchId, playerId, observedAt) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          assertSportsCaptureAllowed(session);
          const clock = captureClock(session);
          const replay = replayMatch(session.players, session.events, { throughClock: clock });
          if (!replay.onCourtPlayerIds.includes(playerId)) {
            throw new Error("La pérdida debe atribuirse a un jugador que está en pista.");
          }
          return appendEvent(session.players, session.events, createPossessionLostEvent({
            matchId,
            playerId,
            position: { ...clock, order: getNextOrder(session.events, clock.period, clock.minute) },
            provenance: captureProvenance(session),
            observedAt,
          }));
        }),
      ),
    ),

  recordCard: (
    matchId,
    side,
    color,
    playerId,
    causesInferiority = false,
    observedAt,
  ) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          assertSportsCaptureAllowed(session);
          const clock = captureClock(session);
          const order = getNextOrder(
            session.events,
            clock.period,
            clock.minute,
          );
          const card = createCardEvent({
            matchId,
            position: {
              period: clock.period,
              minute: clock.minute,
              order,
            },
            side,
            color,
            playerId,
            provenance: captureProvenance(session),
            observedAt,
          });

          if (!causesInferiority) {
            return appendEvent(session.players, session.events, card);
          }

          if (side !== "FOR" || color !== "RED") {
            throw new Error(
              "Solo una roja propia puede asociarse a una reducción del quinteto.",
            );
          }

          const replay = replayMatch(session.players, session.events, {
            throughClock: clock,
          });
          if (!playerId || !replay.onCourtPlayerIds.includes(playerId)) {
            throw new Error("Selecciona al jugador en pista que ha sido expulsado.");
          }
          if (replay.inferiorityActive) {
            throw new Error("La V1 local admite una única plaza INFERIORIDAD activa.");
          }
          const substitution = createSubstitutionEvent({
            matchId,
            position: {
              period: clock.period,
              minute: clock.minute,
              order: order + 1,
            },
            playerOutId: playerId,
            playerInId: INFERIORITY_SLOT_ID,
            relatedCardEventId: card.id,
            provenance: captureProvenance(session),
            observedAt,
          });
          return appendEvents(session.players, session.events, [
            card,
            substitution,
          ]);
        }),
      ),
    ),

  recordStaffCard: (matchId, staffId, color, observedAt) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          assertSportsCaptureAllowed(session);
          const clock = captureClock(session);
          if (!session.staff.some((member) => member.id === staffId)) {
            throw new Error("El miembro del cuerpo técnico no pertenece a la convocatoria.");
          }
          const card = createCardEvent({
            matchId,
            position: {
              period: clock.period,
              minute: clock.minute,
              order: getNextOrder(session.events, clock.period, clock.minute),
            },
            side: "FOR",
            color,
            staffId,
            provenance: captureProvenance(session),
            observedAt,
          });
          return appendEvent(session.players, session.events, card);
        }),
      ),
    ),

  setPendingReview: (matchId, eventId, pendingReview) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () =>
          editChronologyEvent(session.players, session.events, eventId, {
            pendingReview,
          }),
        ),
      ),
    ),

  swapPlayer: (matchId, playerOutId, playerInId, observedAt) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          const clock = captureClock(session);
          const event = createSubstitutionEvent({
            matchId,
            position: {
              period: clock.period,
              minute: clock.minute,
              order: getNextOrder(
                session.events,
                clock.period,
                clock.minute,
              ),
            },
            playerOutId,
            playerInId,
            provenance: captureProvenance(session),
            observedAt,
          });
          return appendEvent(session.players, session.events, event);
        }),
      ),
    ),

  editEvent: (matchId, eventId, changes) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () =>
          editChronologyEvent(
            session.players,
            session.events,
            eventId,
            changes,
          ),
        ),
      ),
    ),

  softDeleteEvent: (matchId, eventId) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () =>
          softDeleteChronologyEvent(session.players, session.events, eventId),
        ),
      ),
    ),

  restoreEvent: (matchId, eventId) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () =>
          restoreChronologyEvent(session.players, session.events, eventId),
        ),
      ),
    ),

  reorderEvent: (matchId, eventId, target) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          const clock = normalizeMatchClock(target.period, target.minute);
          return reorderChronologyEvent(
            session.players,
            session.events,
            eventId,
            { ...clock, order: Math.max(1, Math.trunc(target.order)) },
          );
        }),
      ),
    ),

  moveEventWithinMinute: (
    matchId,
    eventId,
    targetEventId,
    placement,
  ) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () =>
          moveChronologyEventWithinMinute(
            session.players,
            session.events,
            eventId,
            targetEventId,
            placement,
          ),
        ),
      ),
    ),

  editAndReorderEvent: (matchId, eventId, target, changes) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          const clock = normalizeMatchClock(target.period, target.minute);
          const reordered = reorderChronologyEvent(
            session.players,
            session.events,
            eventId,
            { ...clock, order: Math.max(1, Math.trunc(target.order)) },
          );
          return editChronologyEvent(
            session.players,
            reordered,
            eventId,
            changes,
          );
        }),
      ),
    ),

  undo: (matchId) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) => {
        const previous = session.past.at(-1);
        if (!previous) {
          return session;
        }
        return {
          ...session,
          events: previous,
          past: session.past.slice(0, -1),
          future: [session.events, ...session.future].slice(0, HISTORY_LIMIT),
          lastError: null,
        };
      }),
    ),

  redo: (matchId) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) => {
        const [next, ...remaining] = session.future;
        if (!next) {
          return session;
        }
        return {
          ...session,
          events: next,
          past: [...session.past, session.events].slice(-HISTORY_LIMIT),
          future: remaining,
          lastError: null,
        };
      }),
    ),

  clearError: (matchId) =>
    set((state) =>
      updateSession(state, matchId, (session) => ({
        ...session,
        lastError: null,
      })),
    ),

  setVideoSegments: (matchId, segments) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) => ({
        ...session,
        videoSegments: segments,
        lastError: null,
      })),
    ),

  setVideoEventOverrides: (matchId, overrides) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) => ({
        ...session,
        videoEventOverrides: overrides,
        lastError: null,
      })),
    ),

  resetDemo: (matchId) =>
    set((state) => {
      if (matchId !== CLEAN_GOAL_DEMO_MATCH_ID && matchId !== "prueba") return state;
      return {
        matches: {
          ...state.matches,
          [matchId]: persistSession(createSession(matchId)),
        },
      };
    }),
}));
