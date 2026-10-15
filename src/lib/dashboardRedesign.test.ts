import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDashboardFixture, DASHBOARD_FIXTURE_CLUB_ID, DASHBOARD_FIXTURE_SEASON_ID, DASHBOARD_FIXTURE_TEAM_ID } from "./dashboardFixture";
import { dashboardMetricDistribution } from "./dashboardDistribution";
import { describeDistribution, habitualPosition, MIN_MATCHES_FOR_HABITUAL_RANGE } from "./distributionStatistics";
import { buildDashboardV2, dashboardActiveFilterCount, DASHBOARD_AREAS, emptyDashboardScope, normalizeDashboardArea, phaseImpactShare, scopeFromSearchParams, scopeToSearchParams, teamThreatProfile } from "./dashboardV2";
import { aggregateGoalkeepers } from "./dashboardAnalysis";
import { sharedMetricMaximum } from "./distributionStatistics";
import { dashboardScopeToVideoFilters, dashboardVideoHref, suggestedDashboardCollectionName } from "./dashboardVideoContext";
import { orderPhaseRows, phaseImpactDelta } from "./dashboardPhaseImpact";
import { buildDashboardPhaseDataRows, buildDashboardSetPieceDataRows, normalizeDashboardReferenceQuantity, sortDashboardSetPieceRows, sortDashboardSituationRows } from "./dashboardDataTables";
import { buildGoalkeeperComparisonPanels, goalkeeperSaveOutcomePercentage, GOALKEEPER_SAVE_OUTCOMES, sortGoalkeeperRows } from "./dashboardGoalkeeperView";
import { dashboardTimePercentage, evaluateDashboardDeviation, formatDashboardDuration, summaryMetricFavorableWhenHigher } from "./dashboardSemantics";

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

test("ABP mantiene TODAS fija y ordena los subtipos en ambas direcciones", () => {
  const records = buildDashboardFixture();
  const rows = buildDashboardSetPieceDataRows(records, records.map((record) => [record]), "FOR");
  const descending = sortDashboardSetPieceRows(rows, "opportunities", "DESC");
  const ascending = sortDashboardSetPieceRows(rows, "opportunities", "ASC");
  const habitual = sortDashboardSetPieceRows(rows, "shotHabitual", "DESC");
  assert.equal(descending[0].key, "ALL");
  assert.equal(ascending[0].key, "ALL");
  assert.equal(habitual[0].key, "ALL");
  assert.ok(descending[1].current.opportunities >= descending[2].current.opportunities);
  assert.ok(ascending[1].current.opportunities <= ascending[2].current.opportunities);
});

test("SITUACIONES ordena actual, por partido, habitual y partidos relevantes", () => {
  const stats = describeDistribution([1, 2, 3, 4]);
  const rows = [
    { key: "a", label: "A", current: 8, perMatch: 4, habitual: { stats, range: [1.75, 3.25] as [number, number] }, relevant: [{ id: 1 }, { id: 2 }] },
    { key: "b", label: "B", current: 2, perMatch: 1, habitual: { stats: describeDistribution([5, 6, 7, 8]), range: [5.75, 7.25] as [number, number] }, relevant: [{ id: 1 }] },
  ];
  assert.equal(sortDashboardSituationRows(rows, "current", "DESC")[0].key, "a");
  assert.equal(sortDashboardSituationRows(rows, "perMatch", "ASC")[0].key, "b");
  assert.equal(sortDashboardSituationRows(rows, "habitual", "DESC")[0].key, "b");
  assert.equal(sortDashboardSituationRows(rows, "matches", "ASC")[0].key, "b");
});

