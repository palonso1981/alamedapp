import assert from "node:assert/strict";
import test from "node:test";

import { MatchEvent } from "../types";
import { DashboardMatchRecord } from "./dashboardAnalytics";
import { PitchOriginZone } from "./dashboardAnalysis";
import { competitiveEventIds, deriveCompetitiveMinutes, isCompetitiveMoment } from "./dashboardCompetitiveContext";
import { buildDashboardFixture, DASHBOARD_FIXTURE_CLUB_ID, DASHBOARD_FIXTURE_SEASON_ID, DASHBOARD_FIXTURE_TEAM_ID } from "./dashboardFixture";
import { compareMetricValues, METRIC_DEFINITIONS } from "./dashboardMetricDefinitions";
import { dashboardMapPointTitle, resolveDashboardMapPoint } from "./dashboardTrace";
import { createLineupInitializedEvent, createLiveThreatEvent, editEvent } from "./matchEngine";
import {
  buildDashboardV2,
  buildPlayerScores,
  derivedThreatSummary,
  emptyDashboardScope,
  filterDashboardDataset,
  mergeDashboardSearchParams,
  outcomeDistribution,
  playerMetricValue,
  referenceScopeForPreset,
  scopeFromSearchParams,
  stableSortByMetric,
  teamMetricValue,
} from "./dashboardV2";

const baseScope = () => emptyDashboardScope(
  DASHBOARD_FIXTURE_CLUB_ID,
  DASHBOARD_FIXTURE_TEAM_ID,
  DASHBOARD_FIXTURE_SEASON_ID,
);

test("scope acumulativo aplica OR dentro de dimensión y AND entre dimensiones", () => {
  const records = buildDashboardFixture();
  const scope = {
    ...baseScope(),
    rivals: ["Racing Norte", "Sala Centro"],
    venues: ["AWAY" as const],
    period: 2 as const,
    phases: ["SET_PIECE_CORNER" as const, "SET_PIECE_KICK_IN" as const],
    originZones: ["Z2" as const, "Z5" as const],
  };
  const filtered = filterDashboardDataset(records, scope);
  assert.ok(filtered.every((record) => scope.rivals.includes(record.catalog.opponent)));
  assert.ok(filtered.every((record) => record.catalog.venue === "AWAY"));
  for (const record of filtered) {
    const threats = record.session.events.filter((event) => event.type === "threat_recorded");
    assert.ok(threats.every((event) => event.period === 2));
    assert.ok(threats.every((event) => scope.phases.includes(event.phase as typeof scope.phases[number])));
  }
});

test("ABP agrega córner, banda y falta sin incluir fases abiertas", () => {
  const filtered = filterDashboardDataset(buildDashboardFixture(), { ...baseScope(), phases: ["SET_PIECE"] });
  const phases = filtered.flatMap((record) => record.session.events)
    .filter((event) => event.type === "threat_recorded")
    .map((event) => event.phase);
  assert.ok(phases.length > 0);
  assert.ok(phases.every((phase) => ["SET_PIECE_CORNER", "SET_PIECE_KICK_IN", "SET_PIECE_FREE_KICK"].includes(phase)));
});

test("scope y referencia viajan separados por URL y sobreviven reload", () => {
  const analysis = { ...baseScope(), rivals: ["Racing Norte", "Sala Centro"], originZones: ["Z2" as const], period: 2 as const, outcomeGroup: "ON_TARGET" as const, originDistance: "NEAR" as const, competitiveContext: "GOLD" as const };
  const reference = { ...baseScope(), venues: ["AWAY" as const], period: 2 as const };
  const query = mergeDashboardSearchParams({ analysis, reference, referencePreset: "AWAY", mode: "PER_40", area: "PLAYERS" });
  const params = new URLSearchParams(query);
  assert.deepEqual(scopeFromSearchParams(params, "a", baseScope()), analysis);
  assert.deepEqual(scopeFromSearchParams(params, "r", baseScope()), reference);
  assert.equal(params.get("mode"), "PER_40");
  assert.equal(params.get("area"), "PLAYERS");
});

test("cambiar referencia no modifica analysisScope", () => {
  const analysis = { ...baseScope(), rivals: ["Racing Norte"], period: 2 as const, phases: ["SET_PIECE_CORNER" as const] };
  const snapshot = structuredClone(analysis);
  const reference = referenceScopeForPreset(analysis, "AWAY");
  assert.deepEqual(analysis, snapshot);
  assert.deepEqual(reference.venues, ["AWAY"]);
  assert.deepEqual(reference.rivals, []);
  assert.equal(reference.period, 2);
  assert.deepEqual(reference.phases, ["SET_PIECE_CORNER"]);
});

