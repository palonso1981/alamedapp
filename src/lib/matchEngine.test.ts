import assert from "node:assert/strict";
import test from "node:test";

import {
  appendEvent,
  appendEvents,
  createCardEvent,
  createFoulEvent,
  createFoulCountAdjustmentEvent,
  createGameStateEvent,
  createLineupInitializedEvent,
  createLiveThreatEvent,
  createRestartEvent,
  createSubstitutionEvent,
  deriveGoalkeeperReference,
  deriveGlobalMinute,
  deriveRemainingMinute,
  effectiveThreatPhase,
  editEvent,
  EventDeletionBlockedError,
  MatchIntegrityError,
  goalkeeperAtPosition,
  moveEventWithinMinute,
  normalizeMatchClock,
  proposeSecondPeriodLineup,
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
import {
  IDLE_LIVE_INTERACTION,
  consumeContextualPointer,
  reduceLiveInteraction,
  showsThreatControls,
} from "./liveInteraction";
import { contextualPlacement } from "./contextualPlacement";
import { courtHeightForWidth, FUTSAL_COURT_ASPECT_RATIO, normalizeCourtPoint } from "./courtGeometry";
import { CANONICAL_COURT_ORIENTATION, courtOrientationForPeriod } from "./courtGeometry";
import { classifyGoalTarget, completesGoalTargetGesture, completesIndependentPointerGesture, deriveKeeperBodyZone, deriveKeeperBodyZoneFromPart, GOAL_FRAME, isInsideGoalFrame, isOutcomeCompatibleWithGoalTarget, KEEPER_BODY_HITBOXES, KEEPER_BODY_SCREEN_SIDE, KEEPER_BODY_SURFACE, normalizeGoalTargetPoint } from "./goalTarget";
import { assistCandidates, filterTimelineEvents } from "./matchReview";
import { effectiveReviewStatus, reviewEventCounts, targetMinutesComparisons } from "./postMatchReview";
import { deriveGoalZoneV1, derivePitchZoneV1, PITCH_ZONE_MODEL_VERSION } from "./spatialZones";
import { functionalGoalkeeperBadge } from "./goalkeeperPresentation";
import {
  DEMO_EXTRA_PLAYER,
  DEMO_PLAYERS,
  DEMO_STAFF,
  CLEAN_GOAL_DEMO_MATCH_ID,
  createSession,
  secondPeriodLineupEventId,
  upgradeDemoSession,
  useMatchStore,
} from "../store/useMatchStore";
import {
  GOAL_TARGET_GEOMETRY_VERSION,
  INFERIORITY_SLOT_ID,
  MatchEvent,
  MatchSession,
  Player,
} from "../types";

const players: Player[] = DEMO_PLAYERS.map((player) => ({ ...player }));

test("la etiqueta visual distingue portero funcional, perfil natural y P-J", () => {
  const natural: Player = { id: "gk", name: "Portero", number: 1, naturalPosition: "GOALKEEPER", position: "PORTERO" };
  const field: Player = { id: "field", name: "Campo", number: 4, naturalPosition: "FIXO", position: "JUGADOR", goalkeeperCapable: true };
  assert.equal(functionalGoalkeeperBadge(natural, "gk"), "PORTERO");
  assert.equal(functionalGoalkeeperBadge(field, "field"), "PORTERO · ROL FUNCIONAL");
  assert.equal(functionalGoalkeeperBadge(field, "gk"), null);
  assert.equal(field.position, "JUGADOR", "la etiqueta funcional no convierte por sí sola al jugador en P-J");
});

test("reinicio standalone enlaza solo la siguiente amenaza compatible del mismo lado", () => {
  const matchId = "restart-link";
  const restart = createRestartEvent({ id: "corner-a", matchId, position: { period: 1, minute: 3, order: 1 }, side: "FOR", restart: "CORNER", spatialSide: "TOP", now: 2 });
  const linked = createLiveThreatEvent({ id: "shot-a", matchId, position: { period: 1, minute: 3, order: 2 }, side: "FOR", playerId: "p1", origin: { x: .8, y: .2 }, outcome: "FUERA", phase: "SET_PIECE_CORNER", restartEventId: restart.id, now: 3 });
  const replay = replayMatch(players, [...initialLineup(matchId), restart, linked]);
  assert.equal(replay.issues.length, 0);
  const wrong = [...initialLineup(matchId), restart, { ...linked, phase: "POSITIONAL" as const }];
  assert.ok(replayMatch(players, wrong).issues.some((entry) => entry.code === "INVALID_EVENT_LINK"));
});

test("ajuste de faltas es auditable, no atribuye jugador y la siguiente falta queda como F6", () => {
  const matchId = "foul-adjustment";
  let events = initialLineup(matchId);
  for (let index = 1; index <= 4; index += 1) events = appendEvent(players, events, createFoulEvent({ id: `f${index}`, matchId, position: { period: 1, minute: index, order: 1 }, side: "FOR", playerId: "p1", now: index + 1 }));
  events = appendEvent(players, events, createFoulCountAdjustmentEvent({ id: "unknown-foul", matchId, position: { period: 1, minute: 5, order: 1 }, side: "FOR", delta: 1, now: 8 }));
  events = appendEvent(players, events, createFoulEvent({ id: "real-next", matchId, position: { period: 1, minute: 6, order: 1 }, side: "FOR", playerId: "p2", now: 9 }));
  const replay = replayMatch(players, events);
  assert.equal(replay.disciplineByPeriod[1].for.fouls, 6);
  assert.equal(replay.timeline.find((entry) => entry.event.id === "real-next")?.periodFoulNumber, 6);
  const adjustment = events.find((event) => event.id === "unknown-foul");
  assert.equal(adjustment?.pendingReview, true);
  assert.equal(adjustment && "playerId" in adjustment, false);
});

test("PJ CDA y PJ rival mantienen estados cronológicos independientes", () => {
  const matchId = "pj-both-sides";
  const events = [...initialLineup(matchId),
    createGameStateEvent({ id: "pj-for", matchId, position: { period: 1, minute: 8, order: 1 }, state: "FLYING_GOALKEEPER", active: true, playerId: "p2", side: "FOR", now: 2 }),
    createGameStateEvent({ id: "pj-against", matchId, position: { period: 1, minute: 9, order: 1 }, state: "FLYING_GOALKEEPER", active: true, side: "AGAINST", now: 3 }),
    createGameStateEvent({ id: "pj-for-off", matchId, position: { period: 1, minute: 10, order: 1 }, state: "FLYING_GOALKEEPER", active: false, side: "FOR", now: 4 }),
  ];
  const replay = replayMatch(players, events);
  assert.equal(replay.flyingGoalkeeperActive, false);
  assert.equal(replay.flyingGoalkeeperAgainstActive, true);
});

test("blocaje despeje y rechace son válidos sin bodyPart y rechace no crea hijo", () => {
  for (const saveOutcome of ["CATCH", "CLEARANCE", "REBOUND"] as const) {
    let transition = reduceLiveInteraction(IDLE_LIVE_INTERACTION, { type: "COURT_TAPPED", origin: { x: .4, y: .5 }, eventId: `no-body-${saveOutcome}` });
    transition = reduceLiveInteraction(transition.state, { type: "GOAL_TARGET_SELECTED", goalTarget: { geometryVersion: GOAL_TARGET_GEOMETRY_VERSION, x: .5, y: .5 } });
    transition = reduceLiveInteraction(transition.state, { type: "SAVE_OUTCOME_SELECTED", saveOutcome });
    assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.step, "PHASE");
    transition = reduceLiveInteraction(transition.state, { type: "PHASE_SELECTED", phase: "POSITIONAL" });
    assert.equal(transition.effect?.type === "RECORD_THREAT" && transition.effect.defensiveCapture?.keeperBodyPart, undefined);
    assert.equal(transition.effect?.type === "RECORD_THREAT" && transition.effect.defensiveCapture?.saveOutcome, saveOutcome);
    assert.equal(transition.state.kind, saveOutcome === "REBOUND" ? "SECOND_PLAY_OFFER" : "IDLE");
  }
});

test("el gesto de destino se consume y no puede activar el resultado montado después", () => {
  assert.equal(completesGoalTargetGesture(null, 7), false);
  assert.equal(completesGoalTargetGesture(7, 8), false);
  assert.equal(completesGoalTargetGesture(7, 7), true);
  let transition = reduceLiveInteraction(IDLE_LIVE_INTERACTION, { type: "COURT_TAPPED", origin: { x: .5, y: .5 }, eventId: "pointer-p0" });
  transition = reduceLiveInteraction(transition.state, { type: "GOAL_TARGET_SELECTED", goalTarget: { geometryVersion: GOAL_TARGET_GEOMETRY_VERSION, x: .5, y: .5 } });
  assert.equal(transition.effect, undefined);
  assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.step, "GOAL_RESULT");
});

test("reinicios ajustes y PJ rival sobreviven persistencia local", () => {
  const matchId = "directo-v2-persist";
  const session = createSession(matchId);
  session.events = [
    ...session.events,
    createRestartEvent({ id: "restart-persist", matchId, position: { period: 1, minute: 4, order: 1 }, side: "AGAINST", restart: "DANGEROUS_KICK_IN", spatialSide: "BOTTOM" }),
    createFoulCountAdjustmentEvent({ id: "adjust-persist", matchId, position: { period: 1, minute: 5, order: 1 }, side: "AGAINST", delta: 1 }),
    createGameStateEvent({ id: "pj-rival-persist", matchId, position: { period: 1, minute: 6, order: 1 }, state: "FLYING_GOALKEEPER", active: true, side: "AGAINST" }),
  ];
  const storage = new MemoryStorage();
  assert.equal(saveMatchSession(session, storage).ok, true);
  const loaded = loadMatchSession(matchId, storage);
  assert.equal(loaded?.events.length, session.events.length);
  const replay = replayMatch(loaded!.players, loaded!.events);
  assert.equal(replay.discipline.against.fouls, 1);
  assert.equal(replay.flyingGoalkeeperAgainstActive, true);
});

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

test("la sustitución transfiere el slot funcional de portero sin usar la posición natural", () => {
  const matchId = "functional-goalkeeper-slot";
  const squad = players.map((player) =>
    player.id === "p6" ? { ...player, goalkeeperCapable: true, naturalPosition: "GOALKEEPER" as const } : player,
  );
  const lineup = createLineupInitializedEvent({
    id: "functional-lineup",
    matchId,
    position: { period: 1, minute: 0, order: 1 },
    squadPlayerIds: squad.map((player) => player.id),
    onCourtPlayerIds: ["p1", "p2", "p3", "p4", "p5"],
    goalkeeperPlayerId: "p5",
  });
  const replaceKeeperWithField = appendEvent(squad, [lineup], createSubstitutionEvent({
    id: "keeper-to-field",
    matchId,
    position: { period: 1, minute: 4, order: 1 },
    playerOutId: "p5",
    playerInId: "p7",
  }));
  assert.deepEqual(replayMatch(squad, replaceKeeperWithField).lineupValidation.goalkeeper, {
    status: "PLAYER",
    playerId: "p7",
    resolution: "REPLAY",
  });

  const replaceKeeperWithNaturalKeeper = appendEvent(squad, [lineup], createSubstitutionEvent({
    id: "keeper-to-natural-keeper",
    matchId,
    position: { period: 1, minute: 4, order: 1 },
    playerOutId: "p5",
    playerInId: "p6",
  }));
  const naturalReplacementGoalkeeper = replayMatch(
    squad,
    replaceKeeperWithNaturalKeeper,
  ).lineupValidation.goalkeeper;
  assert.equal(naturalReplacementGoalkeeper.status, "PLAYER");
  assert.equal(
    naturalReplacementGoalkeeper.status === "PLAYER"
      ? naturalReplacementGoalkeeper.playerId
      : null,
    "p6",
  );

  const naturalKeeperEntersAnOutfieldSlot = appendEvent(squad, [lineup], createSubstitutionEvent({
    id: "field-to-natural-keeper",
    matchId,
    position: { period: 1, minute: 4, order: 1 },
    playerOutId: "p1",
    playerInId: "p6",
  }));
  const replay = replayMatch(squad, naturalKeeperEntersAnOutfieldSlot);
  assert.deepEqual(replay.lineupValidation.goalkeeper, {
    status: "PLAYER",
    playerId: "p5",
    resolution: "REPLAY",
  });

  const legacyLineup = { ...lineup, id: "legacy-functional-lineup", goalkeeperPlayerId: undefined };
  const legacyReplacement = appendEvent(squad, [legacyLineup], createSubstitutionEvent({
    id: "legacy-keeper-to-field",
    matchId,
    position: { period: 1, minute: 6, order: 1 },
    playerOutId: "p5",
    playerInId: "p7",
  }));
  assert.deepEqual(replayMatch(squad, legacyReplacement).lineupValidation.goalkeeper, {
    status: "PLAYER",
    playerId: "p7",
    resolution: "REPLAY",
  });
});

test("undo/redo y P-J conservan el rol funcional ligado al slot sustituido", () => {
  const matchId = "functional-goalkeeper-history";
  useMatchStore.setState({ matches: { [matchId]: createSession(matchId) } });
  const actions = useMatchStore.getState();
  actions.swapPlayer(matchId, "p5", "p6");
  let current = useMatchStore.getState().matches[matchId];
  assert.deepEqual(replayMatch(current.players, current.events).lineupValidation.goalkeeper, {
    status: "PLAYER", playerId: "p6", resolution: "REPLAY",
  });
  const storage = new MemoryStorage();
  assert.equal(saveMatchSession(current, storage, 10).ok, true);
  const reloaded = loadMatchSession(matchId, storage);
  assert.ok(reloaded);
  assert.deepEqual(replayMatch(reloaded!.players, reloaded!.events).lineupValidation.goalkeeper, {
    status: "PLAYER", playerId: "p6", resolution: "REPLAY",
  });
  actions.undo(matchId);
  current = useMatchStore.getState().matches[matchId];
  assert.deepEqual(replayMatch(current.players, current.events).lineupValidation.goalkeeper, {
    status: "PLAYER", playerId: "p5", resolution: "REPLAY",
  });
  actions.redo(matchId);
  actions.toggleGameState(matchId, "FLYING_GOALKEEPER", "p2");
  actions.swapPlayer(matchId, "p2", "p7");
  current = useMatchStore.getState().matches[matchId];
  const replay = replayMatch(current.players, current.events);
  assert.equal(replay.flyingGoalkeeperActive, true);
  assert.equal(replay.flyingGoalkeeperPlayerId, "p7");
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
    totalMinutes: 7,
    currentStintMinutes: 2,
    onCourt: true,
  });
  assert.deepEqual(result.playerMinutes.p6, {
    totalMinutes: 5,
    currentStintMinutes: 0,
    onCourt: false,
  });
  assert.equal(result.playerMinutes.p2.totalMinutes, 12);
  assert.equal(result.playerMinutes.p2.currentStintMinutes, 12);
});

