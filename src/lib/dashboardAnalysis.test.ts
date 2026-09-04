import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDashboardAnalysis,
  compareAnalysisMetric,
  compareToAverage,
  derivePitchOriginZone,
  filterAnalysisMatches,
  per40,
} from "./dashboardAnalysis";
import {
  createFoulEvent,
  createLineupInitializedEvent,
  createLiveThreatEvent,
  createSubstitutionEvent,
} from "./matchEngine";
import { DashboardMatchRecord } from "./dashboardAnalytics";
import { MatchEvent, MatchSession, Player } from "../types";

const players: Player[] = [
  { id: "a", name: "A", number: 4, position: "FIXO", naturalPosition: "FIXO", photoUrl: "https://example.test/a.jpg", dominantFoot: "RIGHT" },
  { id: "b", name: "B", number: 5, position: "JUGADOR" },
  { id: "c", name: "C", number: 6, position: "JUGADOR" },
  { id: "d", name: "D", number: 7, position: "JUGADOR" },
  { id: "gk", name: "GK", number: 1, position: "PORTERO", goalkeeperCapable: true },
  { id: "sub", name: "SUB", number: 8, position: "JUGADOR" },
];

function lineup(matchId: string, period = 1): MatchEvent {
  return createLineupInitializedEvent({ id: `${matchId}-l${period}`, matchId, position: { period, minute: 0, order: 1 }, squadPlayerIds: players.map((player) => player.id), onCourtPlayerIds: ["a", "b", "c", "d", "gk"], goalkeeperPlayerId: "gk", now: period });
}

function makeRecord(matchId: string, events: MatchEvent[], venue: "HOME" | "AWAY" = "HOME", archivedAt?: number): DashboardMatchRecord {
  const preparation = { clubId: "club", teamId: "team", seasonId: "season", opponent: matchId, venue, date: "2026-09-04", status: "FINISHED" as const, calledPlayerIds: players.map((player) => player.id), starterPlayerIds: ["a", "b", "c", "d", "gk"], startingGoalkeeperId: "gk", selectedStaffIds: [], targetMinutes: {}, createdAt: 1, updatedAt: 2, archivedAt };
  const session: MatchSession = { matchId, preparation, players, staff: [], period: 2, minute: 20, periodMinutes: { 1: 20, 2: 20 }, closedPeriods: [1, 2], matchFinished: true, reviewStatus: "VALIDATED", events, past: [], future: [], lastError: null, persistenceStatus: "saved", lastSavedAt: 2 };
  return { catalog: { matchId, clubId: "club", teamId: "team", seasonId: "season", opponent: matchId, venue, date: "2026-09-04", status: "FINISHED", updatedAt: 2, archivedAt }, session };
}

function ownThreat(matchId: string, id: string, minute: number, playerId = "a", outcome: "GOL" | "PARADA" | "FUERA" = "PARADA", period = 1): MatchEvent {
  return createLiveThreatEvent({ id, matchId, position: { period, minute, order: 1 }, side: "FOR", playerId, origin: { x: 0.2 + minute / 100, y: 0.5 }, outcome, phase: "POSITIONAL", assist: outcome === "GOL" ? { status: "NONE" } : undefined, now: minute });
}

function rivalThreat(matchId: string, id: string, minute: number, outcome: "GOL" | "PARADA" | "FUERA" = "PARADA"): MatchEvent {
  return createLiveThreatEvent({ id, matchId, position: { period: 1, minute, order: 2 }, side: "AGAINST", origin: { x: 0.2, y: 0.5 }, outcome, phase: "TRANSITION", defensive: { version: 2, goalTarget: { x: outcome === "FUERA" ? 0.1 : 0.5, y: 0.5, geometryVersion: 3 }, goalkeeper: { status: "PLAYER", playerId: "gk", resolution: "REPLAY" }, keeperBodyPart: outcome === "PARADA" ? "TORSO" : undefined, saveOutcome: outcome === "PARADA" ? "CATCH" : undefined }, now: minute });
}

test("comparador usa media y diferencia absoluta; sin muestra devuelve N/D", () => {
  assert.deepEqual(compareToAverage(14, 54, 5), { value: 14, reference: 10.8, difference: 3.1999999999999993 });
  assert.deepEqual(compareToAverage(14, 0, 0), { value: 14, reference: null, difference: null });
  assert.equal(per40(5, 10), 20);
  assert.equal(per40(5, 0), null);
});

test("filtros local/visitante y victoria/derrota derivan el resultado del replay", () => {
  const win = makeRecord("win", [lineup("win"), ownThreat("win", "wg", 2, "a", "GOL")], "HOME");
  const loss = makeRecord("loss", [lineup("loss"), rivalThreat("loss", "lg", 2, "GOL")], "AWAY");
  const base = { clubId: "club", teamId: "team", seasonId: "season" };
  assert.deepEqual(filterAnalysisMatches([win, loss], { ...base, venue: "HOME" }).map((item) => item.catalog.matchId), ["win"]);
  assert.deepEqual(filterAnalysisMatches([win, loss], { ...base, result: "LOSS" }).map((item) => item.catalog.matchId), ["loss"]);
  const current = buildDashboardAnalysis([win], { ...base, matchId: "win" });
  const reference = buildDashboardAnalysis([win, loss], base);
  assert.deepEqual(compareAnalysisMetric(current, reference, "goalsFor"), { value: 1, reference: 0.5, difference: 0.5 });
});

