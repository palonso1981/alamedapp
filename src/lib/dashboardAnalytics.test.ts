import assert from "node:assert/strict";
import test from "node:test";

import {
  createCardEvent,
  createFoulEvent,
  createLineupInitializedEvent,
  createLiveThreatEvent,
  createSubstitutionEvent,
} from "./matchEngine";
import {
  buildDashboardAnalytics,
  DashboardMatchRecord,
  filterDashboardMatches,
} from "./dashboardAnalytics";
import { MatchEvent, MatchSession, Player } from "../types";

const players: Player[] = [
  { id: "gk-a", name: "Portero A", number: 1, position: "PORTERO", goalkeeperCapable: true },
  { id: "p2", name: "Dos", number: 2, position: "JUGADOR" },
  { id: "p3", name: "Tres", number: 3, position: "JUGADOR" },
  { id: "p4", name: "Cuatro", number: 4, position: "JUGADOR" },
  { id: "p5", name: "Cinco", number: 5, position: "JUGADOR" },
  { id: "gk-b", name: "Portero B", number: 13, position: "PORTERO", goalkeeperCapable: true },
];

function session(matchId: string, events: MatchEvent[], overrides: Partial<MatchSession> = {}): MatchSession {
  return {
    matchId,
    players,
    staff: [],
    period: 2,
    minute: 20,
    periodMinutes: { 1: 20, 2: 20 },
    closedPeriods: [1, 2],
    matchFinished: true,
    reviewStatus: "VALIDATED",
    events,
    past: [],
    future: [],
    lastError: null,
    persistenceStatus: "saved",
    lastSavedAt: 100,
    ...overrides,
  };
}

function record(
  matchId: string,
  events: MatchEvent[],
  options: {
    clubId?: string;
    teamId?: string;
    seasonId?: string;
    archivedAt?: number;
    session?: Partial<MatchSession>;
  } = {},
): DashboardMatchRecord {
  const clubId = options.clubId ?? "club-a";
  const teamId = options.teamId ?? "team-a";
  const seasonId = options.seasonId ?? "season-a";
  const matchSession = session(matchId, events, {
    preparation: {
      clubId,
      teamId,
      seasonId,
      opponent: `Rival ${matchId}`,
      venue: "HOME",
      date: "2026-09-04",
      status: "FINISHED",
      calledPlayerIds: players.map((player) => player.id),
      starterPlayerIds: players.slice(0, 5).map((player) => player.id),
      startingGoalkeeperId: "gk-a",
      selectedStaffIds: [],
      targetMinutes: { "gk-a": 12, "gk-b": 8 },
      createdAt: 1,
      updatedAt: 100,
      archivedAt: options.archivedAt,
    },
    ...options.session,
  });
  return {
    catalog: {
      matchId,
      clubId,
      teamId,
      seasonId,
      opponent: `Rival ${matchId}`,
      venue: "HOME",
      date: "2026-09-04",
      status: "FINISHED",
      updatedAt: 100,
      archivedAt: options.archivedAt,
    },
    session: matchSession,
  };
}

function lineup(matchId: string): MatchEvent {
  return createLineupInitializedEvent({
    id: `${matchId}-lineup`,
    matchId,
    position: { period: 1, minute: 0, order: 1 },
    squadPlayerIds: players.map((player) => player.id),
    onCourtPlayerIds: ["gk-a", "p2", "p3", "p4", "p5"],
    goalkeeperPlayerId: "gk-a",
    now: 1,
  });
}

function defensiveThreat(
  matchId: string,
  id: string,
  minute: number,
  order: number,
  outcome: "GOL" | "PARADA" | "FUERA",
  goalkeeperId: string,
  options: { parentEventId?: string; sequenceId?: string; saveOutcome?: "CATCH" | "REBOUND" | "CLEARANCE"; bodyPart?: "HEAD" | "TORSO" | "LEFT_ARM_HAND" | "RIGHT_ARM_HAND" | "LEFT_LEG_FOOT" | "RIGHT_LEG_FOOT" } = {},
): MatchEvent {
  return createLiveThreatEvent({
    id,
    matchId,
    position: { period: 1, minute, order },
    side: "AGAINST",
    origin: { x: 0.6, y: 0.4 },
    outcome,
    phase: "TRANSITION",
    parentEventId: options.parentEventId,
    sequenceId: options.sequenceId,
    defensive: {
      version: 2,
      goalTarget: {
        x: outcome === "FUERA" ? 0.1 : 0.5,
        y: 0.5,
        geometryVersion: 3,
      },
      goalkeeper: { status: "PLAYER", playerId: goalkeeperId, resolution: "REPLAY" },
      keeperBodyPart: outcome === "PARADA" ? options.bodyPart ?? "TORSO" : undefined,
      saveOutcome: outcome === "PARADA" ? options.saveOutcome ?? "CATCH" : undefined,
    },
    now: minute * 10 + order,
  });
}

