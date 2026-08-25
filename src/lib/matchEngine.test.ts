import assert from "node:assert/strict";
import test from "node:test";

import {
  appendEvent,
  appendEvents,
  createCardEvent,
  createFoulEvent,
  createGameStateEvent,
  createLineupInitializedEvent,
  createLiveThreatEvent,
  createSubstitutionEvent,
  deriveGlobalMinute,
  editEvent,
  MatchIntegrityError,
  moveEventWithinMinute,
  normalizeMatchClock,
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
import {
  INFERIORITY_SLOT_ID,
  MatchEvent,
  MatchSession,
  Player,
} from "../types";

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

test("replay puede reconstruir la alineación en un minuto anterior", () => {
  let events = initialLineup();
  events = appendEvent(
    players,
    events,
    createSubstitutionEvent({
      id: "future-substitution",
      matchId: "match-a",
      position: { period: 1, minute: 8, order: 1 },
      playerOutId: "p1",
      playerInId: "p6",
      now: 2,
    }),
  );

  const atFive = replayMatch(players, events, {
    currentClock: { period: 1, minute: 5 },
    throughClock: { period: 1, minute: 5 },
  });
  assert.ok(atFive.onCourtPlayerIds.includes("p1"));
  assert.ok(!atFive.onCourtPlayerIds.includes("p6"));
  assert.equal(atFive.timeline.length, 1);

  const complete = replayMatch(players, events);
  assert.ok(complete.onCourtPlayerIds.includes("p6"));
  assert.equal(complete.timeline.length, 2);
});

test("el marcador se deriva y recalcula al editar, eliminar, restaurar y reordenar", () => {
  let events = initialLineup();
  const ownGoal = createLiveThreatEvent({
    id: "own-goal",
    matchId: "match-a",
    position: { period: 1, minute: 3, order: 1 },
    side: "FOR",
    playerId: "p1",
    origin: { x: 0.7, y: 0.4 },
    outcome: "GOL",
    phase: "POSITIONAL",
    now: 2,
  });
  const rivalGoal = createLiveThreatEvent({
    id: "rival-goal",
    matchId: "match-a",
    position: { period: 1, minute: 4, order: 1 },
    side: "AGAINST",
    origin: { x: 0.2, y: 0.6 },
    outcome: "GOL",
    phase: "TRANSITION",
    now: 3,
  });
  events = appendEvents(players, events, [ownGoal, rivalGoal]);
  assert.deepEqual(replayMatch(players, events).score, { for: 1, against: 1 });

  events = editEvent(
    players,
    events,
    "own-goal",
    { threat: { outcome: "PARADA" } },
    4,
  );
  assert.deepEqual(replayMatch(players, events).score, { for: 0, against: 1 });

  events = softDeleteEvent(players, events, "rival-goal", 5);
  assert.deepEqual(replayMatch(players, events).score, { for: 0, against: 0 });
  events = restoreEvent(players, events, "rival-goal", 6);
  assert.deepEqual(replayMatch(players, events).score, { for: 0, against: 1 });

  events = reorderEvent(
    players,
    events,
    "rival-goal",
    { period: 1, minute: 2, order: 1 },
    7,
  );
  assert.deepEqual(replayMatch(players, events).score, { for: 0, against: 1 });
});

test("superioridad y portero-jugador se heredan y cambian al reordenar", () => {
  let events = initialLineup();
  events = appendEvents(players, events, [
    createGameStateEvent({
      id: "superiority-on",
      matchId: "match-a",
      position: { period: 1, minute: 2, order: 1 },
      state: "SUPERIORITY",
      active: true,
      now: 2,
    }),
    createGameStateEvent({
      id: "flying-on",
      matchId: "match-a",
      position: { period: 1, minute: 2, order: 2 },
      state: "FLYING_GOALKEEPER",
      active: true,
      now: 3,
    }),
    createLiveThreatEvent({
      id: "context-threat",
      matchId: "match-a",
      position: { period: 1, minute: 3, order: 1 },
      side: "FOR",
      playerId: "p1",
      origin: { x: 0.8, y: 0.5 },
      outcome: "FUERA",
      phase: "FLYING_GOALKEEPER",
      now: 4,
    }),
    createGameStateEvent({
      id: "superiority-off",
      matchId: "match-a",
      position: { period: 1, minute: 4, order: 1 },
      state: "SUPERIORITY",
      active: false,
      now: 5,
    }),
  ]);

  let replay = replayMatch(players, events);
  let threat = replay.timeline.find(
    (entry) => entry.event.id === "context-threat",
  );
  assert.ok(threat?.gameContexts.includes("SUPERIORITY"));
  assert.ok(threat?.gameContexts.includes("FLYING_GOALKEEPER"));
  assert.equal(replay.superiorityActive, false);
  assert.equal(replay.flyingGoalkeeperActive, true);

  events = reorderEvent(
    players,
    events,
    "superiority-off",
    { period: 1, minute: 2, order: 3 },
    6,
  );
  replay = replayMatch(players, events);
  threat = replay.timeline.find((entry) => entry.event.id === "context-threat");
  assert.ok(!threat?.gameContexts.includes("SUPERIORITY"));
  assert.ok(threat?.gameContexts.includes("FLYING_GOALKEEPER"));
});

test("expulsión propia usa INFERIORIDAD sin identidad ni minutos individuales", () => {
  let events = initialLineup();
  events = appendEvents(players, events, [
    createCardEvent({
      id: "red-p1",
      matchId: "match-a",
      position: { period: 1, minute: 5, order: 1 },
      side: "FOR",
      color: "RED",
      playerId: "p1",
      now: 2,
    }),
    createSubstitutionEvent({
      id: "inferiority-in",
      matchId: "match-a",
      position: { period: 1, minute: 5, order: 2 },
      playerOutId: "p1",
      playerInId: INFERIORITY_SLOT_ID,
      now: 3,
    }),
    createLiveThreatEvent({
      id: "goal-against-inferiority",
      matchId: "match-a",
      position: { period: 1, minute: 6, order: 1 },
      side: "AGAINST",
      origin: { x: 0.3, y: 0.5 },
      outcome: "GOL",
      phase: "POSITIONAL",
      now: 4,
    }),
  ]);

  let replay = replayMatch(players, events, {
    currentClock: { period: 1, minute: 7 },
  });
  assert.equal(replay.inferiorityActive, true);
  assert.equal(replay.onCourtPlayerIds.length, 5);
  assert.ok(replay.onCourtPlayerIds.includes(INFERIORITY_SLOT_ID));
  assert.ok(replay.benchPlayerIds.includes("p1"));
  assert.ok(replay.dismissedPlayerIds.includes("p1"));
  assert.equal(replay.playerMinutes.p1.totalMinutes, 4);
  assert.equal(replay.playerMinutes[INFERIORITY_SLOT_ID], undefined);
  assert.deepEqual(replay.score, { for: 0, against: 1 });
  const threat = replay.timeline.find(
    (entry) => entry.event.id === "goal-against-inferiority",
  );
  assert.ok(threat?.gameContexts.includes("INFERIORITY"));

  events = appendEvent(
    players,
    events,
    createSubstitutionEvent({
      id: "inferiority-out",
      matchId: "match-a",
      position: { period: 1, minute: 7, order: 1 },
      playerOutId: INFERIORITY_SLOT_ID,
      playerInId: "p6",
      now: 5,
    }),
  );
  replay = replayMatch(players, events, {
    currentClock: { period: 1, minute: 8 },
  });
  assert.equal(replay.inferiorityActive, false);
  assert.ok(replay.onCourtPlayerIds.includes("p6"));
  assert.equal(replay.playerMinutes.p6.totalMinutes, 1);
});

test("faltas y tarjetas se recalculan al editar y eliminar", () => {
  let events = initialLineup();
  events = appendEvents(players, events, [
    createFoulEvent({
      id: "foul-for",
      matchId: "match-a",
      position: { period: 1, minute: 2, order: 1 },
      side: "FOR",
      playerId: "p1",
      now: 2,
    }),
    createFoulEvent({
      id: "foul-against",
      matchId: "match-a",
      position: { period: 1, minute: 2, order: 2 },
      side: "AGAINST",
      playerId: "p2",
      now: 3,
    }),
    createCardEvent({
      id: "yellow-p2",
      matchId: "match-a",
      position: { period: 1, minute: 3, order: 1 },
      side: "FOR",
      color: "YELLOW",
      playerId: "p2",
      now: 4,
    }),
    createCardEvent({
      id: "rival-red",
      matchId: "match-a",
      position: { period: 1, minute: 3, order: 2 },
      side: "AGAINST",
      color: "RED",
      now: 5,
    }),
  ]);
  let replay = replayMatch(players, events);
  assert.deepEqual(replay.discipline, {
    for: { fouls: 1, yellowCards: 1, redCards: 0 },
    against: { fouls: 1, yellowCards: 0, redCards: 1 },
  });

  events = editEvent(
    players,
    events,
    "rival-red",
    { card: { color: "YELLOW" } },
    6,
  );
  events = softDeleteEvent(players, events, "foul-for", 7);
  replay = replayMatch(players, events);
  assert.deepEqual(replay.discipline, {
    for: { fouls: 0, yellowCards: 1, redCards: 0 },
    against: { fouls: 1, yellowCards: 1, redCards: 0 },
  });
});

test("faltas guardan jugador y numeración por periodo derivada del orden", () => {
  let events = initialLineup();
  events = appendEvents(players, events, [
    createFoulEvent({
      id: "foul-1",
      matchId: "match-a",
      position: { period: 1, minute: 5, order: 1 },
      side: "FOR",
      playerId: "p1",
      now: 2,
    }),
    createFoulEvent({
      id: "foul-2",
      matchId: "match-a",
      position: { period: 1, minute: 5, order: 2 },
      side: "FOR",
      playerId: "p2",
      now: 3,
    }),
    createFoulEvent({
      id: "foul-3",
      matchId: "match-a",
      position: { period: 1, minute: 5, order: 3 },
      side: "FOR",
      playerId: "p3",
      now: 4,
    }),
    createFoulEvent({
      id: "foul-period-2",
      matchId: "match-a",
      position: { period: 2, minute: 1, order: 1 },
      side: "FOR",
      playerId: "p4",
      now: 5,
    }),
  ]);

  let replay = replayMatch(players, events);
  assert.deepEqual(
    replay.timeline
      .flatMap((entry) =>
        entry.event.type === "foul_recorded"
          ? [[entry.event.id, entry.event.playerId, entry.periodFoulNumber]]
          : [],
      ),
    [
      ["foul-1", "p1", 1],
      ["foul-2", "p2", 2],
      ["foul-3", "p3", 3],
      ["foul-period-2", "p4", 1],
    ],
  );
  assert.equal(replay.disciplineByPeriod[1].for.fouls, 3);
  assert.equal(replay.disciplineByPeriod[2].for.fouls, 1);

  events = moveEventWithinMinute(
    players,
    events,
    "foul-3",
    "foul-1",
    "BEFORE",
    6,
  );
  replay = replayMatch(players, events);
  assert.deepEqual(
    replay.timeline
      .filter(
        (entry) =>
          entry.event.type === "foul_recorded" && entry.event.period === 1,
      )
      .map((entry) => [entry.event.id, entry.periodFoulNumber]),
    [
      ["foul-3", 1],
      ["foul-1", 2],
      ["foul-2", 3],
    ],
  );

  events = editEvent(
    players,
    events,
    "foul-1",
    { foul: { playerId: "p5" } },
    7,
  );
  events = softDeleteEvent(players, events, "foul-3", 8);
  replay = replayMatch(players, events);
  assert.deepEqual(
    replay.timeline.flatMap((entry) =>
      entry.event.type === "foul_recorded" && entry.event.period === 1
        ? [[entry.event.id, entry.event.playerId, entry.periodFoulNumber]]
        : [],
    ),
    [
      ["foul-1", "p5", 1],
      ["foul-2", "p2", 2],
    ],
  );

  events = restoreEvent(players, events, "foul-3", 9);
  events = reorderEvent(
    players,
    events,
    "foul-1",
    { period: 2, minute: 1, order: 2 },
    10,
  );
  replay = replayMatch(players, events);
  assert.equal(replay.disciplineByPeriod[1].for.fouls, 2);
  assert.equal(replay.disciplineByPeriod[2].for.fouls, 2);
});

test("una roja no altera la alineación salvo que exista sustitución a inferioridad", () => {
  let events = initialLineup();
  events = appendEvents(players, events, [
    createCardEvent({
      id: "bench-red",
      matchId: "match-a",
      position: { period: 1, minute: 2, order: 1 },
      side: "FOR",
      color: "RED",
      playerId: "p6",
      now: 2,
    }),
    createCardEvent({
      id: "court-red-only",
      matchId: "match-a",
      position: { period: 1, minute: 3, order: 1 },
      side: "FOR",
      color: "RED",
      playerId: "p1",
      now: 3,
    }),
  ]);

  let replay = replayMatch(players, events);
  assert.equal(replay.inferiorityActive, false);
  assert.deepEqual(replay.onCourtPlayerIds, ["p1", "p2", "p3", "p4", "p5"]);
  assert.ok(replay.benchPlayerIds.includes("p6"));
  assert.equal(replay.discipline.for.redCards, 2);

  events = appendEvents(players, events, [
    createCardEvent({
      id: "court-red-with-reduction",
      matchId: "match-a",
      position: { period: 1, minute: 4, order: 1 },
      side: "FOR",
      color: "RED",
      playerId: "p2",
      now: 4,
    }),
    createSubstitutionEvent({
      id: "red-reduction",
      matchId: "match-a",
      position: { period: 1, minute: 4, order: 2 },
      playerOutId: "p2",
      playerInId: INFERIORITY_SLOT_ID,
      now: 5,
    }),
  ]);
  replay = replayMatch(players, events);
  assert.equal(replay.inferiorityActive, true);
  assert.ok(replay.onCourtPlayerIds.includes(INFERIORITY_SLOT_ID));
  assert.ok(replay.benchPlayerIds.includes("p2"));
  assert.equal(replay.discipline.for.redCards, 3);
});

test("las amenazas preparan secuencias causales sin convertir la continuación en fase", () => {
  let events = initialLineup();
  const root = createLiveThreatEvent({
    id: "sequence-root",
    matchId: "match-a",
    position: { period: 1, minute: 6, order: 1 },
    side: "FOR",
    playerId: "p1",
    origin: { x: 0.7, y: 0.4 },
    outcome: "PARADA",
    phase: "POSITIONAL",
    now: 2,
  });
  const continuation = createLiveThreatEvent({
    id: "sequence-child",
    matchId: "match-a",
    position: { period: 1, minute: 6, order: 2 },
    side: "FOR",
    playerId: "p2",
    origin: { x: 0.8, y: 0.5 },
    outcome: "FUERA",
    phase: "POSITIONAL",
    sequenceId: root.sequenceId,
    parentEventId: root.id,
    now: 3,
  });
  events = appendEvents(players, events, [root, continuation]);
  assert.equal(continuation.sequenceId, root.id);
  assert.equal(continuation.parentEventId, root.id);
  assert.equal(replayMatch(players, events).issues.length, 0);

  const invalidContinuation = createLiveThreatEvent({
    id: "invalid-sequence-child",
    matchId: "match-a",
    position: { period: 1, minute: 6, order: 3 },
    side: "FOR",
    playerId: "p3",
    origin: { x: 0.75, y: 0.5 },
    outcome: "GOL",
    phase: "POSITIONAL",
    parentEventId: root.id,
    now: 4,
  });
  assert.throws(
    () => appendEvent(players, events, invalidContinuation),
    (error) =>
      error instanceof MatchIntegrityError &&
      error.issues.some((issue) => issue.code === "INVALID_EVENT_LINK"),
  );
});

test("persistencia local conserva sesión e historial y aísla cada matchId", () => {
  const storage = new MemoryStorage();
  const initialEventsA = initialLineup("match-a");
  const eventsA = appendEvents(players, initialEventsA, [
    createGameStateEvent({
      id: "persisted-superiority",
      matchId: "match-a",
      position: { period: 1, minute: 7, order: 1 },
      state: "SUPERIORITY",
      active: true,
      now: 2,
    }),
    createFoulEvent({
      id: "persisted-foul",
      matchId: "match-a",
      position: { period: 1, minute: 8, order: 1 },
      side: "AGAINST",
      playerId: "p3",
      now: 3,
    }),
  ]);
  const sessionA: MatchSession = {
    matchId: "match-a",
    players,
    period: 1,
    minute: 8,
    periodMinutes: { 1: 8, 2: 0 },
    events: eventsA,
    past: [initialEventsA],
    future: [],
    lastError: null,
    persistenceStatus: "idle",
    lastSavedAt: null,
  };
  const sessionB: MatchSession = {
    ...sessionA,
    matchId: "match-b",
    minute: 3,
    periodMinutes: { 1: 3, 2: 0 },
    events: initialLineup("match-b"),
    past: [],
  };

  assert.equal(saveMatchSession(sessionA, storage, 100).ok, true);
  assert.equal(saveMatchSession(sessionB, storage, 200).ok, true);
  assert.notEqual(matchStorageKey("match-a"), matchStorageKey("match-b"));

  const restoredA = loadMatchSession("match-a", storage);
  const restoredB = loadMatchSession("match-b", storage);
  assert.equal(restoredA?.minute, 8);
  assert.deepEqual(restoredA?.periodMinutes, { 1: 8, 2: 0 });
  assert.equal(restoredA?.events[0].matchId, "match-a");
  assert.equal(restoredA?.events.length, 3);
  assert.equal(restoredA?.past.length, 1);
  assert.equal(restoredA?.lastSavedAt, 100);
  assert.equal(restoredB?.minute, 3);
  assert.deepEqual(restoredB?.periodMinutes, { 1: 3, 2: 0 });
  assert.equal(restoredB?.events[0].matchId, "match-b");

  assert.equal(
    replayMatch(restoredA?.players ?? [], restoredA?.events ?? [])
      .superiorityActive,
    true,
  );
  assert.equal(
    replayMatch(restoredA?.players ?? [], restoredA?.events ?? []).discipline
      .against.fouls,
    1,
  );
  assert.equal(
    replayMatch(restoredB?.players ?? [], restoredB?.events ?? [])
      .superiorityActive,
    false,
  );
  assert.equal(
    replayMatch(restoredB?.players ?? [], restoredB?.events ?? []).discipline
      .against.fouls,
    0,
  );
});

test("persistencia migra faltas locales antiguas sin destruir la sesión", () => {
  const storage = new MemoryStorage();
  const oldFoul = {
    id: "old-foul",
    matchId: "legacy-local",
    schemaVersion: 1,
    period: 1,
    minute: 3,
    order: 1,
    createdAt: 2,
    updatedAt: 2,
    deletedAt: null,
    type: "foul_recorded",
    side: "FOR",
  };
  storage.setItem(
    matchStorageKey("legacy-local"),
    JSON.stringify({
      storageVersion: 1,
      savedAt: 10,
      session: {
        matchId: "legacy-local",
        players,
        period: 1,
        minute: 3,
        events: [initialLineup("legacy-local")[0], oldFoul],
        past: [],
        future: [],
      },
    }),
  );

  const restored = loadMatchSession("legacy-local", storage);
  assert.ok(restored);
  assert.deepEqual(restored.periodMinutes, { 1: 3, 2: 0 });
  const migratedFoul = restored.events.find(
    (event) => event.type === "foul_recorded",
  );
  assert.equal(migratedFoul?.type, "foul_recorded");
  if (migratedFoul?.type === "foul_recorded") {
    assert.equal(migratedFoul.source, "legacy_local");
    assert.equal(migratedFoul.playerId, undefined);
  }
  assert.equal(replayMatch(restored.players, restored.events).issues.length, 0);
});

test("Zustand aísla partidos y soporta undo/redo", () => {
  useMatchStore.setState({ matches: {} });
  const actions = useMatchStore.getState();
  actions.ensureMatch("match-a");
  actions.ensureMatch("match-b");
  useMatchStore.getState().recordThreat("match-a", {
    side: "FOR",
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

test("el reloj retrocede hasta cero sin alterar eventos y permite inserción retroactiva", () => {
  useMatchStore.setState({ matches: {} });
  const matchId = "clock-backward";
  const actions = useMatchStore.getState();
  actions.ensureMatch(matchId);
  actions.setClock(matchId, 1, 8);
  actions.recordThreat(matchId, {
    side: "FOR",
    playerId: "p1",
    origin: { x: 0.7, y: 0.5 },
    outcome: "FUERA",
    phase: "POSITIONAL",
  });
  const eventAtEight = useMatchStore
    .getState()
    .matches[matchId].events.find((event) => event.minute === 8);
  assert.ok(eventAtEight);

  actions.decrementMinute(matchId);
  actions.decrementMinute(matchId);
  actions.decrementMinute(matchId);
  actions.recordThreat(matchId, {
    side: "FOR",
    playerId: "p1",
    origin: { x: 0.4, y: 0.3 },
    outcome: "GOL",
    phase: "TRANSITION",
  });

  let session = useMatchStore.getState().matches[matchId];
  assert.equal(session.minute, 5);
  assert.equal(session.events.length, 3);
  assert.equal(session.events[1].minute, 5);
  assert.equal(session.events[2].id, eventAtEight.id);
  assert.equal(session.events[2].minute, 8);

  for (let index = 0; index < 8; index += 1) {
    actions.decrementMinute(matchId);
  }
  session = useMatchStore.getState().matches[matchId];
  assert.equal(session.minute, 0);
  assert.equal(session.events.length, 3);

  actions.incrementMinute(matchId);
  session = useMatchStore.getState().matches[matchId];
  assert.equal(session.minute, 1);
  assert.equal(session.events.length, 3);
});

test("el reloj reglamentario limita cada periodo a 0-20 sin tocar eventos", () => {
  useMatchStore.setState({ matches: {} });
  const matchId = "bounded-clock";
  const actions = useMatchStore.getState();
  actions.ensureMatch(matchId);
  actions.setClock(matchId, 1, 20);
  actions.recordThreat(matchId, {
    side: "FOR",
    playerId: "p1",
    origin: { x: 0.7, y: 0.5 },
    outcome: "GOL",
    phase: "POSITIONAL",
  });
  const eventsAtLimit = useMatchStore.getState().matches[matchId].events;

  actions.incrementMinute(matchId);
  actions.incrementMinute(matchId);
  let session = useMatchStore.getState().matches[matchId];
  assert.equal(session.period, 1);
  assert.equal(session.minute, 20);
  assert.deepEqual(session.events, eventsAtLimit);

  actions.setClock(matchId, 1, -50);
  actions.decrementMinute(matchId);
  session = useMatchStore.getState().matches[matchId];
  assert.equal(session.minute, 0);
  assert.deepEqual(session.events, eventsAtLimit);

  actions.setClock(matchId, 99, 99);
  session = useMatchStore.getState().matches[matchId];
  assert.equal(session.period, 2);
  assert.equal(session.minute, 20);
  assert.deepEqual(session.events, eventsAtLimit);
});

test("cambiar P1/P2 conserva cronología y recuerda el minuto de cada periodo", () => {
  useMatchStore.setState({ matches: {} });
  const matchId = "period-switch";
  const actions = useMatchStore.getState();
  actions.ensureMatch(matchId);
  actions.setClock(matchId, 1, 17);
  actions.recordFoul(matchId, "FOR", "p1");
  const p1Events = useMatchStore.getState().matches[matchId].events;

  actions.changePeriod(matchId, 2);
  let session = useMatchStore.getState().matches[matchId];
  assert.equal(session.period, 2);
  assert.equal(session.minute, 0);
  assert.deepEqual(session.events, p1Events);

  actions.setClock(matchId, 2, 8);
  actions.recordThreat(matchId, {
    side: "AGAINST",
    origin: { x: 0.2, y: 0.4 },
    outcome: "FUERA",
    phase: "TRANSITION",
  });
  const eventsAcrossPeriods = useMatchStore.getState().matches[matchId].events;

  actions.changePeriod(matchId, 1);
  session = useMatchStore.getState().matches[matchId];
  assert.equal(session.minute, 17);
  assert.deepEqual(session.events, eventsAcrossPeriods);

  actions.changePeriod(matchId, 2);
  session = useMatchStore.getState().matches[matchId];
  assert.equal(session.minute, 8);
  assert.deepEqual(session.periodMinutes, { 1: 17, 2: 8 });
  assert.deepEqual(session.events, eventsAcrossPeriods);
  assert.equal(replayMatch(session.players, session.events).issues.length, 0);
});

test("el minuto global se deriva de periodo y minuto sin persistir otra verdad", () => {
  assert.equal(deriveGlobalMinute(1, 0), 0);
  assert.equal(deriveGlobalMinute(1, 1), 1);
  assert.equal(deriveGlobalMinute(1, 20), 20);
  assert.equal(deriveGlobalMinute(2, 0), 20);
  assert.equal(deriveGlobalMinute(2, 1), 21);
  assert.equal(deriveGlobalMinute(2, 8), 28);
  assert.equal(deriveGlobalMinute(2, 20), 40);
  assert.equal(deriveGlobalMinute(3, 5, 10), 25);
  assert.deepEqual(normalizeMatchClock(0, -1), { period: 1, minute: 0 });
  assert.deepEqual(normalizeMatchClock(3, 21), { period: 2, minute: 20 });
});

test("persistencia local conserva el reloj independiente de P1 y P2", () => {
  const storage = new MemoryStorage();
  const session: MatchSession = {
    matchId: "persisted-clock",
    players,
    period: 2,
    minute: 8,
    periodMinutes: { 1: 20, 2: 8 },
    events: initialLineup("persisted-clock"),
    past: [],
    future: [],
    lastError: null,
    persistenceStatus: "idle",
    lastSavedAt: null,
  };

  assert.equal(saveMatchSession(session, storage, 500).ok, true);
  const restored = loadMatchSession("persisted-clock", storage);
  assert.equal(restored?.period, 2);
  assert.equal(restored?.minute, 8);
  assert.deepEqual(restored?.periodMinutes, { 1: 20, 2: 8 });
  assert.deepEqual(restored?.events, session.events);
});

test("Zustand aplica expulsión e inferioridad atómicamente y undo/redo recalcula", () => {
  useMatchStore.setState({ matches: {} });
  const matchId = "atomic-red";
  const actions = useMatchStore.getState();
  actions.ensureMatch(matchId);
  actions.setClock(matchId, 1, 5);
  actions.recordCard(matchId, "FOR", "RED", "p1", true);

  let session = useMatchStore.getState().matches[matchId];
  assert.equal(session.events.length, 3);
  let replay = replayMatch(session.players, session.events);
  assert.equal(replay.inferiorityActive, true);
  assert.equal(replay.discipline.for.redCards, 1);
  assert.ok(replay.onCourtPlayerIds.includes(INFERIORITY_SLOT_ID));

  actions.undo(matchId);
  session = useMatchStore.getState().matches[matchId];
  replay = replayMatch(session.players, session.events);
  assert.equal(session.events.length, 1);
  assert.equal(replay.inferiorityActive, false);
  assert.equal(replay.discipline.for.redCards, 0);

  actions.redo(matchId);
  session = useMatchStore.getState().matches[matchId];
  replay = replayMatch(session.players, session.events);
  assert.equal(replay.inferiorityActive, true);
  assert.equal(replay.discipline.for.redCards, 1);
});

test("Zustand mantiene roja de pista o banquillo independiente de inferioridad", () => {
  useMatchStore.setState({ matches: {} });
  const matchId = "independent-red";
  const actions = useMatchStore.getState();
  actions.ensureMatch(matchId);
  actions.setClock(matchId, 1, 4);

  actions.recordCard(matchId, "FOR", "RED", "p6", false);
  actions.recordCard(matchId, "FOR", "RED", "p1", false);

  const session = useMatchStore.getState().matches[matchId];
  const replay = replayMatch(session.players, session.events);
  assert.equal(session.events.length, 3);
  assert.equal(replay.inferiorityActive, false);
  assert.ok(replay.onCourtPlayerIds.includes("p1"));
  assert.ok(replay.benchPlayerIds.includes("p6"));
  assert.equal(replay.discipline.for.redCards, 2);
});

test("drag por order y undo/redo renumeran faltas dentro del mismo minuto", () => {
  useMatchStore.setState({ matches: {} });
  const matchId = "foul-drag";
  const actions = useMatchStore.getState();
  actions.ensureMatch(matchId);
  actions.setClock(matchId, 1, 6);
  actions.recordFoul(matchId, "FOR", "p1");
  actions.recordFoul(matchId, "FOR", "p2");
  actions.recordFoul(matchId, "FOR", "p3");

  let session = useMatchStore.getState().matches[matchId];
  const fouls = session.events.filter(
    (event) => event.type === "foul_recorded",
  );
  actions.moveEventWithinMinute(
    matchId,
    fouls[2].id,
    fouls[0].id,
    "BEFORE",
  );

  session = useMatchStore.getState().matches[matchId];
  let replay = replayMatch(session.players, session.events);
  assert.deepEqual(
    replay.timeline
      .flatMap((entry) =>
        entry.event.type === "foul_recorded"
          ? [[entry.event.playerId, entry.periodFoulNumber]]
          : [],
      ),
    [
      ["p3", 1],
      ["p1", 2],
      ["p2", 3],
    ],
  );

  actions.undo(matchId);
  session = useMatchStore.getState().matches[matchId];
  replay = replayMatch(session.players, session.events);
  assert.deepEqual(
    replay.timeline
      .flatMap((entry) =>
        entry.event.type === "foul_recorded" ? [entry.event.playerId] : [],
      ),
    ["p1", "p2", "p3"],
  );

  actions.redo(matchId);
  session = useMatchStore.getState().matches[matchId];
  replay = replayMatch(session.players, session.events);
  assert.deepEqual(
    replay.timeline
      .flatMap((entry) =>
        entry.event.type === "foul_recorded" ? [entry.event.playerId] : [],
      ),
    ["p3", "p1", "p2"],
  );
});

test("Zustand recalcula marcador con goles propios/recibidos y undo/redo", () => {
  useMatchStore.setState({ matches: {} });
  const matchId = "score-store";
  const actions = useMatchStore.getState();
  actions.ensureMatch(matchId);
  actions.recordThreat(matchId, {
    side: "FOR",
    playerId: "p1",
    origin: { x: 0.8, y: 0.5 },
    outcome: "GOL",
    phase: "POSITIONAL",
  });
  actions.recordThreat(matchId, {
    side: "AGAINST",
    origin: { x: 0.2, y: 0.5 },
    outcome: "GOL",
    phase: "TRANSITION",
  });

  let session = useMatchStore.getState().matches[matchId];
  assert.deepEqual(replayMatch(session.players, session.events).score, {
    for: 1,
    against: 1,
  });
  actions.undo(matchId);
  session = useMatchStore.getState().matches[matchId];
  assert.deepEqual(replayMatch(session.players, session.events).score, {
    for: 1,
    against: 0,
  });
  actions.redo(matchId);
  session = useMatchStore.getState().matches[matchId];
  assert.deepEqual(replayMatch(session.players, session.events).score, {
    for: 1,
    against: 1,
  });
});
