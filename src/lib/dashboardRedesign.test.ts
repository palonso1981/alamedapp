import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardFixture, DASHBOARD_FIXTURE_CLUB_ID, DASHBOARD_FIXTURE_SEASON_ID, DASHBOARD_FIXTURE_TEAM_ID } from "./dashboardFixture";
import { dashboardMetricDistribution } from "./dashboardDistribution";
import { describeDistribution, habitualPosition, MIN_MATCHES_FOR_HABITUAL_RANGE } from "./distributionStatistics";
import { buildDashboardV2, dashboardActiveFilterCount, DASHBOARD_AREAS, emptyDashboardScope, normalizeDashboardArea, phaseImpactShare, scopeFromSearchParams, scopeToSearchParams, teamThreatProfile } from "./dashboardV2";
import { aggregateGoalkeepers } from "./dashboardAnalysis";
import { sharedMetricMaximum } from "./distributionStatistics";
import { dashboardScopeToVideoFilters, dashboardVideoHref, suggestedDashboardCollectionName } from "./dashboardVideoContext";
import { orderPhaseRows, phaseImpactDelta } from "./dashboardPhaseImpact";
import { buildDashboardPhaseDataRows, buildDashboardSetPieceDataRows } from "./dashboardDataTables";
import { buildGoalkeeperComparisonPanels, sortGoalkeeperRows } from "./dashboardGoalkeeperView";

const fixtureScope = () => emptyDashboardScope(DASHBOARD_FIXTURE_CLUB_ID, DASHBOARD_FIXTURE_TEAM_ID, DASHBOARD_FIXTURE_SEASON_ID);

test("rango habitual usa P25–P75 R-7 y exige cuatro partidos", () => {
  const stats = describeDistribution([1, 2, 3, 4]);
  assert.equal(MIN_MATCHES_FOR_HABITUAL_RANGE, 4);
  assert.equal(stats.p25, 1.75);
  assert.equal(stats.p75, 3.25);
  assert.equal(habitualPosition(2.5, stats), "within");
  assert.equal(habitualPosition(9, describeDistribution([1, 2, 3])), "unavailable");
});

test("pérdidas se distribuyen por partido y respetan el universo de referencia", () => {
  const records = buildDashboardFixture();
  const all = dashboardMetricDistribution(records, fixtureScope(), "possessionLosses", "TOTALS");
  const one = dashboardMetricDistribution(records, { ...fixtureScope(), matchIds: [records[0].catalog.matchId] }, "possessionLosses", "TOTALS");
  assert.equal(all.stats.n, records.length);
  assert.equal(one.stats.n, 1);
  assert.ok((one.stats.mean ?? 0) > 0);
});

test("porcentaje de parada usa paradas entre paradas más goles y protege cero", () => {
  const profile = teamThreatProfile(buildDashboardFixture().flatMap((record) => record.session.events), "AGAINST");
  assert.equal(profile.goalkeeperSavePercentage, profile.saves + profile.goals > 0 ? profile.saves / (profile.saves + profile.goals) * 100 : null);
  assert.equal(teamThreatProfile([], "AGAINST").goalkeeperSavePercentage, null);
});

test("fases separan peso en volumen y peso en goles con denominadores correctos", () => {
  const records = buildDashboardFixture();
  const positional = phaseImpactShare(records, "POSITIONAL", "FOR");
  assert.equal(positional.volumePercentage, positional.totalEvents ? positional.phaseEvents / positional.totalEvents * 100 : null);
  assert.equal(positional.goalPercentage, positional.totalGoals ? positional.phaseGoals / positional.totalGoals * 100 : null);
  const empty = phaseImpactShare([], "POSITIONAL", "FOR");
  assert.equal(empty.volumePercentage, null);
  assert.equal(empty.goalPercentage, null);
});

test("filtros de portero se serializan y recalculan la selección sin schema paralelo", () => {
  const records = buildDashboardFixture();
  const scope = { ...fixtureScope(), keeperBodyParts: ["TORSO" as const], saveOutcomes: ["CATCH" as const] };
  const restored = scopeFromSearchParams(scopeToSearchParams(scope, "a"), "a", fixtureScope());
  assert.deepEqual(restored.keeperBodyParts, ["TORSO"]);
  assert.deepEqual(restored.saveOutcomes, ["CATCH"]);
  const filtered = buildDashboardV2(records, scope);
  assert.ok(filtered.records.flatMap((record) => record.session.events).filter((event) => event.type === "threat_recorded").every((event) => event.defensive?.version === 2 && event.defensive.keeperBodyPart === "TORSO" && event.defensive.saveOutcome === "CATCH"));
});

test("navegación fusiona EQUIPO en RESUMEN sin ruta muerta", () => {
  assert.equal(DASHBOARD_AREAS.includes("TEAM" as never), false);
  assert.equal(normalizeDashboardArea("TEAM"), "SUMMARY");
  assert.equal(normalizeDashboardArea("GOALKEEPERS"), "GOALKEEPERS");
  assert.equal(normalizeDashboardArea("DATA"), "DATA");
});

