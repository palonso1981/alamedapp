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
  editEvent as editChronologyEvent,
  EventEditChanges,
  getNextOrder,
  moveEventWithinMinute as moveChronologyEventWithinMinute,
  normalizeMatchClock,
  replayMatch,
  reorderEvent as reorderChronologyEvent,
  restoreEvent as restoreChronologyEvent,
  SameMinutePlacement,
  softDeleteEvent as softDeleteChronologyEvent,
} from "../lib/matchEngine";
import { loadMatchSession, saveMatchSession } from "../lib/matchPersistence";
import {
  CardColor,
  DisciplineSide,
  EventPosition,
  GameStateKind,
  GoalAssist,
  INFERIORITY_SLOT_ID,
  LiveThreatPhase,
  LiveThreatOutcome,
  MatchEvent,
  MatchSession,
  NormalizedCoordinates,
  Player,
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

interface RecordThreatInput {
  side: DisciplineSide;
  playerId?: string;
  origin: NormalizedCoordinates;
  outcome: LiveThreatOutcome;
  phase: LiveThreatPhase;
  sequenceId?: string;
  parentEventId?: string;
  assist?: GoalAssist;
}

interface MatchState {
  matches: Record<string, MatchSession>;
  ensureMatch: (matchId: string) => void;
  incrementMinute: (matchId: string) => void;
  decrementMinute: (matchId: string) => void;
  setClock: (matchId: string, period: number, minute: number) => void;
  changePeriod: (matchId: string, period: number) => void;
  recordThreat: (matchId: string, input: RecordThreatInput) => void;
  toggleGameState: (matchId: string, state: GameStateKind) => void;
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
}

function createSession(matchId: string): MatchSession {
  const players = DEMO_PLAYERS.map((player) => ({ ...player }));
  const staff = DEMO_STAFF.map((member) => ({ ...member }));
  const lineup = createLineupInitializedEvent({
    matchId,
    position: { period: 1, minute: 0, order: 1 },
    squadPlayerIds: players.map((player) => player.id),
    onCourtPlayerIds: players.slice(0, 5).map((player) => player.id),
  });
  return {
    matchId,
    players,
    staff,
    period: 1,
    minute: 1,
    periodMinutes: { 1: 1, 2: 0 },
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

export const useMatchStore = create<MatchState>((set) => ({
  matches: {},

  ensureMatch: (matchId) =>
    set((state) => {
      if (state.matches[matchId]) {
        return state;
      }
      const loaded = loadMatchSession(matchId);
      const session = loaded
        ? loaded.staff.length > 0
          ? loaded
          : persistSession({
              ...loaded,
              staff: DEMO_STAFF.map((member) => ({ ...member })),
            })
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

  recordThreat: (matchId, input) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          if (input.side === "FOR" && input.outcome === "GOL" && !input.assist) {
            throw new Error("Un gol CDA requiere decidir la asistencia.");
          }
          const event = createLiveThreatEvent({
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
            side: input.side,
            playerId: input.playerId,
            origin: input.origin,
            outcome: input.outcome,
            phase: input.phase,
            sequenceId: input.sequenceId,
            parentEventId: input.parentEventId,
            assist: input.assist,
          });
          return appendEvent(session.players, session.events, event);
        }),
      ),
    ),

  toggleGameState: (matchId, stateKind) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
          const replay = replayMatch(session.players, session.events, {
            throughClock: { period: session.period, minute: session.minute },
          });
          const active =
            stateKind === "SUPERIORITY"
              ? replay.superiorityActive
              : replay.flyingGoalkeeperActive;
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
          });
          return appendEvent(session.players, session.events, event);
        }),
      ),
    ),

  recordFoul: (matchId, side, playerId, origin) =>
    set((state) =>
      updateAndPersistSession(state, matchId, (session) =>
        command(session, () => {
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
}));