function pointsRecord(id: string, goalsFor: number, goalsAgainst: number): DashboardMatchRecord {
  const source = buildDashboardFixture()[0];
  const lineup = createLineupInitializedEvent({
    id: `${id}-lineup`, matchId: id, position: { period: 1, minute: 0, order: 1 },
    squadPlayerIds: source.session.players.map((player) => player.id),
    onCourtPlayerIds: ["fx-gk-1", "fx-p-2", "fx-p-4", "fx-p-5", "fx-p-7"],
    goalkeeperPlayerId: "fx-gk-1", now: 1,
  });
  const events: MatchEvent[] = [lineup];
  for (let index = 0; index < goalsFor; index += 1) events.push(createLiveThreatEvent({ id: `${id}-gf-${index}`, matchId: id, position: { period: 1, minute: index + 1, order: 1 }, side: "FOR", playerId: "fx-p-4", origin: { x: .5, y: .5 }, outcome: "GOL", phase: "POSITIONAL", assist: { status: "NONE" }, now: index + 2 }));
  for (let index = 0; index < goalsAgainst; index += 1) events.push(createLiveThreatEvent({ id: `${id}-gc-${index}`, matchId: id, position: { period: 1, minute: index + 10, order: 1 }, side: "AGAINST", origin: { x: .5, y: .5 }, outcome: "GOL", phase: "POSITIONAL", defensive: { version: 2, goalTarget: { x: .5, y: .5, geometryVersion: 3 }, goalkeeper: { status: "PLAYER", playerId: "fx-gk-1" } }, now: index + 20 }));
  return {
    catalog: { ...source.catalog, matchId: id, opponent: id, venue: "HOME", date: `2026-08-${id.endsWith("a") ? "01" : id.endsWith("b") ? "02" : "03"}` },
    session: { ...source.session, matchId: id, preparation: { ...source.session.preparation!, opponent: id }, events },
  };
}

test("PTS EN PISTA usa el parcial de cada jugador, no el resultado final agregado", () => {
  const records = [pointsRecord("points-a", 2, 1), pointsRecord("points-b", 0, 0), pointsRecord("points-c", 1, 3)];
  const analysis = buildDashboardV2(records, baseScope());
  const player = analysis.players.find((candidate) => candidate.playerId === "fx-p-4")!;
  assert.equal(player.onCourtPoints, 4);
  assert.equal(player.onCourtPointsPerMatch, 4 / 3);
});

test("modos usan denominadores compatibles y N/D sin minutos", () => {
  const analysis = buildDashboardV2(buildDashboardFixture(), baseScope());
  assert.equal(teamMetricValue(analysis, "threatsFor", "TOTALS"), analysis.analytics.threats.FOR.total);
  assert.equal(teamMetricValue(analysis, "threatsFor", "PER_MATCH"), analysis.analytics.threats.FOR.total / analysis.samples);
  assert.equal(teamMetricValue(analysis, "threatsFor", "PER_40"), analysis.rates.threatsFor40);
  const player = analysis.players[0];
  assert.equal(playerMetricValue(player, "goals", "PER_MATCH"), player.goals / player.matches);
  assert.equal(playerMetricValue(player, "points", "PER_40"), null);
});

test("distribución conserva cantidades y porcentajes suma 100", () => {
  const distribution = outcomeDistribution({ total: 10, GOL: 2, PARADA: 5, FUERA: 3, BLOQUEADO: 0 });
  assert.deepEqual(distribution.map((item) => item.count), [2, 5, 3]);
  assert.equal(distribution.reduce((sum, item) => sum + (item.percentage ?? 0), 0), 100);
});