test("el reloj transcurrido parte de cero y una entrada en 5 suma tres en 8", () => {
  let events = initialLineup();
  const initial = replayMatch(players, events, {
    currentClock: { period: 1, minute: 0 },
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
  assert.equal(atEight.playerMinutes.p1.totalMinutes, 5);
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
    assist: { status: "NONE" },
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
  assert.equal(replay.playerMinutes.p1.totalMinutes, 5);
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

test("faltas admiten ubicación opcional y umbrales configurables sin persistir derivados", () => {
  let events = initialLineup();
  events = appendEvents(players, events, [
    createFoulEvent({
      id: "foul-no-origin",
      matchId: "match-a",
      position: { period: 1, minute: 2, order: 1 },
      side: "FOR",
      playerId: "p1",
      now: 2,
    }),
    createFoulEvent({
      id: "foul-with-origin",
      matchId: "match-a",
      position: { period: 1, minute: 3, order: 1 },
      side: "FOR",
      playerId: "p2",
      origin: { x: 0.18, y: 0.76 },
      now: 3,
    }),
  ]);

  const replay = replayMatch(players, events, {
    foulAccumulationRules: { thresholds: [2, 5] },
  });
  const fouls = replay.timeline.filter(
    (entry) => entry.event.type === "foul_recorded",
  );
  assert.equal(fouls[0].event.type === "foul_recorded" && fouls[0].event.origin, undefined);
  assert.deepEqual(
    fouls[1].event.type === "foul_recorded" && fouls[1].event.origin,
    { x: 0.18, y: 0.76 },
  );
  assert.deepEqual(
    fouls.map((entry) => [
      entry.periodFoulsBefore,
      entry.periodFoulsAfter,
      entry.reachedFoulThresholds,
    ]),
    [
      [0, 1, []],
      [1, 2, [2]],
    ],
  );
  assert.equal("periodFoulNumber" in events[1], false);
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
    assist: { status: "NONE" },
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
      origin: { x: 0.24, y: 0.62 },
      now: 3,
    }),
  ]);
  const sessionA: MatchSession = {
    matchId: "match-a",
    players,
    staff: [],
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
  const restoredFoul = restoredA?.events.find(
    (event) => event.type === "foul_recorded",
  );
  assert.deepEqual(
    restoredFoul?.type === "foul_recorded" ? restoredFoul.origin : undefined,
    { x: 0.24, y: 0.62 },
  );
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
  assert.deepEqual(restored.staff, []);
  const migratedFoul = restored.events.find(
    (event) => event.type === "foul_recorded",
  );
  assert.equal(migratedFoul?.type, "foul_recorded");
  if (migratedFoul?.type === "foul_recorded") {
    assert.equal(migratedFoul.source, "legacy_local");
    assert.equal(migratedFoul.playerId, null);
    assert.equal(migratedFoul.pendingReview, false);
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
    assist: { status: "NONE" },
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
    assist: { status: "NONE" },
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
    assist: { status: "NONE" },
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
    staff: [],
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

test("interacción jugador en pista y banquillo produce sustitución y replay", () => {
  let transition = reduceLiveInteraction(IDLE_LIVE_INTERACTION, {
    type: "COURT_PLAYER_TAPPED",
    playerId: "p1",
  });
  transition = reduceLiveInteraction(transition.state, {
    type: "BENCH_PLAYER_TAPPED",
    playerId: "p6",
  });
  assert.deepEqual(transition.state, IDLE_LIVE_INTERACTION);
  assert.deepEqual(transition.effect, {
    type: "RECORD_SUBSTITUTION",
    playerOutId: "p1",
    playerInId: "p6",
  });

  useMatchStore.setState({ matches: {} });
  const matchId = "intent-substitution";
  const actions = useMatchStore.getState();
  actions.ensureMatch(matchId);
  actions.setClock(matchId, 1, 5);
  if (transition.effect?.type === "RECORD_SUBSTITUTION") {
    actions.swapPlayer(
      matchId,
      transition.effect.playerOutId,
      transition.effect.playerInId,
    );
  }
  actions.setClock(matchId, 1, 8);
  const session = useMatchStore.getState().matches[matchId];
  const replay = replayMatch(session.players, session.events, {
    currentClock: { period: 1, minute: 8 },
  });
  assert.ok(replay.onCourtPlayerIds.includes("p6"));
  assert.ok(replay.benchPlayerIds.includes("p1"));
  assert.equal(replay.playerMinutes.p6.currentStintMinutes, 3);
});

test("jugador y pista preparan amenaza CDA con autor sin guardar antes de completarla", () => {
  useMatchStore.setState({ matches: {} });
  const matchId = "intent-for-threat";
  const actions = useMatchStore.getState();
  actions.ensureMatch(matchId);
  const initialEventCount = useMatchStore.getState().matches[matchId].events.length;

  let transition = reduceLiveInteraction(IDLE_LIVE_INTERACTION, {
    type: "COURT_PLAYER_TAPPED",
    playerId: "p2",
  });
  transition = reduceLiveInteraction(transition.state, {
    type: "COURT_TAPPED",
    origin: { x: 0.72, y: 0.31 },
    eventId: "intent-for-event",
  });
  assert.equal(transition.state.kind, "THREAT_PENDING");
  assert.equal(showsThreatControls(transition.state), true);
  assert.equal(useMatchStore.getState().matches[matchId].events.length, initialEventCount);

  transition = reduceLiveInteraction(transition.state, {
    type: "OUTCOME_SELECTED",
    outcome: "GOL",
  });
  assert.equal(transition.effect, undefined);
  transition = reduceLiveInteraction(transition.state, {
    type: "PHASE_SELECTED",
    phase: "POSITIONAL",
  });
  assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.step, "ASSIST");
  assert.equal(transition.effect, undefined);
  transition = reduceLiveInteraction(transition.state, {
    type: "ASSIST_SELECTED",
    assist: { status: "PLAYER", playerId: "p1" },
  });
  assert.deepEqual(transition.effect, {
    type: "RECORD_THREAT",
    id: "intent-for-event",
    side: "FOR",
    playerId: "p2",
    origin: { x: 0.72, y: 0.31 },
    outcome: "GOL",
    phase: "POSITIONAL",
    assist: { status: "PLAYER", playerId: "p1" },
    sequenceId: "intent-for-event",
    parentEventId: undefined,
  });
  if (transition.effect?.type === "RECORD_THREAT") {
    actions.recordThreat(matchId, transition.effect);
  }
  const threat = useMatchStore
    .getState()
    .matches[matchId].events.find((event) => event.type === "threat_recorded");
  assert.equal(threat?.type, "threat_recorded");
  if (threat?.type === "threat_recorded") {
    assert.equal(threat.side, "FOR");
    assert.equal(threat.playerId, "p2");
  }
});

test("tocar pista directamente prepara amenaza rival sin jugador", () => {
  let transition = reduceLiveInteraction(IDLE_LIVE_INTERACTION, {
    type: "COURT_TAPPED",
    origin: { x: 0.2, y: 0.6 },
    eventId: "defensive-intent",
  });
  assert.equal(transition.state.kind, "THREAT_PENDING");
  assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.flowId, "AGAINST_ORIGIN_TARGET_RESULT_BODY_DETAILS_PHASE");
  assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.step, "GOAL_TARGET");
  transition = reduceLiveInteraction(transition.state, {
    type: "PHASE_SELECTED",
    phase: "TRANSITION",
  });
  assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.step, "GOAL_TARGET");
  assert.equal(transition.effect, undefined);
  transition = reduceLiveInteraction(transition.state, {
    type: "GOAL_TARGET_SELECTED",
    goalTarget: { geometryVersion: 1, x: 0.5, y: 0.45 },
  });
  assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.step, "GOAL_RESULT");
  transition = reduceLiveInteraction(transition.state, { type: "DEFENSIVE_OUTCOME_SELECTED", outcome: "PARADA" });
  assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.step, "KEEPER_BODY_PART");
  transition = reduceLiveInteraction(transition.state, { type: "KEEPER_BODY_PART_SELECTED", keeperBodyPart: "TORSO" });
  assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.step, "DETAILS");
  transition = reduceLiveInteraction(transition.state, {
    type: "SAVE_OUTCOME_SELECTED",
    saveOutcome: "CATCH",
  });
  assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.step, "PHASE");
  assert.equal(transition.effect, undefined);
  transition = reduceLiveInteraction(transition.state, {
    type: "PHASE_SELECTED",
    phase: "TRANSITION",
  });
  assert.equal(transition.effect?.type, "RECORD_THREAT");
  if (transition.effect?.type === "RECORD_THREAT") {
    assert.equal(transition.effect.side, "AGAINST");
    assert.equal(transition.effect.playerId, undefined);
    assert.equal(transition.effect.defensiveCapture?.saveOutcome, "CATCH");
  }
});

test("selección puede cambiarse o cancelarse sin cronología ni controles permanentes", () => {
  let transition = reduceLiveInteraction(IDLE_LIVE_INTERACTION, {
    type: "COURT_PLAYER_TAPPED",
    playerId: "p1",
  });
  assert.equal(showsThreatControls(transition.state), false);
  transition = reduceLiveInteraction(transition.state, {
    type: "COURT_PLAYER_TAPPED",
    playerId: "p3",
  });
  assert.deepEqual(transition.state, {
    kind: "PLAYER_SELECTED",
    playerId: "p3",
    location: "COURT",
  });
  transition = reduceLiveInteraction(transition.state, {
    type: "COURT_TAPPED",
    origin: { x: 0.4, y: 0.4 },
  });
  assert.equal(showsThreatControls(transition.state), true);
  transition = reduceLiveInteraction(transition.state, { type: "CANCEL" });
  assert.deepEqual(transition, { state: IDLE_LIVE_INTERACTION });
  assert.equal(showsThreatControls(transition.state), false);

  transition = reduceLiveInteraction(IDLE_LIVE_INTERACTION, {
    type: "COURT_PLAYER_TAPPED",
    playerId: "p1",
  });
  transition = reduceLiveInteraction(transition.state, {
    type: "COURT_PLAYER_TAPPED",
    playerId: "p1",
  });
  assert.deepEqual(transition.state, IDLE_LIVE_INTERACTION);
});

test("banquillo neutro abre contexto propio y tras jugador en pista mantiene sustitución", () => {
  let transition = reduceLiveInteraction(IDLE_LIVE_INTERACTION, {
    type: "BENCH_PLAYER_TAPPED",
    playerId: "p6",
  });
  assert.deepEqual(transition, {
    state: { kind: "PLAYER_SELECTED", playerId: "p6", location: "BENCH" },
  });
  assert.equal(transition.effect, undefined);

  transition = reduceLiveInteraction(transition.state, {
    type: "BENCH_PLAYER_TAPPED",
    playerId: "p6",
  });
  assert.deepEqual(transition.state, IDLE_LIVE_INTERACTION);

  transition = reduceLiveInteraction(IDLE_LIVE_INTERACTION, {
    type: "COURT_PLAYER_TAPPED",
    playerId: "p1",
  });
  transition = reduceLiveInteraction(transition.state, {
    type: "BENCH_PLAYER_TAPPED",
    playerId: "p6",
  });
  assert.deepEqual(transition.effect, {
    type: "RECORD_SUBSTITUTION",
    playerOutId: "p1",
    playerInId: "p6",
  });
});

