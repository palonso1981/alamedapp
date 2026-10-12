import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardFixture, DASHBOARD_FIXTURE_CLUB_ID, DASHBOARD_FIXTURE_SEASON_ID, DASHBOARD_FIXTURE_TEAM_ID } from "./dashboardFixture";
import { dashboardMetricDistribution } from "./dashboardDistribution";
import { describeDistribution, habitualPosition, MIN_MATCHES_FOR_HABITUAL_RANGE } from "./distributionStatistics";
import { buildDashboardV2, dashboardActiveFilterCount, DASHBOARD_AREAS, emptyDashboardScope, normalizeDashboardArea, phaseImpactShare, scopeFromSearchParams, scopeToSearchParams, teamThreatProfile } from "./dashboardV2";
import { aggregateGoalkeepers } from "./dashboardAnalysis";
import { sharedMetricMaximum } from "./distributionStatistics";

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
