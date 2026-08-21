import assert from "node:assert/strict";
import test from "node:test";

import {
  appendEvent,
  createLineupInitializedEvent,
  createLiveThreatEvent,
  createSubstitutionEvent,
  editEvent,
  MatchIntegrityError,
  reorderEvent,
  replayMatch,
  restoreEvent,
  softDeleteEvent,
} from "./matchEngine";
import {
  loadMatchSession,
  LocalStorageAdapter,
  matchStorageKey,
  saveMatchSession,
} from "./matchPersistence";
import { DEMO_PLAYERS, useMatchStore } from "../store/useMatchStore";
import { MatchEvent, MatchSession, Player } from "../types";

const players: Player[] = DEMO_PLAYERS.map((player) => ({ ...player }));

function initialLineup(matchId = "match-a"): MatchEvent[] {
  return [
    createLineupInitializedEvent({
      id: `${matchId}-lineup`,
      matchId,
      position: { period: 1, minute: 0, order: 1 },
      squadPlayerIds: players.map((player) => player.id),
      onCourtPlayerIds: players.slice(0, 5).map((player) => player.id),
      now: 1,
    }),
  ];
}

class MemoryStorage implements LocalStorageAdapter {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test("replay reconstruye pista, banquillo y alineación de cada amenaza", () => {
  let events = initialLineup();
  events = appendEvent(
    players,
    events,
    createSubstitutionEvent({
      id: "sub-1",
      matchId: "match-a",
      position: { period: 1, minute: 5, order: 1 },
      playerOutId: "p1",
      playerInId: "p6",
      now: 2,
    }),
  );
  events = appendEvent(
    players,
    events,
    createLiveThreatEvent({
      id: "threat-1",
      matchId: "match-a",
      position: { period: 1, minute: 5, order: 2 },
      side: "FOR",
      playerId: "p6",
      origin: { x: 0.42, y: 0.71 },
      outcome: "GOL",
      phase: "POSITIONAL",
      now: 3,
    }),
  );

  const result = replayMatch(players, events);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.onCourtPlayerIds, ["p6", "p2", "p3", "p4", "p5"]);
  assert.ok(result.benchPlayerIds.includes("p1"));
  assert.equal(result.onCourtPlayerIds.length, 5);
  assert.deepEqual(
    result.onCourtPlayerIds.filter((id) => result.benchPlayerIds.includes(id)),
    [],
  );
  const threat = result.timeline.find((entry) => entry.event.id === "threat-1");
  assert.ok(threat);
  assert.deepEqual(threat.lineupPlayerIds, ["p6", "p2", "p3", "p4", "p5"]);
});

test("una sustitución inválida se rechaza de forma atómica", () => {
  const events = initialLineup();
  const invalid = createSubstitutionEvent({
    id: "sub-invalid",
    matchId: "match-a",
    position: { period: 1, minute: 3, order: 1 },
    playerOutId: "p6",
    playerInId: "p7",
    now: 2,
  });

  assert.throws(
    () => appendEvent(players, events, invalid),
    (error) =>
      error instanceof MatchIntegrityError &&
      error.issues.some((issue) => issue.code === "PLAYER_NOT_ON_COURT"),
  );
  assert.equal(events.length, 1);
});

test("la integridad impide más de cinco plazas y jugadores duplicados", () => {
  const tooMany = [
    createLineupInitializedEvent({
      id: "bad-lineup",
      matchId: "match-a",
      position: { period: 1, minute: 0, order: 1 },
      squadPlayerIds: players.map((player) => player.id),
      onCourtPlayerIds: ["p1", "p2", "p3", "p4", "p5", "p5"],
      now: 1,
    }),
  ];
  const result = replayMatch(players, tooMany);
  assert.ok(result.issues.some((issue) => issue.code === "TOO_MANY_ON_COURT"));
  assert.ok(result.issues.some((issue) => issue.code === "DUPLICATE_PLAYER"));
});