test("la superficie contextual se orienta hacia el interior en centro y bordes", () => {
  assert.deepEqual(contextualPlacement({ x: 0.5, y: 0.5 }), {
    horizontal: "CENTER",
    vertical: "ABOVE",
  });
  assert.deepEqual(contextualPlacement({ x: 0.01, y: 0.02 }), {
    horizontal: "START",
    vertical: "BELOW",
  });
  assert.deepEqual(contextualPlacement({ x: 0.99, y: 0.98 }), {
    horizontal: "END",
    vertical: "ABOVE",
  });
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
    assist: { status: "NONE" },
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

test("la geometría de pista mantiene 2:1 y las coordenadas sobreviven al resize", () => {
  assert.equal(FUTSAL_COURT_ASPECT_RATIO, 2);
  assert.equal(courtHeightForWidth(1_000), 500);
  const compact = normalizeCourtPoint(250, 125, {
    left: 0,
    top: 0,
    width: 500,
    height: 250,
  });
  const expanded = normalizeCourtPoint(500, 250, {
    left: 0,
    top: 0,
    width: 1_000,
    height: 500,
  });
  assert.deepEqual(compact, { x: 0.5, y: 0.5 });
  assert.deepEqual(expanded, compact);
});

test("la convocatoria demo separa 12 jugadores, siete suplentes y tres técnicos", () => {
  useMatchStore.setState({ matches: {} });
  const matchId = "realistic-roster";
  const actions = useMatchStore.getState();
  actions.ensureMatch(matchId);
  const session = useMatchStore.getState().matches[matchId];
  const replay = replayMatch(session.players, session.events);
  assert.equal(session.players.length, 12);
  assert.equal(replay.onCourtPlayerIds.length, 5);
  assert.equal(replay.benchPlayerIds.length, 7);
  assert.equal(session.staff.length, 3);
  assert.deepEqual(session.staff, DEMO_STAFF);
  assert.equal(
    session.staff.some((member) => session.players.some((player) => player.id === member.id)),
    false,
  );
  const extremePlayers = [...session.players, { id: "p13", name: "Extra", number: 15 }];
  const extreme = createLineupInitializedEvent({
    matchId: "extreme-roster",
    position: { period: 1, minute: 0, order: 1 },
    squadPlayerIds: extremePlayers.map((player) => player.id),
    onCourtPlayerIds: extremePlayers.slice(0, 5).map((player) => player.id),
  });
  assert.equal(replayMatch(extremePlayers, [extreme]).benchPlayerIds.length, 8);
});

test("tarjetas de staff computan disciplina sin modificar alineación ni minutos", () => {
  useMatchStore.setState({ matches: {} });
  const matchId = "staff-discipline";
  const actions = useMatchStore.getState();
  actions.ensureMatch(matchId);
  const before = useMatchStore.getState().matches[matchId];
  const beforeReplay = replayMatch(before.players, before.events, {
    currentClock: { period: 1, minute: 8 },
  });
  actions.setClock(matchId, 1, 8);
  actions.recordStaffCard(matchId, "staff-coach", "YELLOW");
  actions.recordStaffCard(matchId, "staff-assistant", "RED");
  const after = useMatchStore.getState().matches[matchId];
  const afterReplay = replayMatch(after.players, after.events, {
    currentClock: { period: 1, minute: 8 },
  });
  assert.deepEqual(afterReplay.onCourtPlayerIds, beforeReplay.onCourtPlayerIds);
  assert.deepEqual(afterReplay.playerMinutes, beforeReplay.playerMinutes);
  assert.equal(afterReplay.discipline.for.yellowCards, 1);
  assert.equal(afterReplay.discipline.for.redCards, 1);
  assert.equal(afterReplay.inferiorityActive, false);
  assert.equal(
    after.events.filter((event) => event.type === "card_recorded" && event.staffId).length,
    2,
  );
});

test("cronología completa conserva veinte eventos y permite revisar el primero", () => {
  let events = initialLineup("long-timeline");
  for (let index = 1; index <= 20; index += 1) {
    events = appendEvent(
      players,
      events,
      createLiveThreatEvent({
        id: `long-${index}`,
        matchId: "long-timeline",
        position: { period: index <= 10 ? 1 : 2, minute: ((index - 1) % 10) + 1, order: 1 },
        side: index % 2 === 0 ? "AGAINST" : "FOR",
        playerId: index % 2 === 0 ? undefined : "p1",
        origin: { x: index / 21, y: 0.5 },
        outcome: index % 5 === 0 ? "GOL" : "FUERA",
        phase: index % 3 === 0 ? "TRANSITION" : "POSITIONAL",
        assist: index % 5 === 0 && index % 2 !== 0 ? { status: "NONE" } : undefined,
        now: index + 1,
      }),
    );
  }
  const complete = filterTimelineEvents(events, "ACTIVE");
  assert.equal(complete.length, 20);
  assert.equal(complete.at(-1)?.id, "long-1");
  events = editEvent(players, events, "long-1", {
    threat: { phase: "TRANSITION" },
    pendingReview: true,
  });
  const replay = replayMatch(players, events);
  assert.deepEqual(replay.issues, []);
  assert.equal(
    filterTimelineEvents(events, "PENDING").map((event) => event.id).includes("long-1"),
    true,
  );
});

test("pendiente de revisión computa, filtra, persiste y se puede desmarcar", () => {
  let events = initialLineup("pending-review");
  const goal = createLiveThreatEvent({
    id: "pending-goal",
    matchId: "pending-review",
    position: { period: 1, minute: 4, order: 1 },
    side: "FOR",
    playerId: "p1",
    origin: { x: 0.82, y: 0.4 },
    outcome: "GOL",
    phase: "POSITIONAL",
    assist: { status: "PENDING" },
  });
  events = appendEvent(players, events, goal);
  assert.equal(replayMatch(players, events).score.for, 1);
  assert.equal(filterTimelineEvents(events, "PENDING").length, 1);
  events = editEvent(players, events, goal.id, { pendingReview: false });
  assert.equal(events.find((event) => event.id === goal.id)?.pendingReview, true);
  events = editEvent(players, events, goal.id, {
    threat: { assist: { status: "NONE" } },
  });
  assert.equal(events.find((event) => event.id === goal.id)?.pendingReview, false);

  const storage = new MemoryStorage();
  const session: MatchSession = {
    matchId: "pending-review",
    players,
    staff: DEMO_STAFF,
    period: 1,
    minute: 4,
    periodMinutes: { 1: 4, 2: 0 },
    events,
    past: [],
    future: [],
    lastError: null,
    persistenceStatus: "idle",
    lastSavedAt: null,
  };
  assert.equal(saveMatchSession(session, storage).ok, true);
  assert.equal(loadMatchSession("pending-review", storage)?.events.length, events.length);
});

test("asistencia usa la alineación del instante, excluye goleador y admite edición", () => {
  let events = initialLineup("assist-match");
  events = appendEvent(players, events, createSubstitutionEvent({
    id: "assist-sub",
    matchId: "assist-match",
    position: { period: 1, minute: 5, order: 1 },
    playerOutId: "p2",
    playerInId: "p6",
  }));
  const goal = createLiveThreatEvent({
    id: "assist-goal",
    matchId: "assist-match",
    position: { period: 1, minute: 5, order: 2 },
    side: "FOR",
    playerId: "p1",
    origin: { x: 0.8, y: 0.5 },
    outcome: "GOL",
    phase: "TRANSITION",
    assist: { status: "PLAYER", playerId: "p6" },
  });
  events = appendEvent(players, events, goal);
  let replay = replayMatch(players, events);
  const entry = replay.timeline.find((candidate) => candidate.event.id === goal.id);
  assert.ok(entry);
  assert.deepEqual(assistCandidates(entry.lineupPlayerIds, "p1"), ["p6", "p3", "p4", "p5"]);
  assert.equal(replay.score.for, 1);
  events = editEvent(players, events, goal.id, {
    threat: { assist: { status: "PLAYER", playerId: "p3" } },
  });
  replay = replayMatch(players, events);
  const edited = replay.timeline.find((candidate) => candidate.event.id === goal.id)?.event;
  assert.equal(edited?.type === "threat_recorded" && edited.assist?.status === "PLAYER" && edited.assist.playerId, "p3");
  assert.throws(() => editEvent(players, events, goal.id, {
    threat: { assist: { status: "PLAYER", playerId: "p1" } },
  }), MatchIntegrityError);
});

test("captura CDA exige decisión de asistencia y conserva SIN ASISTENCIA", () => {
  useMatchStore.setState({ matches: {} });
  const matchId = "assist-required";
  const actions = useMatchStore.getState();
  actions.ensureMatch(matchId);
  actions.recordThreat(matchId, {
    side: "FOR",
    playerId: "p1",
    origin: { x: 0.8, y: 0.5 },
    outcome: "GOL",
    phase: "POSITIONAL",
  });
  let session = useMatchStore.getState().matches[matchId];
  assert.equal(session.events.length, 1);
  assert.match(session.lastError ?? "", /asistencia/);
  actions.recordThreat(matchId, {
    side: "FOR",
    playerId: "p1",
    origin: { x: 0.8, y: 0.5 },
    outcome: "GOL",
    phase: "POSITIONAL",
    assist: { status: "NONE" },
  });
  session = useMatchStore.getState().matches[matchId];
  assert.equal(replayMatch(session.players, session.events).score.for, 1);
  const recorded = session.events.find((event) => event.type === "threat_recorded");
  assert.equal(recorded?.type === "threat_recorded" && recorded.assist?.status, "NONE");
});

test("soft delete y restauración funcionan para eventos independientes editados, con asistencia y pendientes", () => {
  const matchId = "delete-independent";
  let events = initialLineup(matchId);
  events = appendEvents(players, events, [
    createGameStateEvent({
      id: "delete-state",
      matchId,
      position: { period: 1, minute: 1, order: 1 },
      state: "SUPERIORITY",
      active: true,
      now: 2,
    }),
    createFoulEvent({
      id: "delete-foul",
      matchId,
      position: { period: 1, minute: 2, order: 1 },
      side: "FOR",
      playerId: "p1",
      now: 3,
    }),
    createCardEvent({
      id: "delete-card",
      matchId,
      position: { period: 1, minute: 3, order: 1 },
      side: "FOR",
      color: "YELLOW",
      playerId: "p2",
      now: 4,
    }),
    createLiveThreatEvent({
      id: "delete-goal",
      matchId,
      position: { period: 1, minute: 4, order: 1 },
      side: "FOR",
      playerId: "p1",
      origin: { x: 0.82, y: 0.42 },
      outcome: "GOL",
      phase: "POSITIONAL",
      assist: { status: "PENDING" },
      now: 5,
    }),
  ]);
  events = editEvent(players, events, "delete-goal", {
    threat: { phase: "TRANSITION" },
  }, 6);

  for (const eventId of ["delete-state", "delete-foul", "delete-card", "delete-goal"]) {
    events = softDeleteEvent(players, events, eventId, 10);
    assert.notEqual(events.find((event) => event.id === eventId)?.deletedAt, null);
    assert.deepEqual(replayMatch(players, events).issues, []);
    if (eventId === "delete-goal") {
      assert.equal(filterTimelineEvents(events, "PENDING").length, 0);
    }
    events = restoreEvent(players, events, eventId, 11);
    assert.equal(events.find((event) => event.id === eventId)?.deletedAt, null);
    assert.deepEqual(replayMatch(players, events).issues, []);
  }
  assert.equal(replayMatch(players, events).score.for, 1);
  assert.equal(events.find((event) => event.id === "delete-goal")?.pendingReview, true);
});

test("soft delete explica el bloqueo cuando un evento posterior depende de una sustitución", () => {
  const matchId = "delete-dependent";
  let events = initialLineup(matchId);
  events = appendEvents(players, events, [
    createSubstitutionEvent({
      id: "dependent-sub",
      matchId,
      position: { period: 1, minute: 4, order: 1 },
      playerOutId: "p1",
      playerInId: "p6",
      now: 2,
    }),
    createLiveThreatEvent({
      id: "dependent-threat",
      matchId,
      position: { period: 1, minute: 5, order: 1 },
      side: "FOR",
      playerId: "p6",
      origin: { x: 0.7, y: 0.4 },
      outcome: "FUERA",
      phase: "TRANSITION",
      now: 3,
    }),
  ]);

  assert.throws(
    () => softDeleteEvent(players, events, "dependent-sub", 4),
    (error: unknown) => {
      assert.ok(error instanceof EventDeletionBlockedError);
      assert.equal(error.blockingIssues[0]?.eventId, "dependent-threat");
      assert.match(error.message, /evento posterior depende/);
      assert.match(error.message, /Edita o elimina primero/);
      return true;
    },
  );
  assert.equal(events.find((event) => event.id === "dependent-sub")?.deletedAt, null);
});

test("la migración controlada de prueba amplía una sesión antigua sin perder eventos", () => {
  const legacyPlayers = DEMO_PLAYERS.slice(0, 8);
  const matchId = "prueba";
  const lineup = createLineupInitializedEvent({
    id: "legacy-demo-lineup",
    matchId,
    position: { period: 1, minute: 0, order: 1 },
    squadPlayerIds: legacyPlayers.map((player) => player.id),
    onCourtPlayerIds: legacyPlayers.slice(0, 5).map((player) => player.id),
    now: 1,
  });
  const foul = createFoulEvent({
    id: "legacy-demo-foul",
    matchId,
    position: { period: 1, minute: 3, order: 1 },
    side: "FOR",
    playerId: "p1",
    now: 2,
  });
  const legacySession: MatchSession = {
    matchId,
    players: legacyPlayers,
    staff: [],
    period: 1,
    minute: 3,
    periodMinutes: { 1: 3, 2: 0 },
    events: [lineup, foul],
    past: [[lineup]],
    future: [[lineup, foul]],
    lastError: null,
    persistenceStatus: "saved",
    lastSavedAt: 2,
  };

  const upgraded = upgradeDemoSession(legacySession);
  assert.equal(upgraded.players.length, 12);
  assert.equal(upgraded.staff.length, 3);
  assert.equal(upgraded.events.length, 2);
  assert.equal(replayMatch(upgraded.players, upgraded.events).benchPlayerIds.length, 7);
  for (const chronology of [upgraded.events, ...upgraded.past, ...upgraded.future]) {
    const migratedLineup = chronology.find((event) => event.type === "lineup_initialized");
    assert.equal(migratedLineup?.type === "lineup_initialized" ? migratedLineup.squadPlayerIds.length : 0, 12);
  }

  const realSession = { ...legacySession, matchId: "partido-real" };
  assert.equal(upgradeDemoSession(realSession), realSession);
});

test("el fixture prueba-8 ofrece cinco titulares y ocho suplentes", () => {
  useMatchStore.setState({ matches: {} });
  const matchId = "prueba-8";
  useMatchStore.getState().ensureMatch(matchId);
  const session = useMatchStore.getState().matches[matchId];
  const replay = replayMatch(session.players, session.events);
  assert.equal(session.players.length, 13);
  assert.equal(session.players.at(-1)?.id, DEMO_EXTRA_PLAYER.id);
  assert.equal(replay.onCourtPlayerIds.length, 5);
  assert.equal(replay.benchPlayerIds.length, 8);
  assert.equal(session.staff.length, 3);
});

test("orientación canónica y coordenadas de portería no cambian entre periodos ni resize", () => {
  assert.equal(courtOrientationForPeriod(1), CANONICAL_COURT_ORIENTATION);
  assert.equal(courtOrientationForPeriod(2), CANONICAL_COURT_ORIENTATION);
  assert.deepEqual(CANONICAL_COURT_ORIENTATION, {
    ownGoalSide: "LEFT",
    rivalGoalSide: "RIGHT",
    ownAttackDirection: "RIGHT",
  });
  const small = normalizeGoalTargetPoint(180, 120, { left: 80, top: 20, width: 200, height: 200 });
  const large = normalizeGoalTargetPoint(380, 220, { left: 80, top: 20, width: 600, height: 400 });
  assert.deepEqual(small, large);
  assert.equal(classifyGoalTarget({ geometryVersion: 1, x: 0.2, y: 0.3 }), "GOL");
  assert.equal(classifyGoalTarget({ geometryVersion: 1, x: 0.5, y: 0.45 }), "PARADA");
  assert.equal(classifyGoalTarget({ geometryVersion: 1, x: 0.04, y: 0.3 }), "FUERA");
  assert.equal(deriveKeeperBodyZone({ geometryVersion: 1, x: 0.5, y: 0.7 }), "LOWER");
});

test("replay valida amenazas rivales espaciales y deriva el portero real", () => {
  const matchId = "defensive-spatial";
  let events = initialLineup(matchId);
  const goalkeeper = deriveGoalkeeperReference(players, ["p1", "p2", "p3", "p4", "p5"], false);
  assert.deepEqual(goalkeeper, { status: "PLAYER", playerId: "p5", resolution: "REPLAY" });
  events = appendEvents(players, events, [
    createLiveThreatEvent({
      id: "riv-goal",
      matchId,
      position: { period: 1, minute: 3, order: 1 },
      side: "AGAINST",
      origin: { x: 0.72, y: 0.5 },
      outcome: "GOL",
      phase: "TRANSITION",
      defensive: { version: 1, goalTarget: { geometryVersion: 1, x: 0.2, y: 0.3 }, goalkeeper },
      now: 2,
    }),
    createLiveThreatEvent({
      id: "riv-save",
      matchId,
      position: { period: 1, minute: 4, order: 1 },
      side: "AGAINST",
      origin: { x: 0.55, y: 0.25 },
      outcome: "PARADA",
      phase: "POSITIONAL",
      defensive: { version: 1, goalTarget: { geometryVersion: 1, x: 0.5, y: 0.45 }, goalkeeper, keeperBodyZone: "UPPER", saveOutcome: "CATCH" },
      now: 3,
    }),
    createLiveThreatEvent({
      id: "riv-out",
      matchId,
      position: { period: 2, minute: 2, order: 1 },
      side: "AGAINST",
      origin: { x: 0.4, y: 0.8 },
      outcome: "FUERA",
      phase: "SET_PIECE_CORNER",
      defensive: { version: 1, goalTarget: { geometryVersion: 1, x: 0.04, y: 0.3 }, goalkeeper },
      now: 4,
    }),
  ]);
  const replay = replayMatch(players, events);
  assert.deepEqual(replay.issues, []);
  assert.equal(replay.score.against, 1);
  assert.equal(events.filter((event) => event.type === "threat_recorded").length, 3);
});

test("dominio rechaza destinos, porteros y detalles incompatibles pero conserva amenazas legacy", () => {
  const matchId = "defensive-validation";
  const base = initialLineup(matchId);
  const goalkeeper = { status: "PLAYER", playerId: "p5" } as const;
  const invalidGoal = createLiveThreatEvent({
    id: "invalid-goal",
    matchId,
    position: { period: 1, minute: 2, order: 1 },
    side: "AGAINST",
    origin: { x: 0.6, y: 0.4 },
    outcome: "GOL",
    phase: "POSITIONAL",
    defensive: { version: 1, goalTarget: { geometryVersion: 1, x: 0.02, y: 0.2 }, goalkeeper },
  });
  assert.throws(() => appendEvent(players, base, invalidGoal), MatchIntegrityError);
  const incompleteSave = createLiveThreatEvent({
    id: "invalid-save",
    matchId,
    position: { period: 1, minute: 2, order: 1 },
    side: "AGAINST",
    origin: { x: 0.6, y: 0.4 },
    outcome: "PARADA",
    phase: "POSITIONAL",
    defensive: { version: 1, goalTarget: { geometryVersion: 1, x: 0.5, y: 0.45 }, goalkeeper },
  });
  assert.throws(() => appendEvent(players, base, incompleteSave), MatchIntegrityError);
  const legacyLocal = createLiveThreatEvent({
    id: "old-riv",
    matchId,
    position: { period: 1, minute: 2, order: 1 },
    side: "AGAINST",
    origin: { x: 0.6, y: 0.4 },
    outcome: "PARADA",
    phase: "POSITIONAL",
  });
  assert.deepEqual(replayMatch(players, appendEvent(players, base, legacyLocal)).issues, []);
});

test("portero se actualiza tras sustitución y P-J no inventa identidad", () => {
  const matchId = "goalkeeper-history";
  const goalkeeperPlayers = players.map((player) =>
    player.id === "p6" ? { ...player, position: "PORTERO" } : player,
  );
  let events = initialLineup(matchId);
  events = appendEvent(goalkeeperPlayers, events, createSubstitutionEvent({
    id: "keeper-sub",
    matchId,
    position: { period: 1, minute: 5, order: 1 },
    playerOutId: "p5",
    playerInId: "p6",
  }));
  const afterSub = replayMatch(goalkeeperPlayers, events);
  assert.deepEqual(deriveGoalkeeperReference(goalkeeperPlayers, afterSub.onCourtPlayerIds, false), { status: "PLAYER", playerId: "p6", resolution: "REPLAY" });
  assert.deepEqual(deriveGoalkeeperReference(goalkeeperPlayers, afterSub.onCourtPlayerIds, true), { status: "PENDING" });
  assert.deepEqual(deriveGoalkeeperReference(goalkeeperPlayers, ["p1", "p2", "p3", "p4", "p7"], false), { status: "PENDING" });
});

test("rechace ofrece y encadena segunda jugada reversible con fase heredada", () => {
  let transition = reduceLiveInteraction(IDLE_LIVE_INTERACTION, {
    type: "COURT_TAPPED",
    origin: { x: 0.66, y: 0.4 },
    eventId: "seq-a",
  });
  transition = reduceLiveInteraction(transition.state, { type: "GOAL_TARGET_SELECTED", goalTarget: { geometryVersion: 1, x: 0.5, y: 0.45 } });
  transition = reduceLiveInteraction(transition.state, { type: "DEFENSIVE_OUTCOME_SELECTED", outcome: "PARADA" });
  transition = reduceLiveInteraction(transition.state, { type: "KEEPER_BODY_PART_SELECTED", keeperBodyPart: "TORSO" });
  transition = reduceLiveInteraction(transition.state, { type: "SAVE_OUTCOME_SELECTED", saveOutcome: "REBOUND" });
  transition = reduceLiveInteraction(transition.state, { type: "PHASE_SELECTED", phase: "TRANSITION" });
  assert.equal(transition.state.kind, "SECOND_PLAY_OFFER");
  assert.equal(transition.effect?.type === "RECORD_THREAT" && transition.effect.id, "seq-a");
  const firstEffect = transition.effect;
  transition = reduceLiveInteraction(transition.state, { type: "START_SECOND_PLAY" });
  transition = reduceLiveInteraction(transition.state, { type: "COURT_TAPPED", origin: { x: 0.35, y: 0.5 }, eventId: "seq-b" });
  assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.phase, "TRANSITION");
  transition = reduceLiveInteraction(transition.state, { type: "GOAL_TARGET_SELECTED", goalTarget: { geometryVersion: 1, x: 0.25, y: 0.3 } });
  transition = reduceLiveInteraction(transition.state, { type: "DEFENSIVE_OUTCOME_SELECTED", outcome: "GOL" });
  assert.equal(transition.effect?.type === "RECORD_THREAT" && transition.effect.parentEventId, "seq-a");
  assert.equal(transition.effect?.type === "RECORD_THREAT" && transition.effect.sequenceId, "seq-a");
  assert.equal(transition.effect?.type === "RECORD_THREAT" && transition.effect.phase, "TRANSITION");

  useMatchStore.setState({ matches: {} });
  const actions = useMatchStore.getState();
  actions.ensureMatch("sequence-store");
  if (firstEffect?.type === "RECORD_THREAT") actions.recordThreat("sequence-store", { ...firstEffect, id: "seq-a" });
  if (transition.effect?.type === "RECORD_THREAT") actions.recordThreat("sequence-store", { ...transition.effect, id: "seq-b" });
  const session = useMatchStore.getState().matches["sequence-store"];
  assert.deepEqual(replayMatch(session.players, session.events).issues, []);
  assert.throws(() => softDeleteEvent(session.players, session.events, "seq-a"), EventDeletionBlockedError);
});

test("toda amenaza RIV raíz exige fase, también FUERA, y cancelar no crea evento", () => {
  for (const outcome of ["GOL", "FUERA"] as const) {
    let transition = reduceLiveInteraction(IDLE_LIVE_INTERACTION, {
      type: "COURT_TAPPED",
      origin: { x: 0.62, y: 0.45 },
      eventId: `root-${outcome}`,
    });
    transition = reduceLiveInteraction(transition.state, {
      type: "GOAL_TARGET_SELECTED",
      goalTarget: outcome === "FUERA"
        ? { geometryVersion: 2, x: 0.1, y: 0.4 }
        : { geometryVersion: 2, x: 0.5, y: 0.4 },
    });
    if (outcome === "GOL") {
      assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.step, "GOAL_RESULT");
      transition = reduceLiveInteraction(transition.state, { type: "DEFENSIVE_OUTCOME_SELECTED", outcome });
    }
    assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.step, "PHASE");
    assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.phase, null);
    assert.equal(transition.effect, undefined);
    const cancelled = reduceLiveInteraction(transition.state, { type: "CANCEL" });
    assert.equal(cancelled.effect, undefined);
    assert.deepEqual(cancelled.state, IDLE_LIVE_INTERACTION);
  }
});

