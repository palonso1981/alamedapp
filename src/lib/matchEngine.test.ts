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
import { DEMO_PLAYERS, useMatchStore } from "../store/useMatchStore";
import { MatchEvent, Player } from "../types";

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
    now: 2,
  });
  const second = createLiveThreatEvent({
    id: "threat-2",
    matchId: "match-a",
    position: { period: 1, minute: 6, order: 1 },
    side: "AGAINST",
    origin: { x: 0.7, y: 0.4 },
    outcome: "FUERA",
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

test("Zustand aísla partidos y soporta undo/redo", () => {
  useMatchStore.setState({ matches: {} });
  const actions = useMatchStore.getState();
  actions.ensureMatch("match-a");
  actions.ensureMatch("match-b");
  useMatchStore.getState().recordThreat("match-a", {
    playerId: "p1",
    origin: { x: 0.4, y: 0.6 },
    outcome: "GOL",
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