test("el orden es inequívoco dentro de periodo y minuto", () => {
  const events = initialLineup();
  const first = createLiveThreatEvent({
    id: "threat-1",
    matchId: "match-a",
    position: { period: 1, minute: 6, order: 1 },
    side: "AGAINST",
    origin: { x: 0.5, y: 0.5 },
    outcome: "PARADA",
    phase: "TRANSITION",
    now: 2,
  });
  const second = createLiveThreatEvent({
    id: "threat-2",
    matchId: "match-a",
    position: { period: 1, minute: 6, order: 1 },
    side: "AGAINST",
    origin: { x: 0.7, y: 0.4 },
    outcome: "FUERA",
    phase: "POSITIONAL",
    now: 3,
  });

  const result = replayMatch(players, [...events, first, second]);
  assert.ok(result.issues.some((issue) => issue.code === "DUPLICATE_ORDER"));
});

test("reordenar eventos recalcula la alineación desde el nuevo orden", () => {
  let events = initialLineup();
  events = appendEvent(
    players,
    events,
    createSubstitutionEvent({
      id: "sub-1",
      matchId: "match-a",
      position: { period: 1, minute: 8, order: 1 },
      playerOutId: "p1",
      playerInId: "p6",
      now: 2,
    }),
  );
  events = appendEvent(
    players,
    events,
    createLiveThreatEvent({
      id: "threat-against",
      matchId: "match-a",
      position: { period: 1, minute: 8, order: 2 },
      side: "AGAINST",
      origin: { x: 0.8, y: 0.5 },
      outcome: "PARADA",
      phase: "TRANSITION",
      now: 3,
    }),
  );

  const reordered = reorderEvent(
    players,
    events,
    "sub-1",
    { period: 1, minute: 8, order: 2 },
    4,
  );
  const result = replayMatch(players, reordered);
  const threat = result.timeline.find((entry) => entry.event.id === "threat-against");
  assert.ok(threat);
  assert.deepEqual(threat.lineupPlayerIds, ["p1", "p2", "p3", "p4", "p5"]);
  assert.deepEqual(result.onCourtPlayerIds, ["p6", "p2", "p3", "p4", "p5"]);
});

test("edición, soft delete y restauración conservan una cronología válida", () => {
  let events = initialLineup();
  events = appendEvent(
    players,
    events,
    createLiveThreatEvent({
      id: "threat-1",
      matchId: "match-a",
      position: { period: 1, minute: 4, order: 1 },
      side: "FOR",
      playerId: "p1",
      origin: { x: 0.2, y: 0.3 },
      outcome: "FUERA",
      phase: "POSITIONAL",
      now: 2,
    }),
  );
  events = editEvent(
    players,
    events,
    "threat-1",
    { threat: { outcome: "GOL", origin: { x: 0.25, y: 0.35 } } },
    3,
  );
  const edited = events.find((event) => event.id === "threat-1");
  assert.equal(edited?.type === "threat_recorded" && edited.outcome, "GOL");

  events = softDeleteEvent(players, events, "threat-1", 4);
  assert.equal(replayMatch(players, events).timeline.length, 1);
  events = restoreEvent(players, events, "threat-1", 5);
  assert.equal(replayMatch(players, events).timeline.length, 2);
});

test("BLOQUEADO no puede introducirse en un evento de captura V1", () => {
  let events = initialLineup();
  events = appendEvent(
    players,
    events,
    createLiveThreatEvent({
      id: "threat-1",
      matchId: "match-a",
      position: { period: 1, minute: 2, order: 1 },
      side: "FOR",
      playerId: "p1",
      origin: { x: 0.5, y: 0.5 },
      outcome: "PARADA",
      phase: "SET_PIECE_FREE_KICK",
      now: 2,
    }),
  );
  assert.throws(
    () =>
      editEvent(
        players,
        events,
        "threat-1",
        { threat: { outcome: "BLOQUEADO" } },
        3,
      ),
    /solo está permitido en eventos importados/,
  );
});

test("UNSPECIFIED queda reservado a eventos importados", () => {
  assert.throws(
    () =>
      createLiveThreatEvent({
        id: "threat-unspecified",
        matchId: "match-a",
        position: { period: 1, minute: 2, order: 1 },
        side: "FOR",
        playerId: "p1",
        origin: { x: 0.5, y: 0.5 },
        outcome: "GOL",
        phase: "UNSPECIFIED" as never,
        now: 2,
      }),
    /requiere una fase válida/,
  );
});