test("segunda jugada GOL, FUERA y PARADA se guardan con fase heredada sin paso PHASE", () => {
  const armed = {
    kind: "SECOND_PLAY_ARMED",
    parentEventId: "root-rebound",
    sequenceId: "root-rebound",
    phase: "SET_PIECE_CORNER",
  } as const;
  for (const outcome of ["GOL", "FUERA"] as const) {
    let transition = reduceLiveInteraction(armed, {
      type: "COURT_TAPPED",
      origin: { x: 0.48, y: 0.52 },
      eventId: `child-${outcome}`,
    });
    transition = reduceLiveInteraction(transition.state, {
      type: "GOAL_TARGET_SELECTED",
      goalTarget: outcome === "FUERA"
        ? { geometryVersion: 2, x: 0.9, y: 0.4 }
        : { geometryVersion: 2, x: 0.5, y: 0.4 },
    });
    if (outcome === "GOL") {
      transition = reduceLiveInteraction(transition.state, { type: "DEFENSIVE_OUTCOME_SELECTED", outcome });
    }
    assert.equal(transition.effect?.type, "RECORD_THREAT");
    assert.equal(transition.effect?.type === "RECORD_THREAT" && transition.effect.phase, "SET_PIECE_CORNER");
    assert.equal(transition.effect?.type === "RECORD_THREAT" && transition.effect.parentEventId, "root-rebound");
    assert.equal(transition.state.kind, "IDLE");
  }

  let saved = reduceLiveInteraction(armed, {
    type: "COURT_TAPPED",
    origin: { x: 0.42, y: 0.5 },
    eventId: "child-save",
  });
  saved = reduceLiveInteraction(saved.state, {
    type: "GOAL_TARGET_SELECTED",
    goalTarget: { geometryVersion: 2, x: 0.55, y: 0.55 },
  });
  saved = reduceLiveInteraction(saved.state, { type: "DEFENSIVE_OUTCOME_SELECTED", outcome: "PARADA" });
  saved = reduceLiveInteraction(saved.state, { type: "KEEPER_BODY_PART_SELECTED", keeperBodyPart: "RIGHT_ARM_HAND" });
  assert.equal(saved.state.kind === "THREAT_PENDING" && saved.state.step, "DETAILS");
  saved = reduceLiveInteraction(saved.state, { type: "SAVE_OUTCOME_SELECTED", saveOutcome: "CATCH" });
  assert.equal(saved.effect?.type === "RECORD_THREAT" && saved.effect.phase, "SET_PIECE_CORNER");
  assert.equal(saved.effect?.type === "RECORD_THREAT" && saved.effect.defensiveCapture?.keeperBodyPart, "RIGHT_ARM_HAND");
  assert.equal(saved.state.kind, "IDLE");
});

test("captura defensiva persiste destino y deriva el P-J elegido explícitamente", () => {
  useMatchStore.setState({ matches: {} });
  const matchId = "defensive-persistence";
  const actions = useMatchStore.getState();
  actions.ensureMatch(matchId);
  actions.recordThreat(matchId, {
    id: "normal-keeper-shot",
    side: "AGAINST",
    origin: { x: 0.7, y: 0.4 },
    outcome: "PARADA",
    phase: "POSITIONAL",
    defensiveCapture: { goalTarget: { geometryVersion: 2, x: 0.5, y: 0.45 }, keeperBodyPart: "TORSO", saveOutcome: "CLEARANCE" },
  });
  let threat = useMatchStore.getState().matches[matchId].events.find((event) => event.id === "normal-keeper-shot");
  assert.equal(threat?.type === "threat_recorded" && threat.defensive?.goalkeeper.status === "PLAYER" ? threat.defensive.goalkeeper.playerId : null, "p5");
  actions.toggleGameState(matchId, "FLYING_GOALKEEPER", "p2");
  actions.recordThreat(matchId, {
    id: "pj-shot",
    side: "AGAINST",
    origin: { x: 0.4, y: 0.5 },
    outcome: "GOL",
    phase: "FLYING_GOALKEEPER",
    defensiveCapture: { goalTarget: { geometryVersion: 1, x: 0.25, y: 0.3 } },
  });
  const session = useMatchStore.getState().matches[matchId];
  threat = session.events.find((event) => event.id === "pj-shot");
  assert.equal(threat?.type === "threat_recorded" && threat.defensive?.goalkeeper.status === "PLAYER" ? threat.defensive.goalkeeper.playerId : null, "p2");
  assert.equal(threat?.pendingReview, false);
  const storage = new MemoryStorage();
  assert.equal(saveMatchSession(session, storage, 99).ok, true);
  const loaded = loadMatchSession(matchId, storage);
  const loadedThreat = loaded?.events.find((event) => event.id === "normal-keeper-shot");
  assert.equal(loadedThreat?.type === "threat_recorded" && loadedThreat.defensive?.saveOutcome, "CLEARANCE");
});

test("portero defensivo se deriva en la posición exacta y se recalcula al mover la cronología", () => {
  const matchId = "goalkeeper-position";
  const goalkeeperPlayers = players.map((player) =>
    player.id === "p6" ? { ...player, position: "PORTERO" } : player,
  );
  const before = createLiveThreatEvent({
    id: "before-keeper-change",
    matchId,
    position: { period: 1, minute: 4, order: 1 },
    side: "AGAINST",
    origin: { x: 0.7, y: 0.5 },
    outcome: "GOL",
    phase: "TRANSITION",
    defensive: {
      version: 1,
      goalTarget: { geometryVersion: 1, x: 0.24, y: 0.3 },
      goalkeeper: { status: "PLAYER", playerId: "p5" },
    },
  });
  const substitution = createSubstitutionEvent({
    id: "goalkeeper-change",
    matchId,
    position: { period: 1, minute: 5, order: 1 },
    playerOutId: "p5",
    playerInId: "p6",
  });
  const after = createLiveThreatEvent({
    id: "after-keeper-change",
    matchId,
    position: { period: 1, minute: 6, order: 1 },
    side: "AGAINST",
    origin: { x: 0.62, y: 0.4 },
    outcome: "FUERA",
    phase: "POSITIONAL",
    defensive: {
      version: 1,
      goalTarget: { geometryVersion: 1, x: 0.04, y: 0.25 },
      goalkeeper: { status: "PLAYER", playerId: "p6" },
    },
  });
  let events = appendEvents(goalkeeperPlayers, initialLineup(matchId), [before, substitution, after]);
  assert.equal(goalkeeperAtPosition(goalkeeperPlayers, events, before).status, "PLAYER");
  const goalkeeperAfter = goalkeeperAtPosition(goalkeeperPlayers, events, after);
  assert.equal(
    goalkeeperAfter.status === "PLAYER"
      ? goalkeeperAfter.playerId
      : null,
    "p6",
  );

  events = reorderEvent(
    goalkeeperPlayers,
    events,
    "before-keeper-change",
    { period: 1, minute: 6, order: 2 },
  );
  const moved = events.find((event) => event.id === "before-keeper-change");
  assert.equal(
    moved?.type === "threat_recorded" && moved.defensive?.goalkeeper.status === "PLAYER"
      ? moved.defensive.goalkeeper.playerId
      : null,
    "p6",
  );
  assert.deepEqual(replayMatch(goalkeeperPlayers, events).issues, []);
});

test("P-J determinable usa el portero-jugador; banquillo y staff nunca son portero", () => {
  const matchId = "flying-goalkeeper-resolution";
  const flyingPlayers = players.map((player) =>
    player.id === "p6" ? { ...player, position: "PORTERO-JUGADOR" } : player,
  );
  let events = initialLineup(matchId);
  events = appendEvents(flyingPlayers, events, [
    createSubstitutionEvent({
      id: "pj-enters",
      matchId,
      position: { period: 1, minute: 8, order: 1 },
      playerOutId: "p5",
      playerInId: "p6",
    }),
    createGameStateEvent({
      id: "pj-on",
      matchId,
      position: { period: 1, minute: 8, order: 2 },
      state: "FLYING_GOALKEEPER",
      active: true,
    }),
  ]);
  const snapshot = replayMatch(flyingPlayers, events);
  assert.deepEqual(
    deriveGoalkeeperReference(flyingPlayers, snapshot.onCourtPlayerIds, true),
    { status: "PLAYER", playerId: "p6", resolution: "REPLAY" },
  );

  const benchGoalkeeper = createLiveThreatEvent({
    id: "bench-is-not-keeper",
    matchId,
    position: { period: 1, minute: 9, order: 1 },
    side: "AGAINST",
    origin: { x: 0.5, y: 0.5 },
    outcome: "GOL",
    phase: "FLYING_GOALKEEPER",
    defensive: {
      version: 1,
      goalTarget: { geometryVersion: 1, x: 0.22, y: 0.3 },
      goalkeeper: { status: "PLAYER", playerId: "p7", resolution: "MANUAL" },
    },
  });
  const staffGoalkeeper = {
    ...benchGoalkeeper,
    id: "staff-is-not-keeper",
    defensive: {
      ...benchGoalkeeper.defensive!,
      goalkeeper: { status: "PLAYER", playerId: "staff-coach", resolution: "MANUAL" } as const,
    },
  };
  assert.ok(
    replayMatch(flyingPlayers, [...events, benchGoalkeeper]).issues.some(
      (issue) => issue.code === "INVALID_GOALKEEPER",
    ),
  );
  assert.ok(
    replayMatch(flyingPlayers, [...events, staffGoalkeeper]).issues.some(
      (issue) => issue.code === "INVALID_GOALKEEPER",
    ),
  );
});

test("editor defensivo limpia incompatibilidades PARADA→GOL y exige detalle GOL→PARADA", () => {
  const matchId = "defensive-edit";
  let events = appendEvent(
    players,
    initialLineup(matchId),
    createLiveThreatEvent({
      id: "editable-riv",
      matchId,
      position: { period: 1, minute: 7, order: 1 },
      side: "AGAINST",
      origin: { x: 0.68, y: 0.44 },
      outcome: "PARADA",
      phase: "POSITIONAL",
      defensive: {
        version: 1,
        goalTarget: { geometryVersion: 1, x: 0.5, y: 0.45 },
        goalkeeper: { status: "PLAYER", playerId: "p5" },
        keeperBodyZone: "UPPER",
        saveOutcome: "CATCH",
      },
    }),
  );
  events = editEvent(players, events, "editable-riv", {
    threat: {
      outcome: "GOL",
      defensive: {
        version: 1,
        goalTarget: { geometryVersion: 1, x: 0.22, y: 0.3 },
        goalkeeper: { status: "PLAYER", playerId: "p5" },
      },
    },
  });
  let edited = events.find((event) => event.id === "editable-riv");
  assert.equal(edited?.type === "threat_recorded" && edited.outcome, "GOL");
  assert.equal(edited?.type === "threat_recorded" && edited.defensive?.saveOutcome, undefined);
  assert.equal(replayMatch(players, events).score.against, 1);

  assert.throws(
    () => editEvent(players, events, "editable-riv", {
      threat: {
        outcome: "PARADA",
        defensive: {
          version: 1,
          goalTarget: { geometryVersion: 1, x: 0.5, y: 0.45 },
          goalkeeper: { status: "PLAYER", playerId: "p5" },
          keeperBodyZone: "UPPER",
        },
      },
    }),
    MatchIntegrityError,
  );
  events = editEvent(players, events, "editable-riv", {
    threat: {
      outcome: "PARADA",
      defensive: {
        version: 1,
        goalTarget: { geometryVersion: 1, x: 0.46, y: 0.7 },
        goalkeeper: { status: "PLAYER", playerId: "p5" },
        keeperBodyZone: "LOWER",
        saveOutcome: "CLEARANCE",
      },
    },
  });
  edited = events.find((event) => event.id === "editable-riv");
  assert.equal(edited?.type === "threat_recorded" && edited.defensive?.saveOutcome, "CLEARANCE");
  assert.equal(replayMatch(players, events).score.against, 0);
});