test("semántica favorable y desfavorable separa identidad CDA/Rival de valoración", () => {
  const matrix = [
    ["CDA", "VOLUME", true], ["CDA", "OUTSIDE", false], ["CDA", "ON_TARGET", true], ["CDA", "SAVES", false], ["CDA", "GOALS", true],
    ["RIVAL", "VOLUME", false], ["RIVAL", "OUTSIDE", true], ["RIVAL", "ON_TARGET", false], ["RIVAL", "SAVES", true], ["RIVAL", "GOALS", false],
  ] as const;
  matrix.forEach(([side, metric, favorableHigh]) => {
    assert.equal(summaryMetricFavorableWhenHigher(side, metric), favorableHigh);
    assert.equal(evaluateDashboardDeviation("above", favorableHigh), favorableHigh ? "FAVORABLE" : "UNFAVORABLE");
    assert.equal(evaluateDashboardDeviation("below", favorableHigh), favorableHigh ? "UNFAVORABLE" : "FAVORABLE");
  });
  assert.equal(evaluateDashboardDeviation("within", true), "NEUTRAL");
  assert.equal(evaluateDashboardDeviation("unavailable", true), "UNAVAILABLE");
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

test("ABP normaliza cantidades en TOTAL, PJ y x40 sin alterar ratios", () => {
  const records = buildDashboardFixture();
  const analysis = buildDashboardV2(records, fixtureScope());
  const references = records.map((record) => buildDashboardV2([record], { ...fixtureScope(), matchIds: [record.catalog.matchId] }));
  const referenceRecords = references.map((value) => value.records);
  const referenceMinutes = references.map((value) => value.rates.observedMinutes);
  const total = buildDashboardSetPieceDataRows(records, referenceRecords, "FOR", "TOTALS", analysis.rates.observedMinutes, referenceMinutes).find((row) => row.key === "ALL")!;
  const perMatch = buildDashboardSetPieceDataRows(records, referenceRecords, "FOR", "PER_MATCH", analysis.rates.observedMinutes, referenceMinutes).find((row) => row.key === "ALL")!;
  const per40 = buildDashboardSetPieceDataRows(records, referenceRecords, "FOR", "PER_40", analysis.rates.observedMinutes, referenceMinutes).find((row) => row.key === "ALL")!;
  assert.equal(perMatch.current.opportunities, total.current.opportunities / records.length);
  assert.equal(per40.current.opportunities, analysis.rates.observedMinutes > 0 ? total.current.opportunities * 40 / analysis.rates.observedMinutes : 0);
  assert.equal(perMatch.shotPct, total.shotPct);
  assert.equal(per40.goalPct, total.goalPct);
  assert.equal(normalizeDashboardReferenceQuantity(3, "TOTALS", 2, 40), 6);
  assert.equal(normalizeDashboardReferenceQuantity(3, "PER_MATCH", 2, 40), 3);
  assert.equal(normalizeDashboardReferenceQuantity(3, "PER_40", 2, 60), 2);
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

test("tipos de parada usan solo paradas clasificadas, protegen cero y se ordenan", () => {
  const analysis = buildDashboardV2(buildDashboardFixture(), fixtureScope());
  const base = analysis.goalkeepers[0];
  assert.ok(base);
  const a = { ...base, playerId: "a", saveOutcomes: { CATCH: 2, CLEARANCE: 1, REBOUND: 1 } };
  const b = { ...base, playerId: "b", saveOutcomes: { CATCH: 1, CLEARANCE: 3, REBOUND: 0 } };
  const none = { ...base, playerId: "none", saveOutcomes: { CATCH: 0, CLEARANCE: 0, REBOUND: 0 } };
  assert.equal(goalkeeperSaveOutcomePercentage(a, "CATCH"), 50);
  assert.equal(goalkeeperSaveOutcomePercentage(a, "CLEARANCE"), 25);
  assert.equal(goalkeeperSaveOutcomePercentage(a, "REBOUND"), 25);
  assert.equal(goalkeeperSaveOutcomePercentage(none, "CATCH"), null);
  const rows = [{ keeper: a, matches: 1 }, { keeper: b, matches: 1 }, { keeper: none, matches: 1 }];
  assert.deepEqual(sortGoalkeeperRows(rows, "catchPercentage", "DESC").map((row) => row.keeper.playerId), ["a", "b", "none"]);
  assert.deepEqual(sortGoalkeeperRows(rows, "catchPercentage", "ASC").map((row) => row.keeper.playerId), ["b", "a", "none"]);
  assert.deepEqual(sortGoalkeeperRows(rows, "clearancePercentage", "DESC").map((row) => row.keeper.playerId), ["b", "a", "none"]);
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

test("Situaciones formatea duración y porcentaje sobre el scope temporal sin falsos ceros", () => {
  assert.equal(formatDashboardDuration(12.5), "12:30");
  assert.equal(dashboardTimePercentage(12.5, 40), 31.25);
  assert.equal(dashboardTimePercentage(0, 40), 0);
  assert.equal(dashboardTimePercentage(5, 0), null);
});

test("los filtros de evento no alteran el denominador temporal de Clave y Oro", () => {
  const records = buildDashboardFixture();
  const base = buildDashboardV2(records, fixtureScope());
  const eventFiltered = buildDashboardV2(records, { ...fixtureScope(), phases: ["TRANSITION"], outcomes: ["GOL"], threatSides: ["FOR"] });
  assert.equal(eventFiltered.rates.observedMinutes, base.rates.observedMinutes);
  assert.equal(dashboardTimePercentage(eventFiltered.teamKeyMinutes, eventFiltered.rates.observedMinutes), dashboardTimePercentage(eventFiltered.teamKeyMinutes, base.rates.observedMinutes));
  assert.equal(dashboardTimePercentage(eventFiltered.teamGoldMinutes, eventFiltered.rates.observedMinutes), dashboardTimePercentage(eventFiltered.teamGoldMinutes, base.rates.observedMinutes));
});

test("Porteros expone BLOQ DESP RECH y mantiene cero clasificado como dato ausente", () => {
  assert.deepEqual(GOALKEEPER_SAVE_OUTCOMES.map((item) => item.shortLabel), ["BLOQ", "DESP", "RECH"]);
  const analysis = buildDashboardV2(buildDashboardFixture(), fixtureScope());
  const empty = { ...analysis.goalkeepers[0], saveOutcomes: { CATCH: 0, CLEARANCE: 0, REBOUND: 0 } };
  assert.equal(goalkeeperSaveOutcomePercentage(empty, "CATCH"), null);
});

test("FASES mantiene orden fijo, dos tracks, filtro canónico y detalle estadístico", () => {
  const source = readFileSync("src/components/dashboard/DashboardV2Page.tsx", "utf8");
  const labels = ["POSICIONAL", "TRANSICIÓN", "ABP", "CÓRNER", "BANDA CERCANA", "PORTERO-JUGADOR", "DOBLE PENALTI", "PENALTI"];
  labels.reduce((position, label) => { const next = source.indexOf(`label: \"${label}\"`, position + 1); assert.ok(next > position, `${label} respeta el orden`); return next; }, -1);
  for (const token of ["onScope({ ...scope, phases:", "media", "mediana", "min/max", "N=", 'data-phase-track={kind}', 'renderTrack("actions")', 'renderTrack("goals")', "Volumen:", "Impacto:"]) assert.ok(source.includes(token));
  assert.ok(!source.includes("PhaseSignal"));
});

test("FASES comparte escala entre fases, separa acciones y goles y compacta vídeos", () => {
  const source = readFileSync("src/components/dashboard/DashboardV2Page.tsx", "utf8");
  const phaseSource = source.slice(source.indexOf("function PhaseImpact"), source.indexOf("function GoalkeeperTable"));
  assert.ok(source.includes("const actionMaximum = sharedMetricMaximum(...rows.flatMap"));
  assert.ok(source.includes("const goalMaximum = sharedMetricMaximum(...rows.flatMap"));
  assert.ok(source.includes("data-action-scale={actionMaximum}"));
  assert.ok(source.includes("data-goal-scale={goalMaximum}"));
  assert.ok(source.includes('label="CDA" compact'));
  assert.ok(source.includes('label="RIV" compact'));
  assert.ok(!phaseSource.includes("Dif."));
});

test("RESUMEN escala las cantidades visibles y conserva porcentajes como microdato", () => {
  const source = readFileSync("src/components/dashboard/DashboardV2Page.tsx", "utf8");
  assert.ok(source.includes("sharedMetricMaximum(own, rival, ownReference, rivalReference"));
  assert.ok(source.includes("<MetricScale value={own}"));
  assert.ok(source.includes('ownMetric="FOR.outside"'));
  assert.ok(source.includes('ownMetric="FOR.onTarget"'));
});

test("RESUMEN y ABP usan etiquetas textuales sin iconos deportivos", () => {
  const summary = readFileSync("src/components/dashboard/DashboardV2Page.tsx", "utf8");
  const abp = readFileSync("src/components/dashboard/SetPieceFunnel.tsx", "utf8");
  for (const token of ["REM · AME", "FUERA", "A PUERTA", "PARADAS", "GOLES"]) assert.ok(summary.includes(token));
  assert.ok(!summary.includes("DashboardActionIcon"));
  assert.ok(!abp.includes("DashboardActionIcon"));
});

test("SITUACIONES excluye ceros y solo analiza con filtros canónicos", () => {
  const summary = readFileSync("src/components/dashboard/DashboardV2Page.tsx", "utf8");
  const data = readFileSync("src/components/dashboard/DashboardDataTables.tsx", "utf8");
  assert.ok(summary.includes('row.losses > 0 : row.minutes > 0'));
  assert.ok(summary.includes('competitiveContext: goldContext ? "GOLD" : "KEY"'));
  assert.ok(summary.includes('playingState: "PJ_CDA"'));
  assert.ok(data.includes('filter((item) => item.value > 0)'));
  assert.ok(data.includes('situation.key !== "losses"'));
});

test("DATOS no dibuja marcador neutral y conserva semántica favorable", () => {
  const source = readFileSync("src/components/dashboard/DashboardDataTables.tsx", "utf8");
  assert.ok(source.includes('data-deviation-position={position}'));
  assert.ok(source.includes('data-deviation-evaluation={evaluation}'));
  assert.ok(!source.includes('position === "within" ? "· "'));
});

test("DATOS normaliza SITUACIONES, destaca porcentaje de gol y cambia pestaña sin perder scope", () => {
  const data = readFileSync("src/components/dashboard/DashboardDataTables.tsx", "utf8");
  const page = readFileSync("src/components/dashboard/DashboardV2Page.tsx", "utf8");
  assert.ok(data.includes("normalizeDashboardCount(rawCurrent, mode"));
  assert.ok(data.includes('data-dashboard-value-mode={mode}'));
  assert.ok(data.includes("border-l border-slate-700/60 bg-amber-950/10 font-black text-amber-100"));
  assert.ok(page.includes("if (nextArea === area) return"));
  assert.ok(page.includes('scrollIntoView({ block: "start", behavior: "auto" })'));
  assert.ok(page.includes("onArea={changeArea}"));
});

test("tabla principal de porteros cabe sin scroll y conserva cabeceras esenciales", () => {
  const source = readFileSync("src/components/dashboard/DashboardV2Page.tsx", "utf8");
  const view = readFileSync("src/lib/dashboardGoalkeeperView.ts", "utf8");
  for (const label of ["PORTERO", "MIN", "PJ", "AME", "PAR", "%PAR"]) assert.ok(source.includes(`label: \"${label}\"`));
  for (const label of ["BLOQ", "DESP", "RECH"]) assert.ok(view.includes(`shortLabel: \"${label}\"`));
  assert.ok(source.includes('className="w-full table-fixed'));
  assert.ok(source.includes('<col style={{ width: "24%" }}/>'));
  assert.ok(source.includes('style={{ width: "9.5%" }}'));
  assert.ok(!source.includes('min-w-[1240px]'));
});

test("GLOBAL de porteros usa cabecera, KPI y tipos de parada compactos", () => {
  const source = readFileSync("src/components/dashboard/GoalkeeperAnalysisColumn.tsx", "utf8");
  assert.ok(source.includes("data-goalkeeper-global={global || undefined}"));
  assert.ok(source.includes("TODOS LOS PORTEROS"));
  assert.ok(source.includes("compact={global}"));
  assert.ok(!source.includes("🥅"));
});

test("iconos del Dashboard son SVG accesibles y el tooltip responde a tap exterior y Escape", () => {
  const source = readFileSync("src/components/dashboard/DashboardActionIcon.tsx", "utf8");
  for (const token of ["<svg", "aria-label", "aria-expanded", "pointerdown", 'event.key === "Escape"']) assert.ok(source.includes(token));
  assert.ok(!source.includes("👟"));
  assert.ok(!source.includes("🥅"));
});
