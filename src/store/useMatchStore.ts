import { create } from "zustand";

import {
  appendEvent,
  appendEvents,
  createCardEvent,
  createFoulEvent,
  createGameStateEvent,
  createLineupInitializedEvent,
  createLiveThreatEvent,
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
import { loadMatchSession, saveMatchSession } from "../lib/matchPersistence";
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
  NormalizedCoordinates,
  Player,
  KeeperBodyPart,
  SaveOutcome,
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
  assist?: GoalAssist;
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
  startSecondPeriod: (matchId: string) => void;
  recordThreat: (matchId: string, input: RecordThreatInput) => void;
  toggleGameState: (
    matchId: string,
    state: GameStateKind,
    playerId?: string,
  ) => void;
  recordFoul: (
    matchId: string,
    side: DisciplineSide,
    playerId: string,
    origin?: NormalizedCoordinates,
  ) => void;
  recordCard: (
    matchId: string,
    side: DisciplineSide,
    color: CardColor,
    playerId?: string,
    causesInferiority?: boolean,
  ) => void;
  recordStaffCard: (
    matchId: string,
    staffId: string,
    color: CardColor,
  ) => void;
  setPendingReview: (
    matchId: string,
    eventId: string,
    pendingReview: boolean,
  ) => void;
  swapPlayer: (matchId: string, playerOutId: string, playerInId: string) => void;
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
}

export function createSession(matchId: string): MatchSession {
  const players = demoPlayersForMatch(matchId).map((player) => ({ ...player }));
  const staff = DEMO_STAFF.map((member) => ({ ...member }));
  const lineup = createLineupInitializedEvent({
    matchId,
    position: { period: 1, minute: 0, order: 1 },
    squadPlayerIds: players.map((player) => player.id),
    onCourtPlayerIds: players.slice(0, 5).map((player) => player.id),
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
  const result = saveMatchSession(session);
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

function assertSportsCaptureAllowed(session: MatchSession): void {
  assertPeriodOpen(session);
  const validation = replayMatch(session.players, session.events, {
    throughClock: { period: session.period, minute: session.minute },
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
      const loaded = loadMatchSession(matchId);
      const session = loaded
        ? persistSession(upgradeDemoSession(loaded))
        : persistSession(createSession(matchId));
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
        return withClock(
          session,
          targetPeriod,
          session.periodMinutes[targetPeriod] ?? 0,
        );
      }),
    ),

  finishCurrentPeriod: (matchId) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) => {
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
          matchFinished:
            finishedClock.period === REGULATION_MATCH_CLOCK.regulationPeriods,
          lastError: null,
        };
      }),
    ),

  startSecondPeriod: (matchId) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) => {
        if (!session.closedPeriods?.includes(1) || session.matchFinished) {
          return {
            ...session,
            lastError: "Finaliza P1 antes de iniciar la segunda parte.",
          };
        }
        return withClock(
          { ...session, lastError: null },
          2,
          session.periodMinutes[2] ?? 0,
        );
      }),
    ),

  recordThreat: (matchId, input) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          assertSportsCaptureAllowed(session);
          if (input.side === "FOR" && input.outcome === "GOL" && !input.assist) {
            throw new Error("Un gol CDA requiere decidir la asistencia.");
          }
          const order = getNextOrder(
            session.events,
            session.period,
            session.minute,
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
                      period: session.period,
                      minute: session.minute,
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
              period: session.period,
              minute: session.minute,
              order,
            },
            side: input.side,
            playerId: input.playerId,
            origin: input.origin,
            outcome: input.outcome,
            phase: input.phase,
            sequenceId: input.sequenceId,
            parentEventId: input.parentEventId,
            assist: input.assist,
            defensive,
          });
          return appendEvent(session.players, session.events, event);
        }),
      ),
    ),

  toggleGameState: (matchId, stateKind, playerId) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          if (stateKind === "SUPERIORITY") {
            assertSportsCaptureAllowed(session);
          }
          const replay = replayMatch(session.players, session.events, {
            throughClock: { period: session.period, minute: session.minute },
          });
          const active =
            stateKind === "SUPERIORITY"
              ? replay.superiorityActive
              : replay.flyingGoalkeeperActive;
          if (
            stateKind === "FLYING_GOALKEEPER" &&
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
              period: session.period,
              minute: session.minute,
              order: getNextOrder(
                session.events,
                session.period,
                session.minute,
              ),
            },
            state: stateKind,
            active: !active,
            playerId:
              stateKind === "FLYING_GOALKEEPER" && !active
                ? playerId
                : undefined,
          });
          return appendEvent(session.players, session.events, event);
        }),
      ),
    ),

  recordFoul: (matchId, side, playerId, origin) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          assertSportsCaptureAllowed(session);
          const event = createFoulEvent({
            matchId,
            position: {
              period: session.period,
              minute: session.minute,
              order: getNextOrder(
                session.events,
                session.period,
                session.minute,
              ),
            },
            side,
            playerId,
            origin,
          });
          return appendEvent(session.players, session.events, event);
        }),
      ),
    ),

  recordCard: (
    matchId,
    side,
    color,
    playerId,
    causesInferiority = false,
  ) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          assertSportsCaptureAllowed(session);
          const order = getNextOrder(
            session.events,
            session.period,
            session.minute,
          );
          const card = createCardEvent({
            matchId,
            position: {
              period: session.period,
              minute: session.minute,
              order,
            },
            side,
            color,
            playerId,
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
            throughClock: { period: session.period, minute: session.minute },
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
              period: session.period,
              minute: session.minute,
              order: order + 1,
            },
            playerOutId: playerId,
            playerInId: INFERIORITY_SLOT_ID,
            relatedCardEventId: card.id,
          });
          return appendEvents(session.players, session.events, [
            card,
            substitution,
          ]);
        }),
      ),
    ),

  recordStaffCard: (matchId, staffId, color) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          assertSportsCaptureAllowed(session);
          if (!session.staff.some((member) => member.id === staffId)) {
            throw new Error("El miembro del cuerpo técnico no pertenece a la convocatoria.");
          }
          const card = createCardEvent({
            matchId,
            position: {
              period: session.period,
              minute: session.minute,
              order: getNextOrder(session.events, session.period, session.minute),
            },
            side: "FOR",
            color,
            staffId,
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

  swapPlayer: (matchId, playerOutId, playerInId) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          assertPeriodOpen(session);
          const event = createSubstitutionEvent({
            matchId,
            position: {
              period: session.period,
              minute: session.minute,
              order: getNextOrder(
                session.events,
                session.period,
                session.minute,
              ),
            },
            playerOutId,
            playerInId,
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