test("DATOS deriva volumen, totales y ratios desde el evento de equipo", () => {
  const records = buildDashboardFixture();
  const rows = buildDashboardPhaseDataRows(records, records.map((record) => [record]), "FOR", "TOTALS", buildDashboardV2(records, fixtureScope()).rates.observedMinutes);
  const body = rows.filter((row) => row.key !== "TOTAL");
  const total = rows.find((row) => row.key === "TOTAL")!;
  assert.equal(total.rawCount, body.reduce((sum, row) => sum + row.rawCount, 0));
  assert.equal(total.rawGoals, body.reduce((sum, row) => sum + row.rawGoals, 0));
  assert.ok(Math.abs(body.reduce((sum, row) => sum + (row.volumePercentage ?? 0), 0) - 100) < 0.0001);
  assert.equal(total.volumePercentage, 100);
});

test("tablas ABP reutilizan solo córner y banda cercana", () => {
  const records = buildDashboardFixture();
  const rows = buildDashboardSetPieceDataRows(records, records.map((record) => [record]), "FOR");
  const all = rows.find((row) => row.key === "ALL")!;
  const corner = rows.find((row) => row.key === "CORNER")!;
  const kickIn = rows.find((row) => row.key === "KICK_IN")!;
  assert.equal(all.current.opportunities, corner.current.opportunities + kickIn.current.opportunities);
  assert.equal(rows.some((row) => String(row.key).includes("FREE")), false);
});

test("DATA mantiene TOTAL, por partido y por 40 sobre la misma cantidad", () => {
  const records = buildDashboardFixture();
  const analysis = buildDashboardV2(records, fixtureScope());
  const refs = records.map((record) => [record]);
  const total = buildDashboardPhaseDataRows(records, refs, "FOR", "TOTALS", analysis.rates.observedMinutes).find((row) => row.key === "TOTAL")!;
  const perMatch = buildDashboardPhaseDataRows(records, refs, "FOR", "PER_MATCH", analysis.rates.observedMinutes).find((row) => row.key === "TOTAL")!;
  const per40 = buildDashboardPhaseDataRows(records, refs, "FOR", "PER_40", analysis.rates.observedMinutes).find((row) => row.key === "TOTAL")!;
  assert.equal(perMatch.count, total.rawCount / records.length);
  assert.equal(per40.count, analysis.rates.observedMinutes > 0 ? total.rawCount * 40 / analysis.rates.observedMinutes : null);
});

test("partido concreto mantiene HAB contra el universo de referencia", () => {
  const records = buildDashboardFixture();
  const current = buildDashboardV2([records[0]], { ...fixtureScope(), matchIds: [records[0].catalog.matchId] });
  const rows = buildDashboardPhaseDataRows(current.records, records.map((record) => buildDashboardV2([record], { ...fixtureScope(), matchIds: [record.catalog.matchId] }).records), "AGAINST", "TOTALS", current.rates.observedMinutes);
  const positional = rows.find((row) => row.key === "POSITIONAL")!;
  assert.equal(positional.countHabitual.stats.n, records.length);
  assert.ok(positional.countHabitual.stats.n > current.samples);
});

test("tabla de porteros invierte ascendente y descendente", () => {
  const analysis = buildDashboardV2(buildDashboardFixture(), fixtureScope());
  const base = analysis.goalkeepers[0];
  assert.ok(base);
  const rows = [{ keeper: { ...base, playerId: "a", minutes: 10 }, matches: 1 }, { keeper: { ...base, playerId: "b", minutes: 30 }, matches: 2 }];
  assert.deepEqual(sortGoalkeeperRows(rows, "minutes", "DESC").map((row) => row.keeper.playerId), ["b", "a"]);
  assert.deepEqual(sortGoalkeeperRows(rows, "minutes", "ASC").map((row) => row.keeper.playerId), ["a", "b"]);
});

test("comparar porteros conserva dos Targets y dos Orígenes independientes", () => {
  const analysis = buildDashboardV2(buildDashboardFixture(), fixtureScope());
  const base = analysis.goalkeepers[0];
  assert.ok(base);
  const targetA = [{ ...base.goalPoints[0], eventId: "target-a" }];
  const targetB = [{ ...base.goalPoints[0], eventId: "target-b" }];
  const originA = [{ ...base.originPoints[0], eventId: "origin-a" }];
  const originB = [{ ...base.originPoints[0], eventId: "origin-b" }];
  const panels = buildGoalkeeperComparisonPanels([{ ...base, playerId: "a", name: "A", goalPoints: targetA, originPoints: originA }, { ...base, playerId: "b", name: "B", goalPoints: targetB, originPoints: originB }], ["a", "b"]);
  assert.equal(panels.length, 2);
  assert.equal(panels[0].targetPoints[0].eventId, "target-a");
  assert.equal(panels[1].targetPoints[0].eventId, "target-b");
  assert.equal(panels[0].originPoints[0].eventId, "origin-a");
  assert.equal(panels[1].originPoints[0].eventId, "origin-b");
  assert.notEqual(panels[0].targetPoints, panels[1].targetPoints);
  assert.notEqual(panels[0].originPoints, panels[1].originPoints);
});