test("SCORE ALAM aplica percentiles, inversión, reliability y protege muestras pequeñas", () => {
  const analysis = buildDashboardV2(buildDashboardFixture(), baseScope());
  const scores = buildPlayerScores(analysis.players);
  assert.ok(scores.filter((score) => score.score !== null).length >= 3);
  assert.ok(scores.every((score) => score.score === null || (score.score >= 0 && score.score <= 100)));
  const player = analysis.players[0];
  const low = buildPlayerScores([
    { ...player, playerId: "low", minutes: 4, goals: 1, goals40: 10 },
    { ...player, playerId: "two", minutes: 80, goals40: 0 },
    { ...player, playerId: "three", minutes: 80, goals40: 0 },
  ]).find((score) => score.playerId === "low")!;
  assert.ok(low.score !== null && Math.abs(low.score - 50) < 5, "4 minutos deben contraer el score hacia 50");
  assert.equal(buildPlayerScores([player, { ...player, playerId: "two" }]).every((score) => score.score === null), true);
});

test("ordenación cuantitativa deja N/D al final y conserva empates", () => {
  const rows = [{ id: "a", value: 2 }, { id: "b", value: null }, { id: "c", value: 2 }, { id: "d", value: 1 }];
  assert.deepEqual(stableSortByMetric(rows, (row) => row.value, "asc").map((row) => row.id), ["d", "a", "c", "b"]);
  assert.deepEqual(stableSortByMetric(rows, (row) => row.value, "desc").map((row) => row.id), ["a", "c", "d", "b"]);
});

test("fixture poblado cubre temporada, sedes, resultados, jugadores, porteros, fases y P-J sin persistir", () => {
  const records = buildDashboardFixture();
  const analysis = buildDashboardV2(records, baseScope());
  assert.equal(records.length, 8);
  assert.ok(records.some((record) => record.catalog.venue === "HOME"));
  assert.ok(records.some((record) => record.catalog.venue === "AWAY"));
  assert.ok(analysis.players.length >= 8);
  assert.ok(analysis.goalkeepers.length >= 2);
  assert.ok(analysis.players.some((player) => Boolean(player.photoUrl)));
  assert.ok(analysis.players.some((player) => !player.photoUrl));
  assert.ok(analysis.flyingGoalkeeper.for.minutes > 0);
  assert.ok(analysis.analytics.threats.FOR.total > 0 && analysis.analytics.threats.AGAINST.total > 0);
  assert.ok(Object.values(analysis.analytics.phases).filter((phase) => phase.FOR + phase.AGAINST > 0).length >= 6);
});

test("definiciones centrales mantienen fórmulas, denominadores y dirección semántica", () => {
  assert.equal(METRIC_DEFINITIONS.ON_TARGET.formula, "GOL + PARADA");
  assert.equal(METRIC_DEFINITIONS.NEAR_ZONE.formula, "Z1 + Z2 + Z3");
  assert.match(METRIC_DEFINITIONS.KEY_MINUTES.formula, /≤ 1/);
  assert.match(METRIC_DEFINITIONS.GOLD_MINUTES.formula, /P2/);
  assert.equal(compareMetricValues("SAVE_PERCENTAGE", 70, 60), "LEFT");
  assert.equal(compareMetricValues("THREATS_AGAINST_40", 7, 9), "LEFT");
  assert.equal(compareMetricValues("MINUTES", 20, 10), "NONE");
});

test("A PUERTA y CERCANAS son derivaciones objetivas e intersectables", () => {
  const source = buildDashboardFixture()[0];
  const events: MatchEvent[] = source.session.events.filter((event) => event.type !== "threat_recorded");
  const outcomes = ["GOL", "GOL", "GOL", "PARADA", "PARADA", "PARADA", "PARADA", "PARADA", "FUERA", "FUERA"] as const;
  outcomes.forEach((outcome, index) => events.push(createLiveThreatEvent({ id: `metric-${index}`, matchId: source.catalog.matchId, position: { period: 1, minute: index + 1, order: 1 }, side: "FOR", playerId: "fx-p-4", origin: index < 6 ? { x: .1, y: (index % 3 + .5) / 3 } : { x: .7, y: .5 }, outcome, phase: "POSITIONAL", assist: outcome === "GOL" ? { status: "NONE" } : undefined, now: index + 100 })));
  const record = { ...source, session: { ...source.session, events } };
  const all = buildDashboardV2([record], baseScope());
  assert.equal(all.analytics.threats.FOR.total, 10);
  assert.deepEqual(derivedThreatSummary(events, "FOR"), { total: 10, onTarget: 8, onTargetPercentage: 80, near: 6, nearPercentage: 60 });
  const intersection = buildDashboardV2([record], { ...baseScope(), outcomeGroup: "ON_TARGET", originDistance: "NEAR" });
  assert.equal(intersection.analytics.threats.FOR.total, 6);
});