test("Dashboard atribuye portero funcional, minutos y porcentaje sin incluir FUERA", () => {
  const matchId = "keepers";
  const events: MatchEvent[] = [
    lineup(matchId),
    defensiveThreat(matchId, "a-save-1", 2, 1, "PARADA", "gk-a", { bodyPart: "HEAD" }),
    defensiveThreat(matchId, "a-save-2", 4, 1, "PARADA", "gk-a", { saveOutcome: "CLEARANCE" }),
    defensiveThreat(matchId, "a-goal", 6, 1, "GOL", "gk-a"),
    defensiveThreat(matchId, "a-out", 8, 1, "FUERA", "gk-a"),
    createSubstitutionEvent({
      id: "keeper-change",
      matchId,
      position: { period: 1, minute: 10, order: 1 },
      playerOutId: "gk-a",
      playerInId: "gk-b",
      now: 101,
    }),
    defensiveThreat(matchId, "b-save-1", 12, 1, "PARADA", "gk-b", { saveOutcome: "REBOUND" }),
    defensiveThreat(matchId, "b-save-2", 13, 1, "PARADA", "gk-b"),
    defensiveThreat(matchId, "b-save-3", 14, 1, "PARADA", "gk-b"),
    defensiveThreat(matchId, "b-goal-1", 16, 1, "GOL", "gk-b"),
    defensiveThreat(matchId, "b-goal-2", 18, 1, "GOL", "gk-b"),
  ];
  const stats = buildDashboardAnalytics([record(matchId, events)], {
    clubId: "club-a",
    teamId: "team-a",
    seasonId: "season-a",
    matchId,
    period: 1,
  });

  const a = stats.goalkeepers.find((keeper) => keeper.playerId === "gk-a");
  const b = stats.goalkeepers.find((keeper) => keeper.playerId === "gk-b");
  assert.deepEqual(
    a && { minutes: a.minutes, threats: a.threatsAgainst, saves: a.saves, goals: a.goalsAgainst, outside: a.outside },
    { minutes: 10, threats: 4, saves: 2, goals: 1, outside: 1 },
  );
  assert.ok(a?.savePercentage && Math.abs(a.savePercentage - 200 / 3) < 1e-9);
  assert.deepEqual(
    b && { minutes: b.minutes, threats: b.threatsAgainst, saves: b.saves, goals: b.goalsAgainst, outside: b.outside, percentage: b.savePercentage },
    { minutes: 10, threats: 5, saves: 3, goals: 2, outside: 0, percentage: 60 },
  );
  assert.equal(a?.bodyParts.HEAD, 1);
  assert.equal(a?.saveOutcomes.CLEARANCE, 1);
  assert.equal(b?.saveOutcomes.REBOUND, 1);
  assert.equal(stats.threats.AGAINST.FUERA, 1);
  assert.equal(stats.players.find((player) => player.playerId === "gk-a")?.minutes, 10);
  assert.equal(stats.players.find((player) => player.playerId === "gk-b")?.minutes, 10);
});

test("el filtro P1/P2 recalcula replay, marcador y minutos dentro del periodo", () => {
  const matchId = "periods";
  const p1Goal = createLiveThreatEvent({
    id: "p1-goal",
    matchId,
    position: { period: 1, minute: 4, order: 1 },
    side: "FOR",
    playerId: "p2",
    origin: { x: 0.7, y: 0.4 },
    outcome: "GOL",
    phase: "POSITIONAL",
    assist: { status: "NONE" },
    now: 4,
  });
  const p2Lineup = createLineupInitializedEvent({
    id: "p2-lineup",
    matchId,
    position: { period: 2, minute: 0, order: 1 },
    squadPlayerIds: players.map((player) => player.id),
    onCourtPlayerIds: ["gk-b", "p2", "p3", "p4", "p5"],
    goalkeeperPlayerId: "gk-b",
    now: 20,
  });
  const p2Goal = defensiveThreat(matchId, "p2-goal", 5, 1, "GOL", "gk-b");
  p2Goal.period = 2;
  const records = [record(matchId, [lineup(matchId), p1Goal, p2Lineup, p2Goal])];
  const scope = { clubId: "club-a", teamId: "team-a", seasonId: "season-a", matchId };
  const p1 = buildDashboardAnalytics(records, { ...scope, period: 1 });
  const p2 = buildDashboardAnalytics(records, { ...scope, period: 2 });
  const full = buildDashboardAnalytics(records, { ...scope, period: "ALL" });
  assert.deepEqual([p1.goalsFor, p1.goalsAgainst], [1, 0]);
  assert.deepEqual([p2.goalsFor, p2.goalsAgainst], [0, 1]);
  assert.deepEqual([full.goalsFor, full.goalsAgainst], [1, 1]);
  assert.equal(p1.players.find((player) => player.playerId === "gk-a")?.minutes, 20);
  assert.equal(p2.players.find((player) => player.playerId === "gk-b")?.minutes, 20);
});