test("segunda jugada A→B→C hereda fase sin interacción y cancela sin eventos fantasma", () => {
  const start = (id: string, state = IDLE_LIVE_INTERACTION) =>
    reduceLiveInteraction(state, {
      type: "COURT_TAPPED",
      origin: { x: 0.6, y: 0.5 },
      eventId: id,
    });
  let transition = start("chain-a");
  transition = reduceLiveInteraction(transition.state, {
    type: "GOAL_TARGET_SELECTED",
    goalTarget: { geometryVersion: 1, x: 0.5, y: 0.45 },
  });
  transition = reduceLiveInteraction(transition.state, { type: "DEFENSIVE_OUTCOME_SELECTED", outcome: "PARADA" });
  transition = reduceLiveInteraction(transition.state, { type: "KEEPER_BODY_PART_SELECTED", keeperBodyPart: "TORSO" });
  transition = reduceLiveInteraction(transition.state, { type: "SAVE_OUTCOME_SELECTED", saveOutcome: "REBOUND" });
  transition = reduceLiveInteraction(transition.state, { type: "PHASE_SELECTED", phase: "TRANSITION" });
  const a = transition.effect;
  transition = reduceLiveInteraction(transition.state, { type: "START_SECOND_PLAY" });
  transition = start("chain-b", transition.state);
  transition = reduceLiveInteraction(transition.state, {
    type: "GOAL_TARGET_SELECTED",
    goalTarget: { geometryVersion: 1, x: 0.46, y: 0.7 },
  });
  transition = reduceLiveInteraction(transition.state, { type: "DEFENSIVE_OUTCOME_SELECTED", outcome: "PARADA" });
  transition = reduceLiveInteraction(transition.state, { type: "KEEPER_BODY_PART_SELECTED", keeperBodyPart: "LEFT_LEG_FOOT" });
  transition = reduceLiveInteraction(transition.state, { type: "SAVE_OUTCOME_SELECTED", saveOutcome: "REBOUND" });
  const b = transition.effect;
  assert.equal(b?.type === "RECORD_THREAT" && b.parentEventId, "chain-a");
  assert.equal(b?.type === "RECORD_THREAT" && b.phase, "TRANSITION");
  assert.equal(transition.state.kind, "SECOND_PLAY_OFFER");
  transition = reduceLiveInteraction(transition.state, { type: "START_SECOND_PLAY" });
  transition = start("chain-c", transition.state);
  transition = reduceLiveInteraction(transition.state, {
    type: "GOAL_TARGET_SELECTED",
    goalTarget: { geometryVersion: 1, x: 0.2, y: 0.3 },
  });
  transition = reduceLiveInteraction(transition.state, { type: "DEFENSIVE_OUTCOME_SELECTED", outcome: "GOL" });
  const c = transition.effect;
  assert.equal(c?.type === "RECORD_THREAT" && c.parentEventId, "chain-b");
  assert.equal(c?.type === "RECORD_THREAT" && c.sequenceId, "chain-a");
  assert.equal(c?.type === "RECORD_THREAT" && c.phase, "TRANSITION");
  assert.equal(transition.state.kind, "IDLE");

  for (const effect of [a, b, c]) assert.equal(effect?.type, "RECORD_THREAT");
  let cancelled = start("cancelled-before-target");
  cancelled = reduceLiveInteraction(cancelled.state, { type: "CANCEL" });
  assert.deepEqual(cancelled, { state: IDLE_LIVE_INTERACTION });
  const cancelOffer = reduceLiveInteraction(
    { kind: "SECOND_PLAY_OFFER", parentEventId: "chain-a", sequenceId: "chain-a", phase: "TRANSITION" },
    { type: "CANCEL" },
  );
  assert.equal(cancelOffer.effect, undefined);
  assert.deepEqual(cancelOffer.state, IDLE_LIVE_INTERACTION);

  const cancelChild = reduceLiveInteraction(
    { kind: "SECOND_PLAY_ARMED", parentEventId: "chain-a", sequenceId: "chain-a", phase: "TRANSITION" },
    { type: "COURT_TAPPED", origin: { x: 0.4, y: 0.4 }, eventId: "cancelled-child" },
  );
  const cancelledIncomplete = reduceLiveInteraction(cancelChild.state, { type: "CANCEL" });
  assert.equal(cancelledIncomplete.effect, undefined);
  assert.deepEqual(cancelledIncomplete.state, IDLE_LIVE_INTERACTION);
});

test("editar la fase ROOT sincroniza toda la secuencia y el hijo no admite una fase divergente", () => {
  const matchId = "sequence-phase-edit";
  const goalkeeper = { status: "PLAYER", playerId: "p5" } as const;
  const root = createLiveThreatEvent({
    id: "phase-a", matchId, position: { period: 1, minute: 4, order: 1 },
    side: "AGAINST", origin: { x: 0.6, y: 0.4 }, outcome: "PARADA", phase: "TRANSITION",
    defensive: { version: 2, goalTarget: { geometryVersion: 2, x: 0.5, y: 0.5 }, goalkeeper, keeperBodyPart: "TORSO", saveOutcome: "REBOUND" },
  });
  const child = createLiveThreatEvent({
    id: "phase-b", matchId, position: { period: 1, minute: 4, order: 2 },
    side: "AGAINST", origin: { x: 0.4, y: 0.5 }, outcome: "PARADA", phase: "TRANSITION",
    sequenceId: root.id, parentEventId: root.id,
    defensive: { version: 2, goalTarget: { geometryVersion: 2, x: 0.45, y: 0.7 }, goalkeeper, keeperBodyPart: "LEFT_LEG_FOOT", saveOutcome: "REBOUND" },
  });
  const grandchild = createLiveThreatEvent({
    id: "phase-c", matchId, position: { period: 1, minute: 4, order: 3 },
    side: "AGAINST", origin: { x: 0.3, y: 0.6 }, outcome: "GOL", phase: "TRANSITION",
    sequenceId: root.id, parentEventId: child.id,
    defensive: { version: 2, goalTarget: { geometryVersion: 2, x: 0.7, y: 0.3 }, goalkeeper },
  });
  let events = appendEvents(players, initialLineup(matchId), [root, child, grandchild]);
  events = editEvent(players, events, root.id, { threat: { phase: "POSITIONAL" } }, 99);
  for (const event of events.filter((candidate) => candidate.type === "threat_recorded")) {
    assert.equal(event.phase, "POSITIONAL");
    assert.equal(effectiveThreatPhase(events, event), "POSITIONAL");
  }
  assert.throws(
    () => editEvent(players, events, child.id, { threat: { phase: "TRANSITION" } }),
    /se edita desde la amenaza raíz/,
  );
});

test("persistencia local corrige fases divergentes antiguas usando la raíz", () => {
  const matchId = "legacy-divergent-sequence";
  const base = createSession(matchId);
  const goalkeeper = { status: "PLAYER", playerId: "p5" } as const;
  const root = createLiveThreatEvent({
    id: "legacy-phase-a", matchId, position: { period: 1, minute: 3, order: 1 },
    side: "AGAINST", origin: { x: 0.6, y: 0.5 }, outcome: "PARADA", phase: "TRANSITION",
    defensive: { version: 2, goalTarget: { geometryVersion: 2, x: 0.5, y: 0.5 }, goalkeeper, keeperBodyPart: "TORSO", saveOutcome: "REBOUND" },
  });
  const child = createLiveThreatEvent({
    id: "legacy-phase-b", matchId, position: { period: 1, minute: 3, order: 2 },
    side: "AGAINST", origin: { x: 0.4, y: 0.4 }, outcome: "GOL", phase: "TRANSITION",
    sequenceId: root.id, parentEventId: root.id,
    defensive: { version: 2, goalTarget: { geometryVersion: 2, x: 0.4, y: 0.4 }, goalkeeper },
  });
  const storage = new MemoryStorage();
  const session = {
    ...base,
    minute: 3,
    periodMinutes: { 1: 3, 2: 0 },
    events: appendEvents(base.players, base.events, [root, child]),
  };
  assert.equal(saveMatchSession(session, storage, 10).ok, true);
  const raw = JSON.parse(storage.getItem(matchStorageKey(matchId))!);
  raw.session.events = raw.session.events.map((event: MatchEvent) =>
    event.id === child.id ? { ...event, phase: "POSITIONAL" } : event,
  );
  storage.setItem(matchStorageKey(matchId), JSON.stringify(raw));
  const loaded = loadMatchSession(matchId, storage);
  const loadedChild = loaded?.events.find((event) => event.id === child.id);
  assert.equal(loadedChild?.type === "threat_recorded" && loadedChild.phase, "TRANSITION");
  assert.deepEqual(replayMatch(loaded?.players ?? [], loaded?.events ?? []).issues, []);
});

test("blocaje y despeje cierran la secuencia; editar o borrar un padre activo queda protegido", () => {
  for (const saveOutcome of ["CATCH", "CLEARANCE"] as const) {
    let transition = reduceLiveInteraction(IDLE_LIVE_INTERACTION, {
      type: "COURT_TAPPED",
      origin: { x: 0.55, y: 0.5 },
      eventId: `closed-${saveOutcome}`,
    });
    transition = reduceLiveInteraction(transition.state, { type: "GOAL_TARGET_SELECTED", goalTarget: { geometryVersion: 1, x: 0.5, y: 0.45 } });
    transition = reduceLiveInteraction(transition.state, { type: "DEFENSIVE_OUTCOME_SELECTED", outcome: "PARADA" });
    transition = reduceLiveInteraction(transition.state, { type: "KEEPER_BODY_PART_SELECTED", keeperBodyPart: "TORSO" });
    transition = reduceLiveInteraction(transition.state, { type: "SAVE_OUTCOME_SELECTED", saveOutcome });
    transition = reduceLiveInteraction(transition.state, { type: "PHASE_SELECTED", phase: "POSITIONAL" });
    assert.equal(transition.state.kind, "IDLE");
  }

  const matchId = "protected-chain";
  const root = createLiveThreatEvent({
    id: "protected-a",
    matchId,
    position: { period: 1, minute: 5, order: 1 },
    side: "AGAINST",
    origin: { x: 0.5, y: 0.5 },
    outcome: "PARADA",
    phase: "POSITIONAL",
    defensive: { version: 1, goalTarget: { geometryVersion: 1, x: 0.5, y: 0.45 }, goalkeeper: { status: "PLAYER", playerId: "p5" }, keeperBodyZone: "UPPER", saveOutcome: "REBOUND" },
  });
  const child = createLiveThreatEvent({
    id: "protected-b",
    matchId,
    position: { period: 1, minute: 5, order: 2 },
    side: "AGAINST",
    origin: { x: 0.4, y: 0.4 },
    outcome: "GOL",
    phase: "POSITIONAL",
    sequenceId: root.id,
    parentEventId: root.id,
    defensive: { version: 1, goalTarget: { geometryVersion: 1, x: 0.2, y: 0.3 }, goalkeeper: { status: "PLAYER", playerId: "p5" } },
  });
  const events = appendEvents(players, initialLineup(matchId), [root, child]);
  assert.throws(() => softDeleteEvent(players, events, root.id), EventDeletionBlockedError);
  assert.throws(
    () => editEvent(players, events, root.id, { threat: { sequenceId: "another-sequence" } }),
    MatchIntegrityError,
  );
  const divergentChild = { ...child, phase: "TRANSITION" as const };
  assert.throws(
    () => appendEvents(players, initialLineup(matchId), [root, divergentChild]),
    MatchIntegrityError,
  );
});

test("una amenaza RIV local anterior sin destino persiste y carga sin inventar datos", () => {
  const matchId = "legacy-riv-persistence";
  const legacyThreat = createLiveThreatEvent({
    id: "legacy-riv-no-target",
    matchId,
    position: { period: 1, minute: 6, order: 1 },
    side: "AGAINST",
    origin: { x: 0.62, y: 0.33 },
    outcome: "GOL",
    phase: "TRANSITION",
  });
  const events = appendEvent(players, initialLineup(matchId), legacyThreat);
  const session: MatchSession = {
    matchId,
    players,
    staff: [],
    period: 1,
    minute: 6,
    periodMinutes: { 1: 6, 2: 0 },
    events,
    past: [],
    future: [],
    lastError: null,
    persistenceStatus: "saved",
    lastSavedAt: 1,
  };
  const storage = new MemoryStorage();
  assert.equal(saveMatchSession(session, storage, 2).ok, true);
  const loaded = loadMatchSession(matchId, storage);
  const loadedThreat = loaded?.events.find((event) => event.id === legacyThreat.id);
  assert.equal(loadedThreat?.type === "threat_recorded" && loadedThreat.defensive, undefined);
  assert.equal(replayMatch(players, loaded?.events ?? []).score.against, 1);
});

test("firewall exige cinco jugadores salvo inferioridad causada por roja activa", () => {
  const matchId = "lineup-firewall";
  const initialReplay = replayMatch(players, initialLineup(matchId));
  assert.equal(initialReplay.lineupValidation.valid, true);
  assert.equal(initialReplay.lineupValidation.actualPlayersOnCourt, 5);
  const noKeeperLineup = createLineupInitializedEvent({
    id: "no-keeper-lineup",
    matchId: "no-keeper",
    position: { period: 1, minute: 0, order: 1 },
    squadPlayerIds: players.map((player) => player.id),
    onCourtPlayerIds: ["p1", "p2", "p3", "p4", "p6"],
  });
  const noKeeperReplay = replayMatch(players, [noKeeperLineup]);
  assert.equal(noKeeperReplay.lineupValidation.actualPlayersOnCourt, 5);
  assert.ok(noKeeperReplay.lineupValidation.reasons.some((reason) => reason.code === "GOALKEEPER_UNRESOLVED"));
  const red = createCardEvent({
    id: "field-red",
    matchId,
    position: { period: 1, minute: 6, order: 1 },
    side: "FOR",
    color: "RED",
    playerId: "p1",
  });
  const reduction = createSubstitutionEvent({
    id: "field-red-reduction",
    matchId,
    position: { period: 1, minute: 6, order: 2 },
    playerOutId: "p1",
    playerInId: INFERIORITY_SLOT_ID,
    relatedCardEventId: red.id,
  });
  let events = appendEvents(players, initialLineup(matchId), [red, reduction]);
  let replay = replayMatch(players, events);
  assert.equal(replay.lineupValidation.valid, true);
  assert.equal(replay.lineupValidation.actualPlayersOnCourt, 4);
  assert.equal(replay.lineupValidation.expectedPlayersOnCourt, 4);
  assert.equal(replay.lineupValidation.inferiorityCause?.cardEventId, red.id);

  events = editEvent(players, events, red.id, { card: { color: "YELLOW" } });
  replay = replayMatch(players, events);
  assert.equal(replay.lineupValidation.captureBlocked, true);
  assert.equal(replay.inferiorityActive, false);
  assert.ok(replay.lineupValidation.reasons.some((reason) => reason.code === "UNJUSTIFIED_INFERIORITY"));

  events = editEvent(players, events, red.id, { card: { color: "RED" } });
  assert.equal(replayMatch(players, events).lineupValidation.valid, true);
  events = softDeleteEvent(players, events, red.id);
  assert.equal(replayMatch(players, events).lineupValidation.captureBlocked, true);
  events = restoreEvent(players, events, red.id);
  assert.equal(replayMatch(players, events).lineupValidation.valid, true);
});

test("roja de banquillo no justifica inferioridad y expulsar al portero exige reparación", () => {
  const benchMatch = "bench-red-firewall";
  const benchRed = createCardEvent({
    id: "bench-red",
    matchId: benchMatch,
    position: { period: 1, minute: 3, order: 1 },
    side: "FOR",
    color: "RED",
    playerId: "p6",
  });
  const malformedReduction = createSubstitutionEvent({
    id: "bad-reduction",
    matchId: benchMatch,
    position: { period: 1, minute: 3, order: 2 },
    playerOutId: "p1",
    playerInId: INFERIORITY_SLOT_ID,
    relatedCardEventId: benchRed.id,
  });
  const malformedReplay = replayMatch(players, [
    ...initialLineup(benchMatch),
    benchRed,
    malformedReduction,
  ]);
  assert.equal(malformedReplay.lineupValidation.captureBlocked, true);
  assert.equal(malformedReplay.inferiorityActive, false);

  const staffMatch = "staff-red-firewall";
  const staffRed = createCardEvent({
    id: "staff-red-firewall-card",
    matchId: staffMatch,
    position: { period: 1, minute: 3, order: 1 },
    side: "FOR",
    color: "RED",
    staffId: DEMO_STAFF[0].id,
  });
  const staffReduction = createSubstitutionEvent({
    id: "staff-bad-reduction",
    matchId: staffMatch,
    position: { period: 1, minute: 3, order: 2 },
    playerOutId: "p1",
    playerInId: INFERIORITY_SLOT_ID,
    relatedCardEventId: staffRed.id,
  });
  const staffReplay = replayMatch(players, [
    ...initialLineup(staffMatch),
    staffRed,
    staffReduction,
  ]);
  assert.equal(staffReplay.lineupValidation.captureBlocked, true);
  assert.equal(staffReplay.inferiorityActive, false);

  const keeperMatch = "keeper-red-firewall";
  const keeperRed = createCardEvent({
    id: "keeper-red",
    matchId: keeperMatch,
    position: { period: 1, minute: 4, order: 1 },
    side: "FOR",
    color: "RED",
    playerId: "p5",
  });
  const keeperReduction = createSubstitutionEvent({
    id: "keeper-reduction",
    matchId: keeperMatch,
    position: { period: 1, minute: 4, order: 2 },
    playerOutId: "p5",
    playerInId: INFERIORITY_SLOT_ID,
    relatedCardEventId: keeperRed.id,
  });
  const keeperReplay = replayMatch(players, appendEvents(
    players,
    initialLineup(keeperMatch),
    [keeperRed, keeperReduction],
  ));
  assert.equal(keeperReplay.inferiorityActive, true);
  assert.equal(keeperReplay.lineupValidation.actualPlayersOnCourt, 4);
  assert.ok(keeperReplay.lineupValidation.reasons.some((reason) => reason.code === "GOALKEEPER_UNRESOLVED"));
});