test("jugador separa acción propia de eventos del equipo con él en pista y normaliza /40", () => {
  const matchId = "on-court";
  const events: MatchEvent[] = [lineup(matchId)];
  for (let minute = 1; minute <= 5; minute += 1) events.push(ownThreat(matchId, `for-${minute}`, minute, minute === 1 ? "a" : "b", minute <= 2 ? "GOL" : "PARADA"));
  events.push(rivalThreat(matchId, "against-1", 6, "GOL"), rivalThreat(matchId, "against-2", 7, "PARADA"));
  events.push(createSubstitutionEvent({ id: "a-out", matchId, position: { period: 1, minute: 10, order: 1 }, playerOutId: "a", playerInId: "sub", now: 10 }));
  events.push(ownThreat(matchId, "after", 12, "b", "GOL"));
  const analysis = buildDashboardAnalysis([makeRecord(matchId, events)], { clubId: "club", teamId: "team", seasonId: "season", matchId, period: 1 });
  const a = analysis.players.find((player) => player.playerId === "a")!;
  assert.deepEqual({ minutes: a.minutes, own: a.ownThreats, for: a.onCourt.threatsFor, against: a.onCourt.threatsAgainst, gf: a.onCourt.goalsFor, gc: a.onCourt.goalsAgainst, plusMinus: a.onCourt.goalDifference }, { minutes: 10, own: 1, for: 5, against: 2, gf: 2, gc: 1, plusMinus: 1 });
  assert.deepEqual({ for40: a.onCourt.threatsFor40, against40: a.onCourt.threatsAgainst40, gf40: a.onCourt.goalsFor40, gc40: a.onCourt.goalsAgainst40 }, { for40: 20, against40: 8, gf40: 8, gc40: 4 });
  assert.equal(a.lowSample, true);
  assert.equal(a.photoUrl, "https://example.test/a.jpg");
  assert.equal(a.trend[0].minutes, 10);
});

test("jugador acumula varios intervalos y excluye eventos ocurridos en banquillo", () => {
  const matchId = "multiple-intervals";
  const events: MatchEvent[] = [
    lineup(matchId),
    ownThreat(matchId, "before", 2, "b"),
    createSubstitutionEvent({ id: "a-out-1", matchId, position: { period: 1, minute: 5, order: 1 }, playerOutId: "a", playerInId: "sub", now: 5 }),
    ownThreat(matchId, "bench", 7, "b"),
    createSubstitutionEvent({ id: "a-in-2", matchId, position: { period: 1, minute: 10, order: 1 }, playerOutId: "sub", playerInId: "a", now: 10 }),
    ownThreat(matchId, "after", 12, "b"),
  ];
  const analysis = buildDashboardAnalysis([makeRecord(matchId, events)], { clubId: "club", teamId: "team", seasonId: "season", period: 1 });
  const player = analysis.players.find((item) => item.playerId === "a")!;
  assert.equal(player.minutes, 15);
  assert.equal(player.onCourt.threatsFor, 2);
  assert.equal(player.ownThreats, 0);
});

test("comparación P1/P2 mantiene muestras y denominadores separados", () => {
  const first = makeRecord("period-a", [lineup("period-a"), ownThreat("period-a", "p1", 4), lineup("period-a", 2), ownThreat("period-a", "p2-a", 4, "a", "PARADA", 2), ownThreat("period-a", "p2-b", 5, "a", "PARADA", 2)]);
  const second = makeRecord("period-b", [lineup("period-b"), ownThreat("period-b", "p1-a", 4), ownThreat("period-b", "p1-b", 5), lineup("period-b", 2)]);
  const scope = { clubId: "club", teamId: "team", seasonId: "season" };
  const currentP1 = buildDashboardAnalysis([first], { ...scope, matchId: "period-a", period: 1 });
  const meanP1 = buildDashboardAnalysis([first, second], { ...scope, period: 1 });
  const sameMatchP2 = buildDashboardAnalysis([first], { ...scope, matchId: "period-a", period: 2 });
  assert.deepEqual(compareAnalysisMetric(currentP1, meanP1, "threatsFor"), { value: 1, reference: 1.5, difference: -0.5 });
  assert.deepEqual(compareAnalysisMetric(currentP1, sameMatchP2, "threatsFor"), { value: 1, reference: 2, difference: -1 });
  assert.equal(currentP1.rates.observedMinutes, 20);
  assert.equal(sameMatchP2.rates.observedMinutes, 20);
});