test("porcentajes habituales se calculan por partido antes de P25/P75", () => {
  const records = buildDashboardFixture();
  const distribution = dashboardMetricDistribution(records, fixtureScope(), "FOR.onTargetPct", "TOTALS");
  const expected = records.map((record) => teamThreatProfile(record.session.events, "FOR").onTargetPercentage);
  assert.deepEqual(distribution.observations.map((observation) => observation.value), expected);
  assert.deepEqual(distribution.stats, describeDistribution(expected));
});

test("barra CDA/Rival comparte una sola escala", () => {
  assert.equal(sharedMetricMaximum(15, 10, 12, 8), 15);
  assert.equal(sharedMetricMaximum(null, 0), 1);
});

test("contador sticky refleja filtros activos reales", () => {
  const empty = fixtureScope();
  assert.equal(dashboardActiveFilterCount(empty), 0);
  assert.equal(dashboardActiveFilterCount({ ...empty, period: 2, matchIds: ["m1", "m2"], keeperBodyParts: ["TORSO"], scoreState: "LEADING" }), 5);
});

test("GLOBAL de porteros agrega tres porteros sin asumir dos", () => {
  const analysis = buildDashboardV2(buildDashboardFixture(), fixtureScope());
  assert.ok(analysis.goalkeepers.length > 0);
  const base = analysis.goalkeepers[0];
  const keepers = [base, { ...base, playerId: "gk-2", name: "Dos" }, { ...base, playerId: "gk-3", name: "Tres" }];
  const global = aggregateGoalkeepers(keepers);
  assert.equal(global?.playerId, "GLOBAL");
  assert.equal(global?.minutes, base.minutes * 3);
  assert.equal(global?.threatsAgainst, base.threatsAgainst * 3);
  assert.equal(global?.saves, base.saves * 3);
  assert.equal(global?.goalPoints.length, base.goalPoints.length * 3);
});

test("traductor Dashboard a VIDEO conserva el scope canónico y abre una consulta reproducible", () => {
  const scope = { ...fixtureScope(), matchIds: ["m1", "m2"], period: 2 as const, phases: ["SET_PIECE" as const], threatSides: ["FOR" as const], playerIds: ["p1"] };
  const filters = dashboardScopeToVideoFilters(scope);
  assert.equal(filters.source, "EVENT");
  assert.equal(filters.side, "FOR");
  assert.deepEqual(filters.matchIds, ["m1", "m2"]);
  assert.deepEqual(filters.eventKinds, ["SET_PIECES"]);
  assert.deepEqual(filters.periods, [2]);
  const href = dashboardVideoHref(scope);
  const params = new URLSearchParams(href.split("?")[1]);
  assert.equal(params.get("from"), "dashboard");
  assert.equal(params.get("amatchIds"), "m1~m2");
  assert.deepEqual(params.getAll("vMatches"), ["m1", "m2"]);
  assert.equal(params.get("vSide"), "FOR");
});

test("enlace contextual puede acotar fase y lado sin mutar el scope del Dashboard", () => {
  const scope = fixtureScope();
  const filters = dashboardScopeToVideoFilters(scope, { side: "AGAINST", phases: ["TRANSITION"] });
  assert.equal(filters.side, "AGAINST");
  assert.deepEqual(filters.phases, ["TRANSITION"]);
  assert.deepEqual(scope.phases, []);
});

test("nombre sugerido de colección incluye contexto legible y fecha", () => {
  const filters = dashboardScopeToVideoFilters({ ...fixtureScope(), matchIds: ["m1"] });
  assert.equal(suggestedDashboardCollectionName(filters, {}, new Date("2026-10-12T12:00:00Z")), "Partido · 12-10-2026");
});

test("nombre sugerido prioriza portero, lado, fase y destino con etiquetas humanas", () => {
  const filters = dashboardScopeToVideoFilters(fixtureScope(), { goalkeeperIds: ["g1"], side: "AGAINST", phases: ["TRANSITION"], outcomes: ["PARADA"], targetZones: ["RIGHT_HIGH"] });
  assert.equal(suggestedDashboardCollectionName(filters, { goalkeepers: [{ id: "g1", name: "Pablo" }] }, new Date("2026-10-12T12:00:00Z")), "Portero Pablo · Rival · Transición · Paradas · Escuadra der. · 12-10-2026");
});

test("impacto de fase es goles menos volumen y permite ordenar por ambas lecturas", () => {
  const rows = [
    { id: "mucho", values: [{ volumePercentage: 60, goalPercentage: 50 }] },
    { id: "impacto", values: [{ volumePercentage: 20, goalPercentage: 55 }] },
  ];
  assert.equal(phaseImpactDelta(20, 55), 35);
  assert.equal(phaseImpactDelta(null, 55), null);
  assert.equal(orderPhaseRows(rows, "VOLUME", (row) => row.values)[0].id, "mucho");
  assert.equal(orderPhaseRows(rows, "IMPACT", (row) => row.values)[0].id, "impacto");
});