test("firewall bloquea captura nueva pero permite reparar la alineación sin borrar eventos", () => {
  useMatchStore.setState({ matches: {} });
  const matchId = "firewall-store";
  const session = createSession(matchId);
  const red = createCardEvent({
    id: "deleted-cause",
    matchId,
    position: { period: 1, minute: 1, order: 1 },
    side: "FOR",
    color: "RED",
    playerId: "p1",
  });
  const reduction = createSubstitutionEvent({
    id: "orphan-reduction",
    matchId,
    position: { period: 1, minute: 1, order: 2 },
    playerOutId: "p1",
    playerInId: INFERIORITY_SLOT_ID,
    relatedCardEventId: red.id,
  });
  const events = softDeleteEvent(
    session.players,
    appendEvents(session.players, session.events, [red, reduction]),
    red.id,
  );
  useMatchStore.setState({ matches: { [matchId]: { ...session, events, minute: 2, periodMinutes: { 1: 2, 2: 0 } } } });
  const actions = useMatchStore.getState();
  const before = events.length;
  actions.recordThreat(matchId, {
    side: "AGAINST",
    origin: { x: 0.6, y: 0.5 },
    outcome: "FUERA",
    phase: "POSITIONAL",
    defensiveCapture: { goalTarget: { geometryVersion: 2, x: 0.1, y: 0.4 } },
  });
  let current = useMatchStore.getState().matches[matchId];
  assert.equal(current.events.length, before);
  assert.match(current.lastError ?? "", /Alineación bloqueada/);

  actions.swapPlayer(matchId, INFERIORITY_SLOT_ID, "p6");
  current = useMatchStore.getState().matches[matchId];
  assert.equal(replayMatch(current.players, current.events).lineupValidation.valid, true);
  assert.equal(current.events.some((event) => event.id === "orphan-reduction"), true);
});

test("P-J requiere identidad explícita en pista y replay la conserva", () => {
  useMatchStore.setState({ matches: {} });
  const matchId = "explicit-flying-goalkeeper";
  const actions = useMatchStore.getState();
  actions.ensureMatch(matchId);
  actions.toggleGameState(matchId, "FLYING_GOALKEEPER");
  let session = useMatchStore.getState().matches[matchId];
  assert.equal(session.events.length, 1);
  assert.match(session.lastError ?? "", /Selecciona/);

  actions.toggleGameState(matchId, "FLYING_GOALKEEPER", "p2");
  session = useMatchStore.getState().matches[matchId];
  const replay = replayMatch(session.players, session.events);
  assert.equal(replay.flyingGoalkeeperActive, true);
  assert.equal(replay.flyingGoalkeeperPlayerId, "p2");
  assert.deepEqual(replay.lineupValidation.goalkeeper, {
    status: "PLAYER",
    playerId: "p2",
    resolution: "REPLAY",
  });
  assert.equal(replay.lineupValidation.actualPlayersOnCourt, 5);
});

test("geometría V3 conserva coordenadas reales y mantiene V2 congelada", () => {
  const center = normalizeGoalTargetPoint(250, 250, {
    left: 0,
    top: 0,
    width: 500,
    height: 500,
  });
  assert.deepEqual(center, {
    geometryVersion: GOAL_TARGET_GEOMETRY_VERSION,
    x: 0.5,
    y: 0.5,
  });
  assert.equal(classifyGoalTarget(center), "PARADA");
  assert.equal(isOutcomeCompatibleWithGoalTarget(center, "PARADA"), true);
  assert.equal(isOutcomeCompatibleWithGoalTarget(center, "GOL"), true);
  const nearPost = { geometryVersion: 2 as const, x: 0.25, y: 0.5 };
  assert.equal(classifyGoalTarget(nearPost), "PARADA");
  const outside = { geometryVersion: 2 as const, x: 0.1, y: 0.5 };
  assert.equal(classifyGoalTarget(outside), "FUERA");
  assert.equal(isOutcomeCompatibleWithGoalTarget(outside, "GOL"), false);
  assert.equal(isInsideGoalFrame({ geometryVersion: 2, x: 0.219, y: 0.5 }), false);
  assert.equal(isInsideGoalFrame({ geometryVersion: 3, x: 0.219, y: 0.5 }), true);
});

test("los bordes visuales V3 distinguen interior y exterior junto a postes y larguero", () => {
  const epsilon = 0.0001;
  const point = (x: number, y: number) => ({
    geometryVersion: GOAL_TARGET_GEOMETRY_VERSION,
    x,
    y,
  });
  const insideLeft = point(GOAL_FRAME.left + epsilon, 0.5);
  const outsideLeft = point(GOAL_FRAME.left - epsilon, 0.5);
  const insideRight = point(GOAL_FRAME.right - epsilon, 0.5);
  const outsideRight = point(GOAL_FRAME.right + epsilon, 0.5);
  const insideCrossbar = point(0.5, GOAL_FRAME.top + epsilon);
  const outsideCrossbar = point(0.5, GOAL_FRAME.top - epsilon);

  assert.equal(isInsideGoalFrame(insideLeft), true);
  assert.equal(classifyGoalTarget(outsideLeft), "FUERA");
  assert.equal(isInsideGoalFrame(insideRight), true);
  assert.equal(classifyGoalTarget(outsideRight), "FUERA");
  assert.equal(isInsideGoalFrame(insideCrossbar), true);
  assert.equal(classifyGoalTarget(outsideCrossbar), "FUERA");
  assert.equal(
    isInsideGoalFrame(
      point(GOAL_FRAME.left + epsilon, GOAL_FRAME.top + epsilon),
    ),
    true,
  );
  assert.equal(
    classifyGoalTarget(
      point(GOAL_FRAME.left - epsilon, GOAL_FRAME.top - epsilon),
    ),
    "FUERA",
  );
  assert.equal(isInsideGoalFrame(point(0.5, 0.5)), true);
});

test("todo destino interior admite GOL y PARADA sin que la silueta decida el resultado", () => {
  const epsilon = 0.001;
  const targets = [
    { label: "centro", x: 0.5, y: 0.5 },
    { label: "poste izquierdo", x: GOAL_FRAME.left + epsilon, y: 0.55 },
    { label: "poste derecho", x: GOAL_FRAME.right - epsilon, y: 0.55 },
    { label: "bajo larguero", x: 0.5, y: GOAL_FRAME.top + epsilon },
    { label: "escuadra izquierda", x: GOAL_FRAME.left + epsilon, y: GOAL_FRAME.top + epsilon },
    { label: "escuadra derecha", x: GOAL_FRAME.right - epsilon, y: GOAL_FRAME.top + epsilon },
    { label: "raso", x: 0.5, y: GOAL_FRAME.bottom - epsilon },
    { label: "cuerpo visual", x: 0.5, y: 0.55 },
  ];

  for (const target of targets) {
    const goalTarget = { geometryVersion: GOAL_TARGET_GEOMETRY_VERSION, x: target.x, y: target.y } as const;
    assert.equal(isInsideGoalFrame(goalTarget), true, target.label);
    for (const outcome of ["GOL", "PARADA"] as const) {
      let transition = reduceLiveInteraction(IDLE_LIVE_INTERACTION, {
        type: "COURT_TAPPED",
        origin: { x: 0.5, y: 0.5 },
        eventId: `${target.label}-${outcome}`,
      });
      transition = reduceLiveInteraction(transition.state, { type: "GOAL_TARGET_SELECTED", goalTarget });
      assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.step, "GOAL_RESULT", target.label);
      assert.deepEqual(transition.state.kind === "THREAT_PENDING" && transition.state.goalTarget, goalTarget);
      transition = reduceLiveInteraction(transition.state, { type: "DEFENSIVE_OUTCOME_SELECTED", outcome });
      assert.equal(
        transition.state.kind === "THREAT_PENDING" && transition.state.step,
        outcome === "GOL" ? "PHASE" : "KEEPER_BODY_PART",
        `${target.label} debe admitir ${outcome}`,
      );
      assert.deepEqual(transition.state.kind === "THREAT_PENDING" && transition.state.goalTarget, goalTarget);
    }
  }
});

test("los destinos exteriores producen FUERA sin pedir resultado ni intervención", () => {
  const epsilon = 0.001;
  const targets = [
    { x: GOAL_FRAME.left - epsilon, y: 0.5 },
    { x: GOAL_FRAME.right + epsilon, y: 0.5 },
    { x: 0.5, y: GOAL_FRAME.top - epsilon },
    { x: 0.5, y: GOAL_FRAME.bottom + epsilon },
    { x: GOAL_FRAME.left - epsilon, y: GOAL_FRAME.top - epsilon },
    { x: GOAL_FRAME.right + epsilon, y: GOAL_FRAME.top - epsilon },
  ];
  for (const target of targets) {
    const goalTarget = { geometryVersion: GOAL_TARGET_GEOMETRY_VERSION, ...target } as const;
    let transition = reduceLiveInteraction(IDLE_LIVE_INTERACTION, {
      type: "COURT_TAPPED",
      origin: { x: 0.5, y: 0.5 },
      eventId: `outside-${target.x}-${target.y}`,
    });
    transition = reduceLiveInteraction(transition.state, { type: "GOAL_TARGET_SELECTED", goalTarget });
    assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.outcome, "FUERA");
    assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.step, "PHASE");
    assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.keeperBodyPart, null);
    assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.saveOutcome, null);
  }
});

test("target y bodyPart son independientes y las seis partes preservan las coordenadas", () => {
  const goalTarget = {
    geometryVersion: GOAL_TARGET_GEOMETRY_VERSION,
    x: GOAL_FRAME.right - 0.002,
    y: GOAL_FRAME.bottom - 0.002,
  } as const;
  const parts = ["HEAD", "TORSO", "LEFT_ARM_HAND", "RIGHT_ARM_HAND", "LEFT_LEG_FOOT", "RIGHT_LEG_FOOT"] as const;
  for (const keeperBodyPart of parts) {
    let transition = reduceLiveInteraction(IDLE_LIVE_INTERACTION, {
      type: "COURT_TAPPED",
      origin: { x: 0.5, y: 0.5 },
      eventId: `independent-${keeperBodyPart}`,
    });
    transition = reduceLiveInteraction(transition.state, { type: "GOAL_TARGET_SELECTED", goalTarget });
    transition = reduceLiveInteraction(transition.state, { type: "DEFENSIVE_OUTCOME_SELECTED", outcome: "PARADA" });
    transition = reduceLiveInteraction(transition.state, { type: "KEEPER_BODY_PART_SELECTED", keeperBodyPart });
    assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.step, "DETAILS");
    assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.keeperBodyPart, keeperBodyPart);
    assert.deepEqual(transition.state.kind === "THREAT_PENDING" && transition.state.goalTarget, goalTarget);
    transition = reduceLiveInteraction(transition.state, { type: "SAVE_OUTCOME_SELECTED", saveOutcome: "CATCH" });
    assert.deepEqual(transition.state.kind === "THREAT_PENDING" && transition.state.goalTarget, goalTarget);
  }
});

test("resize del GoalTargetPicker no altera coordenadas ni clasificación V3", () => {
  const small = normalizeGoalTargetPoint(218, 125, {
    left: 100,
    top: 50,
    width: 500,
    height: 320,
  });
  const large = normalizeGoalTargetPoint(336, 200, {
    left: 100,
    top: 50,
    width: 1000,
    height: 640,
  });
  assert.deepEqual(small, large);
  assert.equal(isInsideGoalFrame(small), true);
  assert.equal(classifyGoalTarget(small) === "FUERA", false);
});

test("las seis zonas táctiles del portero son completas, normalizadas y no ambiguas", () => {
  const expectedParts = [
    "HEAD",
    "TORSO",
    "RIGHT_ARM_HAND",
    "LEFT_ARM_HAND",
    "RIGHT_LEG_FOOT",
    "LEFT_LEG_FOOT",
  ].sort();
  const entries = Object.entries(KEEPER_BODY_HITBOXES);
  assert.deepEqual(entries.map(([part]) => part).sort(), expectedParts);

  for (const [, hitbox] of entries) {
    assert.ok(hitbox.left >= 0 && hitbox.top >= 0);
    assert.ok(hitbox.width >= 0.18 && hitbox.height >= 0.2);
    assert.ok(hitbox.left + hitbox.width <= 1);
    assert.ok(hitbox.top + hitbox.height <= 1);
  }

  const compactPortraitPicker = { width: 354, height: 354 * 16 / 25 };
  for (const [part, hitbox] of entries) {
    const physicalWidth = compactPortraitPicker.width * KEEPER_BODY_SURFACE.width * hitbox.width;
    const physicalHeight = compactPortraitPicker.height * KEEPER_BODY_SURFACE.height * hitbox.height;
    assert.ok(physicalWidth >= 44, `${part} necesita al menos 44 px de ancho`);
    assert.ok(physicalHeight >= 44, `${part} necesita al menos 44 px de alto`);
  }

  for (let first = 0; first < entries.length; first += 1) {
    for (let second = first + 1; second < entries.length; second += 1) {
      const a = entries[first][1];
      const b = entries[second][1];
      const overlapWidth = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
      const overlapHeight = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
      assert.equal(overlapWidth > 0 && overlapHeight > 0, false, `${entries[first][0]} y ${entries[second][0]} no deben solaparse`);
    }
  }
});

test("prueba-porteria es un fixture limpio, aislado y reiniciable", () => {
  const demo = createSession(CLEAN_GOAL_DEMO_MATCH_ID);
  const replay = replayMatch(demo.players, demo.events);
  assert.equal(demo.period, 1);
  assert.equal(demo.minute, 0);
  assert.equal(demo.events.length, 1);
  assert.equal(replay.onCourtPlayerIds.length, 5);
  assert.equal(replay.benchPlayerIds.length, 7);
  assert.equal(demo.staff.length, 3);
  assert.deepEqual(replay.score, { for: 0, against: 0 });
  assert.deepEqual(replay.discipline, {
    for: { fouls: 0, yellowCards: 0, redCards: 0 },
    against: { fouls: 0, yellowCards: 0, redCards: 0 },
  });
});

test("cuenta atrás deriva 20→0 sin duplicar el minuto transcurrido", () => {
  assert.equal(deriveRemainingMinute(0), 20);
  assert.equal(deriveRemainingMinute(8), 12);
  assert.equal(deriveRemainingMinute(20), 0);
  assert.equal(deriveRemainingMinute(-4), 20);
  assert.equal(deriveRemainingMinute(99), 0);
});

test("finalizar partes completa minutos, conserva eventos y exige inicio explícito de P2", () => {
  const matchId = "period-lifecycle";
  const session = createSession(matchId);
  useMatchStore.setState({ matches: { [matchId]: session } });
  const actions = useMatchStore.getState();
  actions.setClock(matchId, 1, 8);
  const before = useMatchStore.getState().matches[matchId].events;
  actions.finishCurrentPeriod(matchId);
  let current = useMatchStore.getState().matches[matchId];
  assert.equal(current.period, 1);
  assert.equal(current.minute, 20);
  assert.deepEqual(current.closedPeriods, [1]);
  assert.deepEqual(current.periodCloseSnapshots, { 1: 8 });
  assert.equal(current.matchFinished, false);
  assert.deepEqual(current.events, before);
  assert.equal(replayMatch(current.players, current.events, { currentClock: { period: 1, minute: 20 } }).playerMinutes.p1.totalMinutes, 20);

  actions.recordFoul(matchId, "FOR", "p1");
  actions.swapPlayer(matchId, "p1", "p6");
  current = useMatchStore.getState().matches[matchId];
  assert.equal(current.events.length, before.length);
  assert.match(current.lastError ?? "", /P1 está cerrado/);

  actions.startSecondPeriod(matchId, ["p1", "p2", "p3", "p4", "p5"], "p5");
  current = useMatchStore.getState().matches[matchId];
  assert.equal(current.period, 2);
  assert.equal(current.minute, 0);
  assert.equal(current.events.length, before.length + 1);
  const p2Lineup = current.events.find(
    (event) => event.type === "lineup_initialized" && event.period === 2,
  );
  assert.equal(p2Lineup?.id, secondPeriodLineupEventId(matchId));
  assert.deepEqual(
    p2Lineup?.type === "lineup_initialized" ? p2Lineup.onCourtPlayerIds : [],
    ["p1", "p2", "p3", "p4", "p5"],
  );
  actions.finishCurrentPeriod(matchId);
  current = useMatchStore.getState().matches[matchId];
  assert.equal(current.minute, 20);
  assert.equal(current.matchFinished, true);
  assert.deepEqual(current.closedPeriods, [1, 2]);
});