test("faltas F5+ son críticas, reinician en P2 y una genérica no inventa jugador", () => {
  const matchId = "critical";
  const events: MatchEvent[] = [lineup(matchId)];
  for (let index = 1; index <= 7; index += 1) events.push(createFoulEvent({ id: `f${index}`, matchId, position: { period: 1, minute: index, order: 1 }, side: "FOR", playerId: index === 5 ? "a" : index === 6 ? "b" : null, now: index }));
  events.push(lineup(matchId, 2));
  events.push(createFoulEvent({ id: "p2-f1", matchId, position: { period: 2, minute: 1, order: 1 }, side: "FOR", playerId: "a", now: 21 }));
  const analysis = buildDashboardAnalysis([makeRecord(matchId, events)], { clubId: "club", teamId: "team", seasonId: "season" });
  assert.equal(analysis.criticalFouls.for, 3);
  assert.equal(analysis.players.find((player) => player.playerId === "a")?.criticalFoulsCommitted, 1);
  assert.equal(analysis.players.find((player) => player.playerId === "b")?.criticalFoulsCommitted, 1);
});

test("zonas 1–6 respetan derecha e izquierda del portero y bordes", () => {
  assert.equal(derivePitchOriginZone({ x: 0.1, y: 0.9 }), "Z1");
  assert.equal(derivePitchOriginZone({ x: 0.1, y: 0.5 }), "Z2");
  assert.equal(derivePitchOriginZone({ x: 0.1, y: 0.1 }), "Z3");
  assert.equal(derivePitchOriginZone({ x: 0.25, y: 2 / 3 }), "Z4");
  assert.equal(derivePitchOriginZone({ x: 0.25, y: 0.5 }), "Z5");
  assert.equal(derivePitchOriginZone({ x: 0.25, y: 1 / 3 }), "Z6");
});

test("portero conserva mapa target propio, grid 3×2, bodyPart y outcome", () => {
  const matchId = "keeper-map";
  const events = [lineup(matchId), rivalThreat(matchId, "save", 2, "PARADA"), rivalThreat(matchId, "goal", 4, "GOL"), rivalThreat(matchId, "out", 6, "FUERA")];
  const analysis = buildDashboardAnalysis([makeRecord(matchId, events)], { clubId: "club", teamId: "team", seasonId: "season", period: 1 });
  const keeper = analysis.goalkeepers[0];
  assert.equal(keeper.goalPoints.length, 3);
  assert.equal(keeper.bodyParts.TORSO, 1);
  assert.equal(keeper.saveOutcomes.CATCH, 1);
  assert.equal(keeper.interiorThreats, 2);
  assert.equal(analysis.goalZones.reduce((sum, zone) => sum + zone.threats, 0), 2);
});

test("cambio de portero atribuye minutos y targets al rol funcional del instante", () => {
  const matchId = "keeper-change";
  const events: MatchEvent[] = [
    lineup(matchId),
    rivalThreat(matchId, "gk-save", 4, "PARADA"),
    createSubstitutionEvent({ id: "keeper-out", matchId, position: { period: 1, minute: 10, order: 1 }, playerOutId: "gk", playerInId: "sub", now: 10 }),
    rivalThreat(matchId, "sub-goal", 12, "GOL"),
  ];
  const analysis = buildDashboardAnalysis([makeRecord(matchId, events)], { clubId: "club", teamId: "team", seasonId: "season", period: 1 });
  const original = analysis.goalkeepers.find((keeper) => keeper.playerId === "gk")!;
  const replacement = analysis.goalkeepers.find((keeper) => keeper.playerId === "sub")!;
  assert.deepEqual({ minutes: original.minutes, threats: original.threatsAgainst, targets: original.goalPoints.length }, { minutes: 10, threats: 1, targets: 1 });
  assert.deepEqual({ minutes: replacement.minutes, threats: replacement.threatsAgainst, targets: replacement.goalPoints.length }, { minutes: 10, threats: 1, targets: 1 });
});

test("datos de ficha conservan foto opcional, identidad y N/D sin denominador", () => {
  const matchId = "profile";
  const record = makeRecord(matchId, [lineup(matchId), ownThreat(matchId, "shot", 3, "a", "GOL")]);
  record.session.preparation!.targetMinutes = { a: 12 };
  const analysis = buildDashboardAnalysis([record], { clubId: "club", teamId: "team", seasonId: "season", matchId, period: 1 });
  const withPhoto = analysis.players.find((player) => player.playerId === "a")!;
  const withoutPhoto = analysis.players.find((player) => player.playerId === "b")!;
  assert.deepEqual({ photo: withPhoto.photoUrl, number: withPhoto.number, goals: withPhoto.goals, shots: withPhoto.ownShotPoints.length, target: withPhoto.targetMinutes }, { photo: "https://example.test/a.jpg", number: 4, goals: 1, shots: 1, target: 12 });
  assert.equal(withoutPhoto.photoUrl, undefined);
  assert.equal(per40(0, 0), null);
});