test("Dashboard cuenta cada amenaza A→B→C y usa la fase efectiva de la raíz", () => {
  const matchId = "second-play";
  const root = defensiveThreat(matchId, "root", 3, 1, "PARADA", "gk-a", {
    saveOutcome: "REBOUND",
  });
  const child = defensiveThreat(matchId, "child", 3, 2, "PARADA", "gk-a", {
    parentEventId: "root",
    sequenceId: "root",
    saveOutcome: "REBOUND",
  });
  const goal = defensiveThreat(matchId, "goal", 3, 3, "GOL", "gk-a", {
    parentEventId: "child",
    sequenceId: "root",
  });
  const ownGoal = createLiveThreatEvent({
    id: "own-goal",
    matchId,
    position: { period: 1, minute: 5, order: 1 },
    side: "FOR",
    playerId: "p2",
    origin: { x: 0.7, y: 0.3 },
    outcome: "GOL",
    phase: "POSITIONAL",
    assist: { status: "PLAYER", playerId: "p3" },
    provenance: "MANUAL_REVIEW",
    now: 60,
  });
  const pendingGoal = createLiveThreatEvent({
    id: "pending-goal",
    matchId,
    position: { period: 1, minute: 7, order: 1 },
    side: "FOR",
    playerId: "p2",
    origin: { x: 0.8, y: 0.4 },
    outcome: "GOL",
    phase: "POSITIONAL",
    assist: { status: "PENDING" },
    now: 70,
  });
  const noAssistGoal = createLiveThreatEvent({
    id: "none-goal",
    matchId,
    position: { period: 1, minute: 9, order: 1 },
    side: "FOR",
    playerId: "p3",
    origin: { x: 0.75, y: 0.5 },
    outcome: "GOL",
    phase: "TRANSITION",
    assist: { status: "NONE" },
    now: 90,
  });
  const events = [lineup(matchId), root, child, goal, ownGoal, pendingGoal, noAssistGoal];
  const stats = buildDashboardAnalytics([record(matchId, events)], {
    clubId: "club-a",
    teamId: "team-a",
    seasonId: "season-a",
  });

  assert.equal(stats.threats.AGAINST.total, 3);
  assert.equal(stats.secondPlay.threats, 2);
  assert.equal(stats.secondPlay.goals, 1);
  assert.equal(stats.secondPlay.reboundsWithThreat, 2);
  assert.equal(stats.phases.TRANSITION.AGAINST, 3);
  assert.equal(stats.goalsFor, 3);
  assert.equal(stats.goalsAgainst, 1);
  assert.equal(stats.players.find((player) => player.playerId === "p2")?.goals, 2);
  assert.equal(stats.players.find((player) => player.playerId === "p3")?.assists, 1);
  assert.equal(stats.quality[0].pendingReview, 1);
  assert.equal(stats.quality[0].manualReviewEvents, 1);
});

test("Dashboard filtra club, equipo, temporada, partido y archivados sin mezclar ámbitos", () => {
  const base = record("included", [lineup("included")]);
  const records = [
    base,
    record("other-season", [lineup("other-season")], { seasonId: "season-b" }),
    record("other-team", [lineup("other-team")], { teamId: "team-b" }),
    record("other-club", [lineup("other-club")], { clubId: "club-b" }),
    record("archived", [lineup("archived")], { archivedAt: 200 }),
  ];
  const scope = { clubId: "club-a", teamId: "team-a", seasonId: "season-a" };
  assert.deepEqual(
    filterDashboardMatches(records, scope).map(({ catalog }) => catalog.matchId),
    ["included"],
  );
  assert.deepEqual(
    filterDashboardMatches(records, { ...scope, includeArchived: true }).map(
      ({ catalog }) => catalog.matchId,
    ),
    ["included", "archived"],
  );
  assert.equal(buildDashboardAnalytics(records, scope).matches, 1);
  assert.equal(
    buildDashboardAnalytics(records, { ...scope, matchId: "not-present" }).matches,
    0,
  );
});

test("disciplina cuenta faltas genéricas y tarjetas sin inventar jugador", () => {
  const matchId = "discipline";
  const events = [
    lineup(matchId),
    createFoulEvent({ id: "f1", matchId, position: { period: 1, minute: 1, order: 1 }, side: "FOR", playerId: null, now: 2 }),
    createFoulEvent({ id: "f2", matchId, position: { period: 1, minute: 2, order: 1 }, side: "AGAINST", playerId: null, now: 3 }),
    createCardEvent({ id: "c1", matchId, position: { period: 1, minute: 3, order: 1 }, side: "FOR", color: "YELLOW", playerId: "p2", now: 4 }),
    createCardEvent({ id: "c2", matchId, position: { period: 1, minute: 4, order: 1 }, side: "AGAINST", color: "RED", now: 5 }),
  ];
  const stats = buildDashboardAnalytics([record(matchId, events)], {
    clubId: "club-a",
    teamId: "team-a",
    seasonId: "season-a",
  });
  assert.deepEqual(stats.discipline, {
    for: { fouls: 1, yellowCards: 1, redCards: 0 },
    against: { fouls: 1, yellowCards: 0, redCards: 1 },
  });
});