test("contexto clave y oro usa marcador cronológico y solo minuto deportivo capturado", () => {
  assert.equal(isCompetitiveMoment("KEY", 1, 5, 0, 0), true);
  assert.equal(isCompetitiveMoment("KEY", 1, 5, 2, 0), false);
  assert.equal(isCompetitiveMoment("KEY", 1, 5, 2, 1), true);
  assert.equal(isCompetitiveMoment("GOLD", 2, 14, 1, 1), false);
  assert.equal(isCompetitiveMoment("GOLD", 2, 15, 1, 1), true);
  assert.equal(isCompetitiveMoment("GOLD", 2, 18, 3, 1), false);
  const session = buildDashboardFixture()[0].session;
  const key = deriveCompetitiveMinutes(session, "ALL", "KEY");
  const gold = deriveCompetitiveMinutes(session, "ALL", "GOLD");
  assert.ok(key.observed >= gold.observed);
  assert.ok(Array.from(competitiveEventIds(session, "ALL", "GOLD")).every((id) => session.events.some((event) => event.id === id)));
});

test("trazabilidad resuelve coordenadas duplicadas únicamente por matchId + eventId", () => {
  const record = buildDashboardFixture()[0];
  const threats = record.session.events.filter((event) => event.type === "threat_recorded");
  assert.ok(threats.length >= 2);
  const wanted = threats[1];
  const point = { matchId: record.catalog.matchId, eventId: wanted.id, side: wanted.side, outcome: wanted.outcome, x: threats[0].origin.x, y: threats[0].origin.y };
  const resolved = resolveDashboardMapPoint([record], point);
  assert.equal(resolved?.event.id, wanted.id);
  assert.match(dashboardMapPointTitle([record], point), new RegExp(`P${wanted.period} · min ${wanted.minute}`));
  assert.doesNotMatch(dashboardMapPointTitle([record], point), /\d{1,2}:\d{2}/);
});

test("editar un evento conserva la hora real original de captura", () => {
  const record = buildDashboardFixture()[0];
  const target = record.session.events.find((event) => event.type === "threat_recorded")!;
  const result = editEvent(record.session.players, record.session.events, target.id, { minute: target.minute + 1 }, target.createdAt + 999_000);
  const edited = result.find((event) => event.id === target.id)!;
  assert.equal(edited.createdAt, target.createdAt);
  assert.ok(edited.updatedAt > edited.createdAt);
});

test("evolución se ordena cronológicamente y respeta el filtro visitante", () => {
  const input = buildDashboardFixture().reverse();
  const all = buildDashboardV2(input, baseScope());
  assert.deepEqual(all.trends.map((item) => item.date), [...all.trends.map((item) => item.date)].sort());
  const away = buildDashboardV2(input, { ...baseScope(), venues: ["AWAY"] });
  assert.ok(away.trends.length > 0);
  assert.ok(away.trends.every((item) => item.venue === "AWAY"));
  assert.deepEqual(away.trends.map((item) => item.date), [...away.trends.map((item) => item.date)].sort());
});

test("filtro de zona, fase y rival conserva la intersección y el click no borra filtros previos", () => {
  const records = buildDashboardFixture();
  const candidate = records.flatMap((record) => record.session.events.map((event) => ({ record, event }))).find(({ event }) => event.type === "threat_recorded" && event.side === "AGAINST" && event.outcome !== "FUERA");
  assert.ok(candidate && candidate.event.type === "threat_recorded");
  if (!candidate || candidate.event.type !== "threat_recorded") return;
  const phase = candidate.event.phase;
  const zone: PitchOriginZone = candidate.event.origin.x >= .25 ? (candidate.event.origin.y >= 2 / 3 ? "Z4" : candidate.event.origin.y <= 1 / 3 ? "Z6" : "Z5") : (candidate.event.origin.y >= 2 / 3 ? "Z1" : candidate.event.origin.y <= 1 / 3 ? "Z3" : "Z2");
  const scope = { ...baseScope(), rivals: [candidate.record.catalog.opponent], phases: [phase], originZones: [zone] };
  const filtered = filterDashboardDataset(records, scope);
  const threats = filtered.flatMap((record) => record.session.events).filter((event) => event.type === "threat_recorded");
  assert.ok(threats.length > 0);
  assert.ok(filtered.every((record) => record.catalog.opponent === candidate.record.catalog.opponent));
  assert.ok(threats.every((event) => event.phase === phase));
});