test("replay calcula tramo activo y total acumulado tras varias sustituciones", () => {
  let events = initialLineup();
  events = appendEvent(
    players,
    events,
    createSubstitutionEvent({
      id: "sub-out",
      matchId: "match-a",
      position: { period: 1, minute: 5, order: 1 },
      playerOutId: "p1",
      playerInId: "p6",
      now: 2,
    }),
  );
  events = appendEvent(
    players,
    events,
    createSubstitutionEvent({
      id: "sub-back",
      matchId: "match-a",
      position: { period: 1, minute: 10, order: 1 },
      playerOutId: "p6",
      playerInId: "p1",
      now: 3,
    }),
  );

  const result = replayMatch(players, events, {
    currentClock: { period: 1, minute: 12 },
  });

  assert.deepEqual(result.playerMinutes.p1, {
    totalMinutes: 6,
    currentStintMinutes: 2,
    onCourt: true,
  });
  assert.deepEqual(result.playerMinutes.p6, {
    totalMinutes: 5,
    currentStintMinutes: 0,
    onCourt: false,
  });
  assert.equal(result.playerMinutes.p2.totalMinutes, 11);
  assert.equal(result.playerMinutes.p2.currentStintMinutes, 11);
});

test("el minuto oficial inicial muestra cero y una entrada en 5 suma tres en 8", () => {
  let events = initialLineup();
  const initial = replayMatch(players, events, {
    currentClock: { period: 1, minute: 1 },
  });
  assert.equal(initial.playerMinutes.p1.totalMinutes, 0);
  assert.equal(initial.playerMinutes.p1.currentStintMinutes, 0);

  events = appendEvent(
    players,
    events,
    createSubstitutionEvent({
      id: "sub-at-five",
      matchId: "match-a",
      position: { period: 1, minute: 5, order: 1 },
      playerOutId: "p1",
      playerInId: "p6",
      now: 2,
    }),
  );
  const atEight = replayMatch(players, events, {
    currentClock: { period: 1, minute: 8 },
  });
  assert.equal(atEight.playerMinutes.p6.currentStintMinutes, 3);
  assert.equal(atEight.playerMinutes.p6.totalMinutes, 3);
  assert.equal(atEight.playerMinutes.p1.totalMinutes, 4);
});

test("persistencia local conserva sesión e historial y aísla cada matchId", () => {
  const storage = new MemoryStorage();
  const eventsA = initialLineup("match-a");
  const sessionA: MatchSession = {
    matchId: "match-a",
    players,
    period: 1,
    minute: 8,
    events: eventsA,
    past: [eventsA],
    future: [],
    lastError: null,
    persistenceStatus: "idle",
    lastSavedAt: null,
  };
  const sessionB: MatchSession = {
    ...sessionA,
    matchId: "match-b",
    minute: 3,
    events: initialLineup("match-b"),
    past: [],
  };

  assert.equal(saveMatchSession(sessionA, storage, 100).ok, true);
  assert.equal(saveMatchSession(sessionB, storage, 200).ok, true);
  assert.notEqual(matchStorageKey("match-a"), matchStorageKey("match-b"));

  const restoredA = loadMatchSession("match-a", storage);
  const restoredB = loadMatchSession("match-b", storage);
  assert.equal(restoredA?.minute, 8);
  assert.equal(restoredA?.events[0].matchId, "match-a");
  assert.equal(restoredA?.past.length, 1);
  assert.equal(restoredA?.lastSavedAt, 100);
  assert.equal(restoredB?.minute, 3);
  assert.equal(restoredB?.events[0].matchId, "match-b");
});

test("Zustand aísla partidos y soporta undo/redo", () => {
  useMatchStore.setState({ matches: {} });
  const actions = useMatchStore.getState();
  actions.ensureMatch("match-a");
  actions.ensureMatch("match-b");
  useMatchStore.getState().recordThreat("match-a", {
    playerId: "p1",
    origin: { x: 0.4, y: 0.6 },
    outcome: "GOL",
    phase: "POSITIONAL",
  });

  let state = useMatchStore.getState();
  assert.equal(state.matches["match-a"].events.length, 2);
  assert.equal(state.matches["match-b"].events.length, 1);

  state.undo("match-a");
  state = useMatchStore.getState();
  assert.equal(state.matches["match-a"].events.length, 1);
  assert.equal(state.matches["match-b"].events.length, 1);

  state.redo("match-a");
  state = useMatchStore.getState();
  assert.equal(state.matches["match-a"].events.length, 2);
});