test("P2 propone y acepta sin cambios el quinteto que terminó P1", () => {
  const matchId = "p2-lineup-proposal";
  useMatchStore.setState({ matches: { [matchId]: createSession(matchId) } });
  const actions = useMatchStore.getState();
  actions.setClock(matchId, 1, 8);
  actions.swapPlayer(matchId, "p1", "p6");
  actions.finishCurrentPeriod(matchId);
  let current = useMatchStore.getState().matches[matchId];
  const proposal = proposeSecondPeriodLineup(current.players, current.events);
  assert.deepEqual(proposal, {
    playerIds: ["p6", "p2", "p3", "p4", "p5"],
    goalkeeperPlayerId: "p5",
  });

  actions.startSecondPeriod(
    matchId,
    proposal.playerIds,
    proposal.goalkeeperPlayerId!,
  );
  current = useMatchStore.getState().matches[matchId];
  const initializations = current.events.filter(
    (event) => event.type === "lineup_initialized" && event.period === 2,
  );
  assert.equal(initializations.length, 1);
  assert.equal(
    current.events.filter((event) => event.type === "substitution").length,
    1,
  );
  const replay = replayMatch(current.players, current.events, {
    currentClock: { period: 2, minute: 0 },
  });
  assert.deepEqual(replay.onCourtPlayerIds, proposal.playerIds);
  assert.deepEqual(replay.lineupValidation.goalkeeper, {
    status: "PLAYER",
    playerId: "p5",
    resolution: "REPLAY",
  });
  assert.equal(replay.playerMinutes.p1.totalMinutes, 8);
  assert.equal(replay.playerMinutes.p6.totalMinutes, 12);
  assert.equal(replay.playerMinutes.p6.currentStintMinutes, 0);
});

test("P2 cambia jugadores y portero sin sustituciones, persiste y solo se inicializa una vez", () => {
  const matchId = "p2-lineup-changed";
  useMatchStore.setState({ matches: { [matchId]: createSession(matchId) } });
  const actions = useMatchStore.getState();
  actions.finishCurrentPeriod(matchId);
  actions.startSecondPeriod(matchId, ["p1", "p4", "p5", "p6"], "p5");
  let current = useMatchStore.getState().matches[matchId];
  assert.equal(current.period, 1);
  assert.match(current.lastError ?? "", /cinco jugadores/);
  const p2Players = ["p1", "p4", "p5", "p6", "p7"];
  actions.startSecondPeriod(matchId, p2Players, "p6");
  current = useMatchStore.getState().matches[matchId];
  assert.equal(current.period, 2);
  assert.equal(current.minute, 0);
  assert.equal(current.periodMinutes[2], 0);
  assert.equal(
    current.events.filter((event) => event.type === "substitution").length,
    0,
  );
  assert.equal(
    current.events.filter(
      (event) =>
        event.type === "lineup_initialized" &&
        event.period === 2 &&
        event.minute === 0,
    ).length,
    1,
  );

  let replay = replayMatch(current.players, current.events, {
    currentClock: { period: 2, minute: 0 },
  });
  assert.deepEqual(replay.onCourtPlayerIds, p2Players);
  assert.deepEqual(replay.lineupValidation.goalkeeper, {
    status: "PLAYER",
    playerId: "p6",
    resolution: "REPLAY",
  });
  assert.equal(replay.playerMinutes.p2.totalMinutes, 20);
  assert.equal(replay.playerMinutes.p3.totalMinutes, 20);
  assert.equal(replay.playerMinutes.p2.onCourt, false);
  assert.equal(replay.playerMinutes.p6.totalMinutes, 0);
  assert.equal(replay.playerMinutes.p6.currentStintMinutes, 0);

  const eventCount = current.events.length;
  actions.startSecondPeriod(
    matchId,
    ["p2", "p3", "p4", "p5", "p8"],
    "p5",
  );
  current = useMatchStore.getState().matches[matchId];
  assert.equal(current.events.length, eventCount);
  replay = replayMatch(current.players, current.events, {
    currentClock: { period: 2, minute: 0 },
  });
  assert.deepEqual(replay.onCourtPlayerIds, p2Players);
  assert.equal(
    proposeSecondPeriodLineup(current.players, current.events).goalkeeperPlayerId,
    "p6",
  );

  const storage = new MemoryStorage();
  assert.equal(saveMatchSession(current, storage, 30).ok, true);
  const loaded = loadMatchSession(matchId, storage);
  assert.ok(loaded);
  const reloadedReplay = replayMatch(loaded.players, loaded.events, {
    currentClock: { period: 2, minute: 0 },
  });
  assert.deepEqual(reloadedReplay.onCourtPlayerIds, p2Players);
  assert.equal(reloadedReplay.lineupValidation.goalkeeper.status, "PLAYER");
  assert.equal(
    reloadedReplay.lineupValidation.goalkeeper.status === "PLAYER"
      ? reloadedReplay.lineupValidation.goalkeeper.playerId
      : undefined,
    "p6",
  );

  actions.setClock(matchId, 2, 3);
  actions.swapPlayer(matchId, "p7", "p2");
  current = useMatchStore.getState().matches[matchId];
  const p2Substitutions = current.events.filter(
    (event) => event.type === "substitution" && event.period === 2,
  );
  assert.equal(p2Substitutions.length, 1);
  assert.equal(p2Substitutions[0].minute, 3);
  replay = replayMatch(current.players, current.events, {
    currentClock: { period: 2, minute: 3 },
  });
  assert.equal(replay.playerMinutes.p7.totalMinutes, 3);
  assert.equal(replay.playerMinutes.p2.totalMinutes, 20);
  assert.equal(replay.playerMinutes.p2.currentStintMinutes, 0);
});

test("amenaza RIV posterior usa el portero funcional elegido para P2", () => {
  const matchId = "p2-functional-goalkeeper-threat";
  useMatchStore.setState({ matches: { [matchId]: createSession(matchId) } });
  const actions = useMatchStore.getState();
  actions.finishCurrentPeriod(matchId);
  actions.startSecondPeriod(
    matchId,
    ["p1", "p3", "p4", "p5", "p6"],
    "p6",
  );
  actions.swapPlayer(matchId, "p3", "p9");
  actions.recordThreat(matchId, {
    id: "p2-rival-goal",
    side: "AGAINST",
    origin: { x: 0.6, y: 0.4 },
    outcome: "GOL",
    phase: "POSITIONAL",
    defensiveCapture: {
      goalTarget: {
        geometryVersion: GOAL_TARGET_GEOMETRY_VERSION,
        x: 0.225,
        y: 0.35,
      },
    },
  });
  const current = useMatchStore.getState().matches[matchId];
  assert.equal(current.lastError, null);
  const threat = current.events.find((event) => event.id === "p2-rival-goal");
  assert.equal(
    threat?.type === "threat_recorded" &&
      threat.defensive?.goalkeeper.status === "PLAYER"
      ? threat.defensive.goalkeeper.playerId
      : undefined,
    "p6",
  );
  assert.deepEqual(replayMatch(current.players, current.events).issues, []);
});

test("partido finalizado permanece FINISHED y admite corrección deliberada por periodo", () => {
  const matchId = "finished-review";
  const prepared = {
    ...createSession(matchId),
    preparation: {
      teamId: "cd-alameda",
      opponent: "Rival",
      venue: "HOME" as const,
      date: "2026-09-06",
      status: "LIVE" as const,
      calledPlayerIds: players.slice(0, 7).map((player) => player.id),
      starterPlayerIds: players.slice(0, 5).map((player) => player.id),
      startingGoalkeeperId: "p5",
      selectedStaffIds: [],
      targetMinutes: {},
      createdAt: 1,
      updatedAt: 1,
    },
  };
  useMatchStore.setState({ matches: { [matchId]: prepared } });
  assert.equal("seasonId" in prepared.preparation ? prepared.preparation.seasonId : undefined, undefined);
  const actions = useMatchStore.getState();
  actions.finishCurrentPeriod(matchId);
  actions.startSecondPeriod(matchId, ["p1", "p2", "p3", "p4", "p5"], "p5");
  actions.finishCurrentPeriod(matchId);
  let current = useMatchStore.getState().matches[matchId];
  assert.equal(current.matchFinished, true);
  assert.equal(current.preparation?.status, "FINISHED");
  assert.equal(current.reviewStatus, "NOT_REVIEWED");
  const before = current.events.length;
  actions.recordFoul(matchId, "FOR", null);
  assert.equal(useMatchStore.getState().matches[matchId].events.length, before);

  actions.startFinishedReview(matchId);
  assert.equal(useMatchStore.getState().matches[matchId].reviewStatus, "IN_REVIEW");
  actions.setReviewMinute(matchId, 7);
  actions.recordFoul(matchId, "FOR", null);
  current = useMatchStore.getState().matches[matchId];
  const generic = current.events.find((event) => event.type === "foul_recorded" && event.playerId === null);
  assert.ok(generic);
  assert.equal(generic?.period, 2);
  assert.equal(generic?.minute, 7);
  assert.equal(generic?.provenance, "MANUAL_REVIEW");
  assert.equal(current.matchFinished, true);
  assert.equal(current.preparation?.status, "FINISHED");
  actions.editEvent(matchId, generic!.id, { minute: 8, foul: { playerId: "p1" } });
  current = useMatchStore.getState().matches[matchId];
  assert.equal(current.events.find((event) => event.id === generic!.id)?.minute, 8);
  actions.softDeleteEvent(matchId, generic!.id);
  assert.equal(replayMatch(current.players, useMatchStore.getState().matches[matchId].events).discipline.for.fouls, 0);
  actions.restoreEvent(matchId, generic!.id);
  assert.equal(replayMatch(current.players, useMatchStore.getState().matches[matchId].events).discipline.for.fouls, 1);
  actions.startPeriodReview(matchId, 1);
  actions.setReviewMinute(matchId, 9);
  actions.recordFoul(matchId, "AGAINST", null);
  current = useMatchStore.getState().matches[matchId];
  assert.ok(current.events.some((event) => event.type === "foul_recorded" && event.period === 1 && event.minute === 9));
  assert.equal(current.matchFinished, true);
  actions.stopPeriodReview(matchId);
  current = useMatchStore.getState().matches[matchId];
  assert.equal(current.reviewPeriod, undefined);
  assert.equal(current.matchFinished, true);
  assert.equal(current.preparation?.status, "FINISHED");
  assert.equal(current.preparation?.seasonId, undefined);
});

test("revisión FINISHED repara metadata legacy sin periodos cerrados", () => {
  const matchId = "legacy-finished-review";
  const legacy = {
    ...createSession(matchId),
    period: 2,
    minute: 20,
    periodMinutes: { 1: 20, 2: 20 },
    closedPeriods: [],
    matchFinished: true,
  };
  useMatchStore.setState({ matches: { [matchId]: legacy } });
  const actions = useMatchStore.getState();
  actions.startFinishedReview(matchId);
  actions.setReviewMinute(matchId, 6);
  actions.recordFoul(matchId, "FOR", null);
  const current = useMatchStore.getState().matches[matchId];
  assert.deepEqual(current.closedPeriods, [1, 2]);
  assert.equal(current.reviewPeriod, 2);
  assert.ok(current.events.some((event) => event.type === "foul_recorded" && event.period === 2 && event.minute === 6));
  assert.equal(current.matchFinished, true);
});

test("validar y reabrir revisión no reactiva el reloj y conserva procedencia LIVE", () => {
  const matchId = "review-status";
  const liveThreat = createLiveThreatEvent({
    id: "live-before-review",
    matchId,
    position: { period: 1, minute: 4, order: 1 },
    side: "FOR",
    playerId: "p1",
    origin: { x: 0.4, y: 0.5 },
    outcome: "FUERA",
    phase: "POSITIONAL",
  });
  const session: MatchSession = {
    ...createSession(matchId),
    period: 2,
    minute: 20,
    periodMinutes: { 1: 20, 2: 20 },
    closedPeriods: [1, 2],
    matchFinished: true,
    reviewStatus: "NOT_REVIEWED",
    events: appendEvent(players, initialLineup(matchId), liveThreat),
  };
  useMatchStore.setState({ matches: { [matchId]: session } });
  const actions = useMatchStore.getState();
  actions.startFinishedReview(matchId);
  actions.editEvent(matchId, liveThreat.id, { minute: 5, pendingReview: true });
  let current = useMatchStore.getState().matches[matchId];
  assert.equal(current.events.find((event) => event.id === liveThreat.id)?.provenance, "LIVE");
  actions.validateReview(matchId);
  current = useMatchStore.getState().matches[matchId];
  assert.equal(effectiveReviewStatus(current), "VALIDATED");
  assert.equal(current.reviewPeriod, undefined);
  assert.equal(current.matchFinished, true);
  assert.equal(current.period, 2);
  assert.equal(reviewEventCounts(current.events).pending, 1);
  const validatedAt = current.reviewValidatedAt;
  actions.startFinishedReview(matchId);
  assert.match(useMatchStore.getState().matches[matchId].lastError ?? "", /Reabre la revisión/i);
  actions.reopenReview(matchId);
  current = useMatchStore.getState().matches[matchId];
  assert.equal(current.reviewStatus, "IN_REVIEW");
  assert.equal(current.matchFinished, true);
  assert.equal(current.reviewValidatedAt, validatedAt);
  assert.ok((current.reviewRevision ?? 0) >= 2);
});

test("targetMinutes vacío no genera bloque y con objetivos compara plan contra replay", () => {
  const empty = createSession("review-target-empty");
  assert.deepEqual(targetMinutesComparisons(empty), []);
  const planned: MatchSession = {
    ...createSession("review-targets"),
    events: appendEvent(
      players,
      createSession("review-targets").events,
      createLineupInitializedEvent({
        id: "review-targets-p2",
        matchId: "review-targets",
        position: { period: 2, minute: 0, order: 1 },
        squadPlayerIds: players.map((player) => player.id),
        onCourtPlayerIds: players.slice(0, 5).map((player) => player.id),
        goalkeeperPlayerId: "p5",
      }),
    ),
    preparation: {
      teamId: "cd-alameda",
      seasonId: "season-test",
      opponent: "Rival",
      venue: "HOME",
      date: "2026-09-10",
      status: "FINISHED",
      calledPlayerIds: players.map((player) => player.id),
      starterPlayerIds: players.slice(0, 5).map((player) => player.id),
      selectedStaffIds: [],
      targetMinutes: { p1: 20 },
      createdAt: 1,
      updatedAt: 1,
    },
    period: 2,
    minute: 20,
    periodMinutes: { 1: 20, 2: 20 },
    closedPeriods: [1, 2],
    matchFinished: true,
  };
  const comparison = targetMinutesComparisons(planned)[0];
  assert.equal(comparison.playerId, "p1");
  assert.equal(comparison.target, 20);
  assert.equal(comparison.actual, 40);
  assert.equal(comparison.difference, 20);
});

test("faltas genéricas son válidas, numeradas, editables, reordenables y persistentes", () => {
  const matchId = "generic-fouls";
  let events = initialLineup(matchId);
  const generic = createFoulEvent({
    id: "generic-foul",
    matchId,
    position: { period: 1, minute: 5, order: 1 },
    side: "FOR",
    playerId: null,
  });
  const assigned = createFoulEvent({
    id: "assigned-foul",
    matchId,
    position: { period: 1, minute: 5, order: 2 },
    side: "FOR",
    playerId: "p2",
  });
  events = appendEvents(players, events, [generic, assigned]);
  let replay = replayMatch(players, events);
  assert.deepEqual(replay.issues, []);
  assert.deepEqual(
    replay.timeline.filter((entry) => entry.event.type === "foul_recorded").map((entry) => entry.periodFoulNumber),
    [1, 2],
  );
  events = reorderEvent(players, events, "assigned-foul", { period: 1, minute: 5, order: 1 });
  replay = replayMatch(players, events);
  assert.equal(replay.timeline.find((entry) => entry.event.id === "assigned-foul")?.periodFoulNumber, 1);
  events = editEvent(players, events, "generic-foul", { foul: { playerId: "p1" } });
  const editedGeneric = events.find((event) => event.id === "generic-foul");
  assert.equal(editedGeneric?.type === "foul_recorded" && editedGeneric.playerId, "p1");
  const storage = new MemoryStorage();
  const session = { ...createSession(matchId), events };
  assert.equal(saveMatchSession(session, storage, 10).ok, true);
  const loaded = loadMatchSession(matchId, storage);
  const loadedGeneric = loaded?.events.find((event) => event.id === "generic-foul");
  assert.equal(loadedGeneric?.type === "foul_recorded" && loadedGeneric.playerId, "p1");
});

test("faltas genéricas CDA/RIV soportan undo, soft delete y restore sin pending automático", () => {
  const matchId = "generic-fouls-store";
  useMatchStore.setState({ matches: { [matchId]: createSession(matchId) } });
  const actions = useMatchStore.getState();
  actions.recordFoul(matchId, "FOR", null);
  actions.recordFoul(matchId, "AGAINST", null);
  let current = useMatchStore.getState().matches[matchId];
  let replay = replayMatch(current.players, current.events);
  assert.equal(replay.discipline.for.fouls, 1);
  assert.equal(replay.discipline.against.fouls, 1);
  const genericEvents = current.events.filter((event) => event.type === "foul_recorded");
  assert.equal(genericEvents.length, 2);
  assert.ok(genericEvents.every((event) => event.playerId === null && event.pendingReview === false));
  actions.undo(matchId);
  current = useMatchStore.getState().matches[matchId];
  assert.equal(replayMatch(current.players, current.events).discipline.against.fouls, 0);
  actions.redo(matchId);
  current = useMatchStore.getState().matches[matchId];
  const rivalFoul = current.events.find((event) => event.type === "foul_recorded" && event.side === "AGAINST");
  assert.ok(rivalFoul);
  actions.softDeleteEvent(matchId, rivalFoul!.id);
  current = useMatchStore.getState().matches[matchId];
  replay = replayMatch(current.players, current.events);
  assert.equal(replay.discipline.against.fouls, 0);
  actions.restoreEvent(matchId, rivalFoul!.id);
  current = useMatchStore.getState().matches[matchId];
  replay = replayMatch(current.players, current.events);
  assert.equal(replay.discipline.against.fouls, 1);
});

test("finalizar P1 permite reanudar de forma deliberada antes de iniciar P2", () => {
  const matchId = "resume-first-period";
  useMatchStore.setState({ matches: { [matchId]: createSession(matchId) } });
  const actions = useMatchStore.getState();
  actions.setClock(matchId, 1, 18);
  actions.finishCurrentPeriod(matchId);
  let current = useMatchStore.getState().matches[matchId];
  assert.equal(current.minute, 20);
  assert.deepEqual(current.closedPeriods, [1]);
  assert.equal(current.periodCloseSnapshots?.[1], 18);

  actions.resumeFirstPeriod(matchId);
  current = useMatchStore.getState().matches[matchId];
  assert.equal(current.period, 1);
  assert.equal(current.minute, 18);
  assert.equal(current.periodMinutes[1], 18);
  assert.deepEqual(current.closedPeriods, []);
  assert.equal(current.periodCloseSnapshots?.[1], undefined);
  assert.equal(current.matchFinished, false);
});

test("P2 permanece activa mientras revisión P1 captura, edita y recalcula replay", () => {
  const matchId = "review-closed-first-period";
  useMatchStore.setState({ matches: { [matchId]: createSession(matchId) } });
  const actions = useMatchStore.getState();
  actions.setClock(matchId, 1, 18);
  actions.finishCurrentPeriod(matchId);
  actions.startSecondPeriod(matchId, ["p1", "p2", "p3", "p4", "p5"], "p5");
  actions.incrementMinute(matchId);
  actions.incrementMinute(matchId);
  actions.incrementMinute(matchId);
  actions.recordFoul(matchId, "FOR", "p1");
  let current = useMatchStore.getState().matches[matchId];
  const p2Foul = current.events.find(
    (event) => event.type === "foul_recorded" && event.period === 2,
  );
  assert.ok(p2Foul);
  assert.equal(current.period, 2);
  assert.equal(current.minute, 3);

  actions.startPeriodReview(matchId, 1);
  actions.setReviewMinute(matchId, 12);
  current = useMatchStore.getState().matches[matchId];
  assert.equal(current.period, 2);
  assert.equal(current.minute, 3);
  assert.equal(current.reviewPeriod, 1);
  assert.equal(current.reviewMinute, 12);

  actions.recordThreat(matchId, {
    id: "omitted-p1-goal",
    side: "AGAINST",
    origin: { x: 0.62, y: 0.45 },
    outcome: "GOL",
    phase: "TRANSITION",
    defensiveCapture: {
      goalTarget: { geometryVersion: 2, x: 0.5, y: 0.4 },
    },
  });
  actions.swapPlayer(matchId, "p1", "p6");
  current = useMatchStore.getState().matches[matchId];
  const omitted = current.events.find((event) => event.id === "omitted-p1-goal");
  assert.equal(omitted?.period, 1);
  assert.equal(omitted?.minute, 12);
  const replay = replayMatch(current.players, current.events, {
    currentClock: { period: 2, minute: 3 },
  });
  assert.equal(replay.score.against, 1);
  // P2 conserva su alineación explícita aunque una revisión posterior cambie
  // cómo terminó P1: p1 suma 12' de P1 + 3' de P2; p6 solo 8' de P1.
  assert.equal(replay.playerMinutes.p1.totalMinutes, 15);
  assert.equal(replay.playerMinutes.p6.totalMinutes, 8);

  actions.editEvent(matchId, "omitted-p1-goal", {
    minute: 11,
    threat: { phase: "POSITIONAL" },
  });
  current = useMatchStore.getState().matches[matchId];
  const edited = current.events.find((event) => event.id === "omitted-p1-goal");
  assert.equal(edited?.minute, 11);
  assert.equal(edited?.type === "threat_recorded" && edited.phase, "POSITIONAL");

  actions.stopPeriodReview(matchId);
  actions.recordFoul(matchId, "AGAINST", "p2");
  current = useMatchStore.getState().matches[matchId];
  assert.equal(current.reviewPeriod, undefined);
  assert.equal(current.period, 2);
  assert.equal(current.minute, 3);
  assert.ok(
    current.events.some(
      (event) => event.type === "foul_recorded" && event.side === "AGAINST" && event.period === 2,
    ),
  );

  actions.resumeFirstPeriod(matchId);
  current = useMatchStore.getState().matches[matchId];
  assert.equal(current.period, 2);
  assert.match(current.lastError ?? "", /P2 ya ha comenzado/);

  actions.changePeriod(matchId, 1);
  current = useMatchStore.getState().matches[matchId];
  assert.equal(current.period, 2);
  assert.equal(current.minute, 3);
  assert.match(current.lastError ?? "", /Entra en revisión/);
});

test("contexto de revisión P1 se persiste sin alterar el reloj activo P2", () => {
  const matchId = "persisted-period-review";
  useMatchStore.setState({ matches: { [matchId]: createSession(matchId) } });
  const actions = useMatchStore.getState();
  actions.setClock(matchId, 1, 17);
  actions.finishCurrentPeriod(matchId);
  actions.startSecondPeriod(matchId, ["p1", "p2", "p3", "p4", "p5"], "p5");
  actions.incrementMinute(matchId);
  actions.startPeriodReview(matchId, 1);
  actions.setReviewMinute(matchId, 9);
  const session = useMatchStore.getState().matches[matchId];
  const storage = new MemoryStorage();
  assert.equal(saveMatchSession(session, storage, 100).ok, true);
  const loaded = loadMatchSession(matchId, storage);
  assert.equal(loaded?.period, 2);
  assert.equal(loaded?.minute, 1);
  assert.equal(loaded?.reviewPeriod, 1);
  assert.equal(loaded?.reviewMinute, 9);
  assert.equal(loaded?.periodCloseSnapshots?.[1], 17);
});

test("historial separa activos, pendientes y eliminados sin alterar replay", () => {
  let events = initialLineup("history-filters");
  const active = createFoulEvent({ id: "active", matchId: "history-filters", position: { period: 1, minute: 2, order: 1 }, side: "FOR", playerId: "p1" });
  const pending = { ...createFoulEvent({ id: "pending", matchId: "history-filters", position: { period: 1, minute: 3, order: 1 }, side: "AGAINST", playerId: "p2" }), pendingReview: true };
  events = appendEvents(players, events, [active, pending]);
  events = softDeleteEvent(players, events, active.id);
  assert.deepEqual(filterTimelineEvents(events, "ACTIVE").map((event) => event.id), ["pending"]);
  assert.deepEqual(filterTimelineEvents(events, "PENDING").map((event) => event.id), ["pending"]);
  assert.deepEqual(filterTimelineEvents(events, "DELETED").map((event) => event.id), ["active"]);
  assert.equal(replayMatch(players, events).discipline.for.fouls, 0);
  assert.equal(replayMatch(players, events).discipline.against.fouls, 1);
});

test("zonas espaciales V1 derivan 3×2 en pista y 3×2 más exterior en portería", () => {
  assert.equal(PITCH_ZONE_MODEL_VERSION, 1);
  assert.equal(derivePitchZoneV1({ x: 0.1, y: 0.1 }), "OWN_THIRD_TOP");
  assert.equal(derivePitchZoneV1({ x: 0.5, y: 0.8 }), "MIDDLE_THIRD_BOTTOM");
  assert.equal(derivePitchZoneV1({ x: 0.9, y: 0.2 }), "FINAL_THIRD_TOP");
  assert.equal(deriveGoalZoneV1({ x: 0.25, y: 0.3 }, GOAL_FRAME), "LEFT_HIGH");
  assert.equal(deriveGoalZoneV1({ x: 0.5, y: 0.7 }, GOAL_FRAME), "CENTER_LOW");
  assert.equal(deriveGoalZoneV1({ x: 0.1, y: 0.5 }, GOAL_FRAME), "OUT_LEFT");
  assert.equal(deriveGoalZoneV1({ x: 0.9, y: 0.5 }, GOAL_FRAME), "OUT_RIGHT");
  assert.equal(deriveGoalZoneV1({ x: 0.5, y: 0.1 }, GOAL_FRAME), "OUT_HIGH");
});

test("anatomía del portero es independiente del destino y respeta derecha frontal", () => {
  assert.equal(deriveKeeperBodyZoneFromPart("HEAD"), "UPPER");
  assert.equal(deriveKeeperBodyZoneFromPart("RIGHT_ARM_HAND"), "UPPER");
  assert.equal(deriveKeeperBodyZoneFromPart("LEFT_LEG_FOOT"), "LOWER");
  assert.equal(KEEPER_BODY_SCREEN_SIDE.RIGHT_ARM_HAND, "LEFT");
  assert.equal(KEEPER_BODY_SCREEN_SIDE.LEFT_ARM_HAND, "RIGHT");
});

test("reinicio seguro solo afecta a los dos partidos demo autorizados", () => {
  const clean = createSession("prueba");
  const real = createSession("liga-1");
  useMatchStore.setState({ matches: { prueba: clean, "liga-1": real } });
  useMatchStore.getState().incrementMinute("prueba");
  useMatchStore.getState().incrementMinute("liga-1");
  useMatchStore.getState().resetDemo("prueba");
  useMatchStore.getState().resetDemo("liga-1");
  assert.equal(useMatchStore.getState().matches.prueba.minute, 0);
  assert.equal(useMatchStore.getState().matches["liga-1"].minute, 1);
});

test("cada amenaza defensiva nace sin cuerpo y permite cerrar la parada sin indicarlo", () => {
  for (const saveOutcome of ["CATCH", "CLEARANCE", "REBOUND"] as const) {
    let transition = reduceLiveInteraction(IDLE_LIVE_INTERACTION, { type: "COURT_TAPPED", origin: { x: 0.4, y: 0.5 }, eventId: `clean-${saveOutcome}` });
    assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.keeperBodyPart, null);
    transition = reduceLiveInteraction(transition.state, { type: "GOAL_TARGET_SELECTED", goalTarget: { geometryVersion: 3, x: 0.5, y: 0.5 } });
    assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.keeperBodyPart, null);
    transition = reduceLiveInteraction(transition.state, { type: "SAVE_OUTCOME_SELECTED", saveOutcome });
    transition = reduceLiveInteraction(transition.state, { type: "PHASE_SELECTED", phase: "POSITIONAL" });
    assert.equal(transition.effect?.type, "RECORD_THREAT");
    if (transition.effect?.type === "RECORD_THREAT") assert.equal(transition.effect.defensiveCapture?.keeperBodyPart, undefined);
  }
});

test("una amenaza nueva no hereda el cuerpo de la intervención anterior", () => {
  let first = reduceLiveInteraction(IDLE_LIVE_INTERACTION, { type: "COURT_TAPPED", origin: { x: 0.5, y: 0.5 }, eventId: "body-a" });
  first = reduceLiveInteraction(first.state, { type: "GOAL_TARGET_SELECTED", goalTarget: { geometryVersion: 3, x: 0.5, y: 0.5 } });
  first = reduceLiveInteraction(first.state, { type: "KEEPER_BODY_PART_SELECTED", keeperBodyPart: "RIGHT_ARM_HAND" });
  first = reduceLiveInteraction(first.state, { type: "SAVE_OUTCOME_SELECTED", saveOutcome: "CATCH" });
  first = reduceLiveInteraction(first.state, { type: "PHASE_SELECTED", phase: "TRANSITION" });
  const second = reduceLiveInteraction(first.state, { type: "COURT_TAPPED", origin: { x: 0.7, y: 0.3 }, eventId: "body-b" });
  assert.equal(second.state.kind === "THREAT_PENDING" && second.state.keeperBodyPart, null);
});

test("la silueta exige un pointerdown propio y rechaza el pointerup del destino", () => {
  assert.equal(completesIndependentPointerGesture(null, 17), false);
  assert.equal(completesIndependentPointerGesture(16, 17), false);
  assert.equal(completesIndependentPointerGesture(17, 17), true);
});

test("stress: veinte amenazas alternan cuerpo y ausencia sin heredar selección", () => {
  const targets = [
    { x: 0.25, y: 0.3 },
    { x: 0.5, y: 0.5 },
    { x: 0.75, y: 0.7 },
  ] as const;
  for (let index = 0; index < 20; index += 1) {
    let transition = reduceLiveInteraction(IDLE_LIVE_INTERACTION, {
      type: "COURT_TAPPED",
      origin: { x: 0.35, y: 0.5 },
      eventId: `body-stress-${index}`,
    });
    transition = reduceLiveInteraction(transition.state, {
      type: "GOAL_TARGET_SELECTED",
      goalTarget: { geometryVersion: 3, ...targets[index % targets.length] },
    });
    assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.keeperBodyPart, null);
    assert.equal(transition.state.kind === "THREAT_PENDING" && transition.state.keeperBodyPart, null);
    if (index % 2 === 0) {
      transition = reduceLiveInteraction(transition.state, {
        type: "KEEPER_BODY_PART_SELECTED",
        keeperBodyPart: index % 4 === 0 ? "RIGHT_ARM_HAND" : "LEFT_LEG_FOOT",
      });
    }
    transition = reduceLiveInteraction(transition.state, { type: "SAVE_OUTCOME_SELECTED", saveOutcome: "CATCH" });
    transition = reduceLiveInteraction(transition.state, { type: "PHASE_SELECTED", phase: "POSITIONAL" });
    assert.equal(transition.effect?.type, "RECORD_THREAT");
    if (transition.effect?.type === "RECORD_THREAT") {
      assert.equal(Boolean(transition.effect.defensiveCapture?.keeperBodyPart), index % 2 === 0);
    }
  }
});

test("los controles contextuales consumen el gesto antes de llegar a la pista", () => {
  let prevented = 0;
  let stopped = 0;
  consumeContextualPointer({ preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; } });
  assert.deepEqual({ prevented, stopped }, { prevented: 1, stopped: 1 });
});
