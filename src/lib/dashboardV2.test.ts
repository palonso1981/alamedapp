import assert from "node:assert/strict";
import test from "node:test";

import { MatchEvent } from "../types";
import { DashboardMatchRecord } from "./dashboardAnalytics";
import { PitchOriginZone } from "./dashboardAnalysis";
import { competitiveEventIds, deriveCompetitiveMinutes, deriveCompetitiveProjection, derivePlayingStateIntervals, deriveScoreStateIntervals, isCompetitiveMoment } from "./dashboardCompetitiveContext";
import { buildDashboardFixture, DASHBOARD_FIXTURE_CLUB_ID, DASHBOARD_FIXTURE_SEASON_ID, DASHBOARD_FIXTURE_TEAM_ID } from "./dashboardFixture";
import { compareMetricValues, METRIC_DEFINITIONS } from "./dashboardMetricDefinitions";
import { dashboardMapPointTitle, resolveDashboardMapPoint } from "./dashboardTrace";
import { revisionEventHref, safeDashboardReturnTo } from "./dashboardNavigation";
import { adaptiveChartLayout, filterSearchableMatches, matchSelectionLabel, searchableMatchLabel, toggleMatchSelection } from "./dashboardSelectors";
import { withCurrentPlayerIdentity } from "./dashboardIdentity";
import { COMPARISON_BAR_MAX_PERCENT, comparisonBarPercentage, comparisonBarValueStyle } from "./dashboardBarLayout";
import { createMasterPlayer } from "./rosterDomain";

test("returnTo acepta solo rutas Dashboard internas y conserva la identidad del evento", () => {
  const returnTo = "/dashboard/jugador/p1?aCompetition=LEAGUE&shot=GOL#shot-map";
  assert.equal(safeDashboardReturnTo(returnTo), returnTo);
  assert.equal(safeDashboardReturnTo("https://evil.example/dashboard"), null);
  assert.equal(safeDashboardReturnTo("//evil.example/dashboard"), null);
  assert.equal(safeDashboardReturnTo("/partido/x/directo"), null);
  const href = revisionEventHref("m1", "e1", returnTo, true);
  const url = new URL(href, "https://alamedapp.local");
  assert.equal(url.searchParams.get("eventId"), "e1");
  assert.equal(url.searchParams.get("returnTo"), returnTo);
  assert.equal(url.searchParams.get("fixture"), "1");
});

test("Dashboard resuelve el nombre maestro actual por playerId sin cambiar dorsal ni estadísticas históricas", () => {
  const source = buildDashboardFixture()[0];
  const historical = source.session.players.find((player) => player.id === "fx-p-4")!;
  const master = createMasterPlayer([], {
    fullName: "Ángel Díaz",
    displayName: "Ángel",
    number: 99,
    role: "FIELD",
  }, { id: historical.id, now: 100 });
  const resolved = withCurrentPlayerIdentity([source], [master]);
  const before = buildDashboardV2([source], baseScope()).players.find((player) => player.playerId === historical.id)!;
  const after = buildDashboardV2(resolved, baseScope()).players.find((player) => player.playerId === historical.id)!;

  assert.equal(resolved[0].session.players.find((player) => player.id === historical.id)?.name, "Ángel");
  assert.equal(resolved[0].session.players.find((player) => player.id === historical.id)?.number, historical.number);
  assert.equal(after.name, "Ángel");
  assert.equal(after.number, historical.number);
  assert.deepEqual(
    { goals: after.goals, assists: after.assists, minutes: after.minutes, threats: after.ownThreats },
    { goals: before.goals, assists: before.assists, minutes: before.minutes, threats: before.ownThreats },
  );
  assert.equal(buildDashboardV2(resolved, baseScope()).players.filter((player) => player.playerId === historical.id).length, 1);
});
import { formatFutsalPosition } from "./positionFormat";
import { createGameStateEvent, createLineupInitializedEvent, createLiveThreatEvent, createPossessionLostEvent, createSubstitutionEvent, editEvent, replayMatch } from "./matchEngine";
import {
  buildDashboardV2,
  buildPlayerScores,
  chronologicalParticipationPercentage,
  comparisonEnabledFromSearchParams,
  defaultDashboardCompetition,
  derivedThreatSummary,
  emptyDashboardScope,
  filterDashboardDataset,
  homogeneousComparisonMode,
  mergeDashboardSearchParams,
  hasDashboardScopeSearchParams,
  outcomeDistribution,
  playerMetricValue,
  referenceScopeForPreset,
  scopeFromSearchParams,
  squadAverage,
  stableSortByMetric,
  teamMetricValue,
  teamPairedMetricValue,
  teamPlayerTableMetricValue,
} from "./dashboardV2";

test("% Clave/Oro usa minutos cronológicos del equipo y N/D sin denominador", () => {
  assert.equal(chronologicalParticipationPercentage(30, 35), 30 / 35 * 100);
  assert.equal(chronologicalParticipationPercentage(4, 10), 40);
  assert.equal(chronologicalParticipationPercentage(0, 0), null);
});

test("competición TODAS sobrevive explícitamente en la URL", () => {
  const scope = { ...baseScope(), competition: "ALL" as const };
  const query = mergeDashboardSearchParams({ analysis: scope, reference: scope, referencePreset: "SEASON", mode: "TOTALS", area: "SUMMARY" });
  assert.equal(new URLSearchParams(query).get("aCompetition"), "ALL");
  assert.equal(scopeFromSearchParams(new URLSearchParams(query), "a", { ...scope, competition: "LEAGUE" }).competition, "ALL");
});

test("competición es scope principal, legacy no se convierte en Liga y la referencia la hereda", () => {
  const records = buildDashboardFixture();
  assert.equal(records.length, 30);
  assert.equal(records.filter((record) => record.session.preparation?.competitionType === "LEAGUE").length, 21);
  assert.equal(records.filter((record) => record.session.preparation?.competitionType === "FRIENDLY").length, 3);
  assert.equal(records.filter((record) => record.session.preparation?.competitionType === "CUP").length, 3);
  assert.equal(records.filter((record) => !record.session.preparation?.competitionType).length, 3);
  assert.equal(defaultDashboardCompetition(records, baseScope()), "LEAGUE");
  const league = { ...baseScope(), competition: "LEAGUE" as const, rivals: ["Racing Norte"] };
  assert.equal(buildDashboardV2(records, league).records.every((record) => record.session.preparation?.competitionType === "LEAGUE"), true);
  assert.equal(referenceScopeForPreset(league, "SEASON").competition, "LEAGUE");
  assert.ok(buildDashboardV2(records, { ...baseScope(), competition: "UNSPECIFIED" }).records.every((record) => !record.session.preparation?.competitionType));
});

test("corregir competición conserva identidades y mueve el partido al scope nuevo", () => {
  const record = buildDashboardFixture()[0];
  const eventIds = record.session.events.map((event) => event.id);
  const edited: DashboardMatchRecord = {
    catalog: { ...record.catalog },
    session: {
      ...record.session,
      preparation: {
        ...record.session.preparation!,
        competitionType: "CUP",
        matchday: 6,
        opponent: "Rival corregido",
      },
    },
  };
  assert.equal(filterDashboardDataset([edited], { ...baseScope(), matchIds: [], competition: "LEAGUE" }).length, 0);
  assert.equal(filterDashboardDataset([edited], { ...baseScope(), matchIds: [], competition: "CUP" }).length, 1);
  assert.equal(edited.catalog.matchId, record.catalog.matchId);
  assert.deepEqual(edited.session.events.map((event) => event.id), eventIds);
});

test("balances pareados mantienen tanteo y diferencia en todos los modos", () => {
  const analysis = buildDashboardV2(buildDashboardFixture(), { ...baseScope(), competition: "LEAGUE" });
  for (const id of ["GOALS", "THREATS", "ON_TARGET", "NEAR"] as const) {
    for (const mode of ["TOTALS", "PER_MATCH", "PER_40"] as const) {
      const pair = teamPairedMetricValue(analysis, id, mode);
      assert.equal(pair.difference, pair.left === null || pair.right === null ? null : pair.left - pair.right);
    }
  }
});

test("filtro global de portero conserva toda la actividad del equipo durante sus intervalos y excluye P-J", () => {
  const record = buildDashboardFixture()[17];
  const filtered = filterDashboardDataset([record], { ...baseScope(), competition: "FRIENDLY", goalkeeperIds: ["fx-gk-2"] });
  const threats = filtered.flatMap((item) => item.session.events).filter((event) => event.type === "threat_recorded");
  assert.ok(threats.some((event) => event.side === "FOR"));
  assert.ok(threats.some((event) => event.side === "AGAINST"));
  assert.equal(threats.some((event) => event.id.includes("pj-threat")), false);
});

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
  const analysis = { ...baseScope(), rivals: ["Racing Norte", "Sala Centro"], originZones: ["Z2" as const], period: 2 as const, outcomeGroup: "ON_TARGET" as const, originDistance: "NEAR" as const, competitiveContext: "GOLD" as const, playingState: "PJ_CDA" as const, scoreState: "TRAILING" as const };
  const reference = { ...baseScope(), venues: ["AWAY" as const], period: 2 as const, playingState: "PJ_RIVAL" as const, scoreState: "LEADING" as const };
  const query = mergeDashboardSearchParams({ analysis, reference, referencePreset: "AWAY", mode: "PER_40", area: "PLAYERS" });
  const params = new URLSearchParams(query);
  assert.deepEqual(scopeFromSearchParams(params, "a", baseScope()), analysis);
  assert.deepEqual(scopeFromSearchParams(params, "r", baseScope()), reference);
  assert.equal(params.get("mode"), "PER_40");
  assert.equal(params.get("area"), "PLAYERS");
});

test("multiselección conserva uno o varios partidos en DashboardScopeV2 y en URL", () => {
  const records = buildDashboardFixture();
  const selected = [records[0].catalog.matchId, records[17].catalog.matchId];
  const scope = { ...baseScope(), competition: "ALL" as const, matchIds: selected };
  const filtered = filterDashboardDataset(records, scope);
  assert.deepEqual(filtered.map((record) => record.catalog.matchId).sort(), [...selected].sort());
  const query = mergeDashboardSearchParams({ analysis: scope, reference: scope, referencePreset: "SEASON", mode: "TOTALS", area: "SUMMARY", comparisonEnabled: false });
  const params = new URLSearchParams(query);
  assert.deepEqual(scopeFromSearchParams(params, "a", baseScope()).matchIds, selected);
  assert.equal(comparisonEnabledFromSearchParams(params), false);
  assert.equal(comparisonEnabledFromSearchParams(new URLSearchParams()), true);
});

test("selector múltiple marca, desmarca, limpia y resume la selección", () => {
  const records = buildDashboardFixture().slice(0, 2);
  const matches = records.map((record) => ({ ...record.catalog }));
  const first = records[0].catalog.matchId;
  const second = records[1].catalog.matchId;
  assert.deepEqual(toggleMatchSelection([], first), [first]);
  assert.deepEqual(toggleMatchSelection([first], second), [first, second]);
  assert.deepEqual(toggleMatchSelection([first, second], first), [second]);
  assert.equal(matchSelectionLabel(matches, [], "Todos"), "Todos");
  assert.match(matchSelectionLabel(matches, [first]), new RegExp(records[0].catalog.opponent));
  assert.equal(matchSelectionLabel(matches, [first, second]), "2 partidos seleccionados");
});

test("multiselección combina libremente competición, sede, periodo y estado del marcador", () => {
  const records = buildDashboardFixture();
  const home = records.find((record) => record.catalog.venue === "HOME" && record.session.preparation?.competitionType === "LEAGUE")!;
  const away = records.find((record) => record.catalog.venue === "AWAY" && record.session.preparation?.competitionType === "FRIENDLY")!;
  const selected = [home.catalog.matchId, away.catalog.matchId];
  const mixed = buildDashboardV2(records, { ...baseScope(), competition: "ALL", matchIds: selected });
  assert.equal(mixed.samples, 2);
  assert.equal(teamPlayerTableMetricValue(mixed, "matches", "TOTALS"), 2);
  assert.equal(teamPlayerTableMetricValue(mixed, "goals", "PER_MATCH"), mixed.analytics.goalsFor / 2);
  assert.equal(teamPlayerTableMetricValue(mixed, "goals", "PER_40"), mixed.rates.goalsFor40);
  const awayP2 = filterDashboardDataset(records, { ...baseScope(), competition: "ALL", matchIds: selected, venues: ["AWAY"], period: 2, scoreState: "DRAWING" });
  assert.ok(awayP2.every((record) => record.catalog.matchId === away.catalog.matchId));
  assert.ok(awayP2.flatMap((record) => record.session.events).every((event) => event.period === 2));
});

test("una URL legacy de partido único sigue hidratando matchIds", () => {
  assert.deepEqual(scopeFromSearchParams(new URLSearchParams("aMatch=legacy-one"), "a", baseScope()).matchIds, ["legacy-one"]);
  assert.deepEqual(scopeFromSearchParams(new URLSearchParams("aMatchId=legacy-two"), "a", baseScope()).matchIds, ["legacy-two"]);
});

test("una URL parcial de referencia se reconoce sin exigir rClub", () => {
  const params = new URLSearchParams("fixture=1&reference=CUSTOM&aScoreState=LEADING&rScoreState=TRAILING");
  assert.equal(hasDashboardScopeSearchParams(params, "r"), true);
  assert.equal(scopeFromSearchParams(params, "r", baseScope()).scoreState, "TRAILING");
  assert.equal(hasDashboardScopeSearchParams(new URLSearchParams("reference=CUSTOM"), "r"), false);
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

test("EQUIPO agrega partidos, goles y balance sin promediar jugadores", () => {
  const records = [pointsRecord("team-a", 1, 0), pointsRecord("team-b", 0, 1)];
  const analysis = buildDashboardV2(records, { ...baseScope(), matchIds: records.map((record) => record.catalog.matchId) });
  assert.equal(teamPlayerTableMetricValue(analysis, "matches", "TOTALS"), 2);
  assert.equal(teamPlayerTableMetricValue(analysis, "goals", "TOTALS"), 1);
  assert.equal(teamPlayerTableMetricValue(analysis, "goalsFor", "TOTALS"), 1);
  assert.equal(teamPlayerTableMetricValue(analysis, "goalsAgainst", "TOTALS"), 1);
  assert.equal(teamPlayerTableMetricValue(analysis, "plusMinus", "TOTALS"), 0);
  assert.equal(teamPlayerTableMetricValue(analysis, "goals", "PER_MATCH"), .5);
  assert.equal(teamPlayerTableMetricValue(analysis, "goals", "PER_40"), analysis.rates.goalsFor40);
  assert.equal(teamPlayerTableMetricValue(analysis, "yellowCards", "TOTALS"), analysis.analytics.discipline.for.yellowCards);
  assert.equal(teamPlayerTableMetricValue(analysis, "redCards", "TOTALS"), analysis.analytics.discipline.for.redCards);
  assert.notEqual(teamPlayerTableMetricValue(analysis, "goals", "TOTALS"), squadAverage(analysis.players, (player) => player.goals).value);
});

test("EQUIPO usa un único reloj cronológico pese a sustituciones y reparto de porteros", () => {
  const record = buildDashboardFixture()[17];
  const analysis = buildDashboardV2([record], { ...baseScope(), matchIds: [record.catalog.matchId] });
  const playerMinutes = analysis.players.reduce((sum, player) => sum + player.minutes, 0);
  const goalkeeperMinutes = analysis.goalkeepers.reduce((sum, goalkeeper) => sum + goalkeeper.minutes, 0);
  assert.equal(teamPlayerTableMetricValue(analysis, "minutes", "TOTALS"), analysis.rates.observedMinutes);
  assert.ok(playerMinutes > analysis.rates.observedMinutes);
  assert.ok(goalkeeperMinutes >= analysis.rates.observedMinutes);
  assert.equal(teamPlayerTableMetricValue(analysis, "minutes", "PER_MATCH"), analysis.rates.observedMinutes / analysis.samples);
  assert.equal(teamPlayerTableMetricValue(analysis, "minutes", "PER_40"), 40);
});

test("EQUIPO calcula minutos ganando, empatando y perdiendo desde intervalos del scope", () => {
  const record = competitiveFortyMinuteRecord();
  for (const scoreState of ["LEADING", "DRAWING", "TRAILING"] as const) {
    const analysis = buildDashboardV2([record], { ...baseScope(), matchIds: [record.catalog.matchId], scoreState });
    const expected = deriveCompetitiveMinutes(record.session, "ALL", "ALL", [], "ALL", scoreState).observed;
    assert.equal(teamPlayerTableMetricValue(analysis, "minutes", "TOTALS"), expected);
    assert.ok(analysis.players.reduce((sum, player) => sum + player.minutes, 0) >= expected);
  }
});

test("EQUIPO conserva filtros combinados y deriva ratios desde numerador y denominador agregados", () => {
  const scope = { ...baseScope(), period: 2 as const, venues: ["AWAY" as const], phases: ["SET_PIECE_CORNER" as const], outcomeGroup: "ON_TARGET" as const };
  const analysis = buildDashboardV2(buildDashboardFixture(), scope);
  assert.equal(teamPlayerTableMetricValue(analysis, "threats", "TOTALS"), analysis.analytics.threats.FOR.total);
  assert.equal(teamPlayerTableMetricValue(analysis, "keyPercentage", "TOTALS"), analysis.rates.observedMinutes > 0 ? analysis.teamKeyMinutes / analysis.rates.observedMinutes * 100 : null);
  assert.equal(teamPlayerTableMetricValue(analysis, "goldPercentage", "PER_40"), analysis.rates.observedMinutes > 0 ? analysis.teamGoldMinutes / analysis.rates.observedMinutes * 100 : null);
  assert.equal(teamPlayerTableMetricValue(analysis, "onTargetBalance", "TOTALS"), teamPairedMetricValue(analysis, "ON_TARGET", "TOTALS").difference);
});

test("valores de barras quedan fuera junto al extremo con escalado seguro para barras cortas y largas", () => {
  const short = comparisonBarPercentage(1, 100);
  const long = comparisonBarPercentage(100, 100);
  assert.ok(short > 0 && short < long);
  assert.equal(long, COMPARISON_BAR_MAX_PERCENT);
  assert.deepEqual(comparisonBarValueStyle("left", short), { right: `calc(${short}% + 0.35rem)` });
  assert.deepEqual(comparisonBarValueStyle("right", long), { left: `calc(${long}% + 0.35rem)` });
  assert.equal(comparisonBarPercentage(null, 100), 0);
  assert.equal(comparisonBarPercentage(200, 100), COMPARISON_BAR_MAX_PERCENT);
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

test("MEDIA PLANTILLA promedia valores individuales válidos, excluye N/D y jugadores sin minutos", () => {
  const rows = [
    { minutes: 20, value: 2 },
    { minutes: 12, value: 4 },
    { minutes: 8, value: 9 },
    { minutes: 5, value: null },
    { minutes: 0, value: 100 },
  ];
  assert.deepEqual(squadAverage(rows, (row) => row.value), { value: 5, eligiblePlayers: 4, validValues: 3 });
  assert.deepEqual(squadAverage(rows, () => null), { value: null, eligiblePlayers: 4, validValues: 0 });
});

test("MEDIA PLANTILLA aplica primero TOTALES, POR PARTIDO y POR 40 de cada jugador", () => {
  const players = buildDashboardV2(buildDashboardFixture(), baseScope()).players;
  for (const mode of ["TOTALS", "PER_MATCH", "PER_40"] as const) {
    const values = players.filter((player) => player.minutes > 0).map((player) => playerMetricValue(player, "goals", mode)).filter((value): value is number => value !== null);
    const expected = values.reduce((sum, value) => sum + value, 0) / values.length;
    assert.equal(squadAverage(players, (player) => playerMetricValue(player, "goals", mode)).value, expected);
  }
});

test("fixture poblado cubre temporada, sedes, resultados, jugadores, porteros, fases y P-J sin persistir", () => {
  const records = buildDashboardFixture();
  const analysis = buildDashboardV2(records, baseScope());
  assert.equal(records.length, 30);
  assert.ok(records.some((record) => record.catalog.venue === "HOME"));
  assert.ok(records.some((record) => record.catalog.venue === "AWAY"));
  assert.ok(analysis.players.length >= 8);
  assert.ok(analysis.goalkeepers.length >= 2);
  assert.ok(analysis.players.some((player) => Boolean(player.photoUrl)));
  assert.ok(analysis.players.some((player) => !player.photoUrl));
  assert.ok(analysis.flyingGoalkeeper.for.minutes > 0);
  assert.ok(analysis.analytics.threats.FOR.total > 0 && analysis.analytics.threats.AGAINST.total > 0);
  assert.ok(Object.values(analysis.analytics.phases).filter((phase) => phase.FOR + phase.AGAINST > 0).length >= 6);
  const contextMatch = records.find((record) => record.catalog.matchId === "dashboard-fixture-8")!;
  const allContext = buildDashboardV2(records, { ...baseScope(), matchIds: [contextMatch.catalog.matchId] });
  const keyContext = buildDashboardV2(records, { ...baseScope(), matchIds: [contextMatch.catalog.matchId], competitiveContext: "KEY" });
  assert.equal(allContext.goalkeepers.find((keeper) => keeper.playerId === "fx-gk-1")?.minutes, 40);
  assert.equal(keyContext.goalkeepers.find((keeper) => keeper.playerId === "fx-gk-1")?.minutes, 40);
});

test("fixture contiene pérdidas multicontexto y secuencia completa 0-0→0-1→1-1→2-1→2-2→3-2", () => {
  const records = buildDashboardFixture();
  const losses = records.flatMap((record) => record.session.events).filter((event) => event.type === "possession_lost");
  assert.ok(losses.length >= records.length * 2);
  assert.ok(new Set(losses.map((event) => event.playerId)).size >= 4);
  assert.ok(losses.some((event) => event.period === 1) && losses.some((event) => event.period === 2));
  assert.ok(losses.some((event) => event.id.includes("pj-loss")));
  assert.ok(losses.some((event) => event.id.includes("pj-rival-loss")));
  const match = records.find((record) => record.catalog.matchId === "dashboard-fixture-8")!;
  let scoreFor = 0;
  let scoreAgainst = 0;
  const sequence = ["0-0"];
  for (const entry of replayMatch(match.session.players, match.session.events).timeline) {
    const event = entry.event;
    if (event.type !== "threat_recorded" || event.outcome !== "GOL") continue;
    if (event.side === "FOR") scoreFor += 1; else scoreAgainst += 1;
    sequence.push(`${scoreFor}-${scoreAgainst}`);
  }
  assert.deepEqual(sequence, ["0-0", "0-1", "1-1", "2-1", "2-2", "3-2"]);
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

test("posiciones actuales y legacy se presentan siempre en castellano", () => {
  assert.equal(formatFutsalPosition("GOALKEEPER"), "PORTERO");
  assert.equal(formatFutsalPosition("PORTERO"), "PORTERO");
  assert.equal(formatFutsalPosition("FIXO"), "CIERRE");
  assert.equal(formatFutsalPosition("CIERRE"), "CIERRE");
  assert.equal(formatFutsalPosition("WINGER"), "ALA");
  assert.equal(formatFutsalPosition("ALA"), "ALA");
  assert.equal(formatFutsalPosition("PIVOT"), "PÍVOT");
  assert.equal(formatFutsalPosition("PÍVOT"), "PÍVOT");
  assert.equal(formatFutsalPosition("UNIVERSAL"), "UNIVERSAL");
  assert.equal(formatFutsalPosition("OTRA"), "OTRA");
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

function playingStateRecord(): DashboardMatchRecord {
  const source = buildDashboardFixture()[0];
  const matchId = "pj-context-test";
  const squad = source.session.players.map((player) => player.id);
  const p1 = ["fx-gk-1", "fx-p-2", "fx-p-4", "fx-p-5", "fx-p-7"];
  const p2 = ["fx-gk-1", "fx-p-5", "fx-p-7", "fx-p-9", "fx-p-10"];
  const events: MatchEvent[] = [
    createLineupInitializedEvent({ id: "pj-p1", matchId, position: { period: 1, minute: 0, order: 1 }, squadPlayerIds: squad, onCourtPlayerIds: p1, goalkeeperPlayerId: "fx-gk-1", now: 1 }),
    createLiveThreatEvent({ id: "phase-only", matchId, position: { period: 1, minute: 5, order: 1 }, side: "FOR", playerId: "fx-p-4", origin: { x: .3, y: .5 }, outcome: "PARADA", phase: "FLYING_GOALKEEPER", now: 2 }),
    createGameStateEvent({ id: "pj-cda-p1-on", matchId, position: { period: 1, minute: 12, order: 1 }, state: "FLYING_GOALKEEPER", active: true, playerId: "fx-p-4", side: "FOR", now: 3 }),
    createLiveThreatEvent({ id: "pj-cda-a", matchId, position: { period: 1, minute: 13, order: 1 }, side: "FOR", playerId: "fx-p-4", origin: { x: .3, y: .5 }, outcome: "PARADA", phase: "POSITIONAL", now: 4 }),
    createGameStateEvent({ id: "pj-cda-p1-off", matchId, position: { period: 1, minute: 15, order: 1 }, state: "FLYING_GOALKEEPER", active: false, side: "FOR", now: 5 }),
    createLineupInitializedEvent({ id: "pj-p2", matchId, position: { period: 2, minute: 0, order: 1 }, squadPlayerIds: squad, onCourtPlayerIds: p2, goalkeeperPlayerId: "fx-gk-1", now: 6 }),
    createLiveThreatEvent({ id: "outside-pj", matchId, position: { period: 2, minute: 10, order: 1 }, side: "AGAINST", origin: { x: .4, y: .5 }, outcome: "FUERA", phase: "POSITIONAL", now: 7 }),
    createGameStateEvent({ id: "pj-rival-on", matchId, position: { period: 2, minute: 11, order: 1 }, state: "FLYING_GOALKEEPER", active: true, side: "AGAINST", now: 8 }),
    createLiveThreatEvent({ id: "pj-rival-a", matchId, position: { period: 2, minute: 12, order: 1 }, side: "AGAINST", origin: { x: .4, y: .5 }, outcome: "PARADA", phase: "POSITIONAL", defensive: { version: 2, goalTarget: { x: .5, y: .5, geometryVersion: 3 }, goalkeeper: { status: "PLAYER", playerId: "fx-gk-1" } }, now: 9 }),
    createGameStateEvent({ id: "pj-rival-off", matchId, position: { period: 2, minute: 14, order: 1 }, state: "FLYING_GOALKEEPER", active: false, side: "AGAINST", now: 10 }),
    createGameStateEvent({ id: "pj-cda-p2-on", matchId, position: { period: 2, minute: 15, order: 1 }, state: "FLYING_GOALKEEPER", active: true, playerId: "fx-p-10", side: "FOR", now: 11 }),
    createLiveThreatEvent({ id: "pj-cda-b", matchId, position: { period: 2, minute: 16, order: 1 }, side: "FOR", playerId: "fx-p-10", origin: { x: .3, y: .5 }, outcome: "GOL", phase: "TRANSITION", assist: { status: "NONE" }, now: 12 }),
    createLiveThreatEvent({ id: "pj-cda-c", matchId, position: { period: 2, minute: 18, order: 1 }, side: "AGAINST", origin: { x: .4, y: .5 }, outcome: "GOL", phase: "POSITIONAL", defensive: { version: 2, goalTarget: { x: .5, y: .5, geometryVersion: 3 }, goalkeeper: { status: "PLAYER", playerId: "fx-p-10" } }, now: 13 }),
    createGameStateEvent({ id: "pj-cda-p2-off", matchId, position: { period: 2, minute: 19, order: 1 }, state: "FLYING_GOALKEEPER", active: false, side: "FOR", now: 14 }),
  ];
  return {
    catalog: { ...source.catalog, matchId, opponent: "Alzira FS", date: "2026-10-05", status: "FINISHED" },
    session: { ...source.session, matchId, events, matchFinished: true, period: 2, minute: 20, closedPeriods: [1, 2] },
  };
}

test("intervalos P-J derivan ON/OFF por lado, varios periodos y no confunden la fase", () => {
  const session = playingStateRecord().session;
  const cda = derivePlayingStateIntervals(session, "ALL", "PJ_CDA");
  const rival = derivePlayingStateIntervals(session, "ALL", "PJ_RIVAL");
  assert.deepEqual(cda.map((interval) => [interval.period, interval.startMinute, interval.endMinute]), [[1, 12, 15], [2, 15, 19]]);
  assert.deepEqual(rival.map((interval) => [interval.period, interval.startMinute, interval.endMinute]), [[2, 11, 14]]);
  assert.equal(deriveCompetitiveMinutes(session, "ALL", "ALL", [], "PJ_CDA").observed, 7);
  assert.equal(deriveCompetitiveMinutes(session, "ALL", "ALL", [], "PJ_RIVAL").observed, 3);
  assert.equal(competitiveEventIds(session, "ALL", "ALL", [], "PJ_CDA").has("phase-only"), false);
});

test("un intervalo P-J abierto se cierra al final observado de su periodo y no salta a P2", () => {
  const record = playingStateRecord();
  const events = record.session.events.filter((event) => !["pj-cda-p1-off", "pj-cda-p2-on", "pj-cda-p2-off"].includes(event.id));
  const intervals = derivePlayingStateIntervals({ ...record.session, events }, "ALL", "PJ_CDA");
  assert.deepEqual(intervals.map((interval) => [interval.period, interval.startMinute, interval.endMinute]), [[1, 12, 20]]);
});

test("P-J CDA abierto al finalizar P2 usa el límite deportivo y no el último evento", () => {
  const record = playingStateRecord();
  const events = record.session.events.filter((event) => !["pj-cda-p2-off", "pj-cda-c"].includes(event.id));
  const intervals = derivePlayingStateIntervals({ ...record.session, events }, 2, "PJ_CDA");
  assert.deepEqual(intervals.map((interval) => [interval.startMinute, interval.endMinute]), [[15, 20]]);
});

test("P-J rival abierto al finalizar P2 usa el límite deportivo y permanece separado de P1", () => {
  const record = playingStateRecord();
  const events = record.session.events.filter((event) => event.id !== "pj-rival-off");
  const intervals = derivePlayingStateIntervals({ ...record.session, events }, "ALL", "PJ_RIVAL");
  assert.deepEqual(intervals.map((interval) => [interval.period, interval.startMinute, interval.endMinute]), [[2, 11, 20]]);
});

test("filtro PJ incluye solo eventos del intervalo y se intersecta con Clave/Oro", () => {
  const record = playingStateRecord();
  const cda = filterDashboardDataset([record], { ...baseScope(), matchIds: [record.catalog.matchId], playingState: "PJ_CDA" });
  const threats = cda[0].session.events.filter((event) => event.type === "threat_recorded").map((event) => event.id);
  assert.deepEqual(threats, ["pj-cda-a", "pj-cda-b", "pj-cda-c"]);
  assert.equal(deriveCompetitiveMinutes(record.session, "ALL", "GOLD", [], "PJ_CDA").observed, 4);
  assert.equal(deriveCompetitiveMinutes(record.session, "ALL", "KEY", [], "PJ_CDA").observed, 7);
  const gold = buildDashboardV2([record], { ...baseScope(), matchIds: [record.catalog.matchId], competitiveContext: "GOLD", playingState: "PJ_CDA" });
  assert.equal(gold.rates.observedMinutes, 4);
  assert.equal(gold.analytics.threats.FOR.total, 1);
  assert.equal(gold.analytics.threats.AGAINST.total, 1);
  const rival = buildDashboardV2([record], { ...baseScope(), matchIds: [record.catalog.matchId], playingState: "PJ_RIVAL" });
  assert.equal(rival.rates.observedMinutes, 3);
  assert.equal(rival.analytics.threats.FOR.total, 0);
  assert.equal(rival.analytics.threats.AGAINST.total, 1);
  assert.equal(rival.goalkeepers.find((keeper) => keeper.playerId === "fx-gk-1")?.minutes, 3);
  const ownWithKeeper = buildDashboardV2([record], { ...baseScope(), matchIds: [record.catalog.matchId], playingState: "PJ_CDA", goalkeeperIds: ["fx-gk-1"] });
  assert.equal(ownWithKeeper.rates.observedMinutes, 0, "el P-J CDA no contamina al portero funcional normal");
});

test("MEDIA PLANTILLA se recalcula con los jugadores elegibles dentro de PJ CDA", () => {
  const record = playingStateRecord();
  const analysis = buildDashboardV2([record], { ...baseScope(), matchIds: [record.catalog.matchId], playingState: "PJ_CDA" });
  const average = squadAverage(analysis.players, (player) => playerMetricValue(player, "threats", "TOTALS"));
  assert.ok(average.eligiblePlayers > 0);
  assert.equal(average.value, analysis.players.filter((player) => player.minutes > 0).reduce((sum, player) => sum + player.ownThreats, 0) / average.eligiblePlayers);
});

test("promedios PJ distinguen todos los partidos de los partidos con uso", () => {
  const record = playingStateRecord();
  const without = { ...buildDashboardFixture()[1], catalog: { ...buildDashboardFixture()[1].catalog, matchId: "pj-without" }, session: { ...buildDashboardFixture()[1].session, matchId: "pj-without", events: buildDashboardFixture()[1].session.events.map((event) => ({ ...event, matchId: "pj-without" })) } };
  const analysis = buildDashboardV2([record, without], baseScope());
  assert.equal(analysis.flyingGoalkeeper.for.minutes, 7);
  assert.equal(analysis.flyingGoalkeeper.for.matchesWithState, 1);
  assert.equal(analysis.flyingGoalkeeper.for.minutesPerMatch, 3.5);
  assert.equal(analysis.flyingGoalkeeper.for.minutesPerMatchWithState, 7);
  assert.equal(analysis.flyingGoalkeeper.against.minutes, 3);
});

function competitiveFortyMinuteRecord(): DashboardMatchRecord {
  const source = buildDashboardFixture()[0];
  const matchId = "competitive-40";
  const squad = source.session.players.map((player) => player.id);
  const lineup = ["fx-gk-1", "fx-p-2", "fx-p-4", "fx-p-5", "fx-p-7"];
  const events: MatchEvent[] = [
    createLineupInitializedEvent({ id: "c40-p1", matchId, position: { period: 1, minute: 0, order: 1 }, squadPlayerIds: squad, onCourtPlayerIds: lineup, goalkeeperPlayerId: "fx-gk-1", now: 1 }),
    createLiveThreatEvent({ id: "c40-1-0", matchId, position: { period: 1, minute: 8, order: 1 }, side: "FOR", playerId: "fx-p-4", origin: { x: .1, y: .5 }, outcome: "GOL", phase: "POSITIONAL", assist: { status: "NONE" }, now: 2 }),
    createLiveThreatEvent({ id: "c40-2-0", matchId, position: { period: 1, minute: 13, order: 1 }, side: "FOR", playerId: "fx-p-4", origin: { x: .1, y: .5 }, outcome: "GOL", phase: "POSITIONAL", assist: { status: "NONE" }, now: 3 }),
    createLineupInitializedEvent({ id: "c40-p2", matchId, position: { period: 2, minute: 0, order: 1 }, squadPlayerIds: squad, onCourtPlayerIds: lineup, goalkeeperPlayerId: "fx-gk-1", now: 4 }),
    createLiveThreatEvent({ id: "c40-2-1", matchId, position: { period: 2, minute: 0, order: 2 }, side: "AGAINST", origin: { x: .6, y: .5 }, outcome: "GOL", phase: "TRANSITION", defensive: { version: 2, goalTarget: { x: .5, y: .5, geometryVersion: 3 }, goalkeeper: { status: "PLAYER", playerId: "fx-gk-1" } }, now: 5 }),
    createLiveThreatEvent({ id: "c40-close-save", matchId, position: { period: 2, minute: 5, order: 1 }, side: "AGAINST", origin: { x: .6, y: .5 }, outcome: "PARADA", phase: "POSITIONAL", defensive: { version: 2, goalTarget: { x: .5, y: .5, geometryVersion: 3 }, goalkeeper: { status: "PLAYER", playerId: "fx-gk-1" }, saveOutcome: "CATCH" }, now: 6 }),
    createLiveThreatEvent({ id: "c40-3-1", matchId, position: { period: 2, minute: 10, order: 1 }, side: "FOR", playerId: "fx-p-4", origin: { x: .1, y: .5 }, outcome: "GOL", phase: "POSITIONAL", assist: { status: "NONE" }, now: 7 }),
    createLiveThreatEvent({ id: "c40-wide-save", matchId, position: { period: 2, minute: 12, order: 1 }, side: "AGAINST", origin: { x: .6, y: .5 }, outcome: "PARADA", phase: "POSITIONAL", defensive: { version: 2, goalTarget: { x: .5, y: .5, geometryVersion: 3 }, goalkeeper: { status: "PLAYER", playerId: "fx-gk-1" }, saveOutcome: "REBOUND" }, now: 8 }),
    createLiveThreatEvent({ id: "c40-3-2", matchId, position: { period: 2, minute: 14, order: 1 }, side: "AGAINST", origin: { x: .6, y: .5 }, outcome: "GOL", phase: "TRANSITION", defensive: { version: 2, goalTarget: { x: .5, y: .5, geometryVersion: 3 }, goalkeeper: { status: "PLAYER", playerId: "fx-gk-1" } }, now: 9 }),
    createLiveThreatEvent({ id: "c40-gold-save", matchId, position: { period: 2, minute: 17, order: 1 }, side: "AGAINST", origin: { x: .6, y: .5 }, outcome: "PARADA", phase: "POSITIONAL", defensive: { version: 2, goalTarget: { x: .5, y: .5, geometryVersion: 3 }, goalkeeper: { status: "PLAYER", playerId: "fx-gk-1" }, saveOutcome: "CLEARANCE" }, now: 10 }),
  ];
  return { catalog: { ...source.catalog, matchId, opponent: "Contexto FC" }, session: { ...source.session, matchId, events } };
}

test("portero de 40 minutos tiene 29 clave e intersecta stats sin contar el tramo +2", () => {
  const record = competitiveFortyMinuteRecord();
  const key = deriveCompetitiveMinutes(record.session, "ALL", "KEY");
  assert.equal(key.byPlayer["fx-gk-1"], 29);
  assert.equal(key.byGoalkeeper["fx-gk-1"], 29);
  const projection = deriveCompetitiveProjection(record.session, "ALL", "KEY");
  assert.equal(projection.eventIds.has("c40-wide-save"), false);
  assert.equal(projection.eventIds.has("c40-close-save"), true);
  assert.equal(projection.eventIds.has("c40-gold-save"), true);
  const analysis = buildDashboardV2([record], { ...baseScope(), competitiveContext: "KEY" });
  const goalkeeper = analysis.goalkeepers.find((item) => item.playerId === "fx-gk-1")!;
  assert.equal(goalkeeper.minutes, 29);
  assert.equal(goalkeeper.saves, 2);
  assert.equal(goalkeeper.saveOutcomes.REBOUND, 0);
});

test("ventana Oro empieza en P2 min 15 aunque no exista evento en ese borde", () => {
  const record = competitiveFortyMinuteRecord();
  const gold = deriveCompetitiveMinutes(record.session, "ALL", "GOLD");
  assert.equal(gold.observed, 5);
  assert.equal(gold.byPlayer["fx-gk-1"], 5);
  const ids = competitiveEventIds(record.session, "ALL", "GOLD");
  assert.equal(ids.has("c40-3-2"), false);
  assert.equal(ids.has("c40-gold-save"), true);
});

test("minutos clave intersectan entradas y salidas múltiples sin regalar el tramo ausente", () => {
  const record = competitiveFortyMinuteRecord();
  const p2 = record.session.events.find((event) => event.id === "c40-p2");
  assert.ok(p2?.type === "lineup_initialized");
  const events: MatchEvent[] = [
    ...record.session.events.filter((event) => event.id !== "c40-p2"),
    createSubstitutionEvent({ id: "c40-sub-out", matchId: record.catalog.matchId, position: { period: 1, minute: 10, order: 1 }, playerOutId: "fx-p-2", playerInId: "fx-p-8", now: 11 }),
    { ...p2, onCourtPlayerIds: p2.onCourtPlayerIds.map((id) => id === "fx-p-2" ? "fx-p-8" : id) },
  ];
  const session = { ...record.session, events };
  const key = deriveCompetitiveMinutes(session, "ALL", "KEY");
  assert.equal(key.byPlayer["fx-p-2"], 10);
  assert.equal(key.byPlayer["fx-p-8"], 19);
  assert.equal((key.byPlayer["fx-p-2"] ?? 0) + (key.byPlayer["fx-p-8"] ?? 0), 29);
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

test("mapas general, jugador y portero conservan identidad exacta aunque compartan coordenadas", () => {
  const record = buildDashboardFixture()[0];
  const analysis = buildDashboardV2([record], baseScope());
  const general = analysis.analytics.pitchPoints.find((point) => point.side === "FOR");
  const player = analysis.players.flatMap((item) => item.ownShotPoints).find(Boolean);
  const goalkeeper = analysis.goalkeepers.flatMap((item) => item.goalPoints).find(Boolean);
  assert.ok(general && player && goalkeeper);
  const duplicatedGeneral = { ...general, x: .5, y: .5 };
  const duplicatedPlayer = { ...player, x: .5, y: .5 };
  const duplicatedGoalkeeper = { ...goalkeeper, target: { ...goalkeeper.target, x: .5, y: .5 } };
  assert.equal(resolveDashboardMapPoint([record], duplicatedGeneral)?.event.id, general.eventId);
  assert.equal(resolveDashboardMapPoint([record], duplicatedPlayer)?.event.id, player.eventId);
  assert.equal(resolveDashboardMapPoint([record], duplicatedGoalkeeper)?.event.id, goalkeeper.eventId);
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

test("referenceScope personalizado hace roundtrip en URL sin alterar analysisScope", () => {
  const analysis = { ...baseScope(), competition: "LEAGUE" as const, matchIds: ["dashboard-fixture-8"] };
  const reference = { ...baseScope(), competition: "LEAGUE" as const, rivals: ["Racing Norte", "Sala Centro"], venues: ["AWAY" as const], period: 2 as const };
  const query = mergeDashboardSearchParams({ analysis, reference, referencePreset: "CUSTOM", mode: "TOTALS", area: "PLAYERS" });
  const params = new URLSearchParams(query);
  assert.deepEqual(scopeFromSearchParams(params, "a", emptyDashboardScope()).matchIds, analysis.matchIds);
  assert.deepEqual(scopeFromSearchParams(params, "r", emptyDashboardScope()).rivals, reference.rivals);
  assert.deepEqual(scopeFromSearchParams(params, "r", emptyDashboardScope()).venues, ["AWAY"]);
  assert.equal(scopeFromSearchParams(params, "r", emptyDashboardScope()).period, 2);
  assert.equal(params.get("reference"), "CUSTOM");
});

test("partido vs partido usa bruto y partido vs multiparte usa media homogénea", () => {
  assert.equal(homogeneousComparisonMode(1, 1, "TOTALS"), "TOTALS");
  assert.equal(homogeneousComparisonMode(1, 5, "TOTALS"), "PER_MATCH");
  assert.equal(homogeneousComparisonMode(4, 6, "TOTALS"), "PER_MATCH");
  assert.equal(homogeneousComparisonMode(4, 4, "TOTALS"), "PER_MATCH");
  assert.equal(homogeneousComparisonMode(1, 5, "PER_40"), "PER_40");
});

test("combobox busca 30 partidos por rival jornada fecha y competición", () => {
  const matches = buildDashboardFixture().map((record) => ({ ...record.catalog, matchday: record.session.preparation?.matchday, competitionLabel: record.session.preparation?.competitionType }));
  assert.equal(matches.length, 30);
  assert.ok(filterSearchableMatches(matches, "Racing Norte").every((match) => match.opponent === "Racing Norte"));
  assert.deepEqual(filterSearchableMatches(matches, "J7").map((match) => match.matchday), [7]);
  assert.ok(filterSearchableMatches(matches, "league").length > 10);
  assert.ok(filterSearchableMatches(matches, "alz").length >= 2);
  assert.deepEqual(filterSearchableMatches(matches, "  ÁLZ  ").map((match) => match.matchId), filterSearchableMatches(matches, "alz").map((match) => match.matchId));
  assert.match(searchableMatchLabel(matches[6]), /^J7 · /);
});

test("gráficas adaptan gap y labels sin eliminar observaciones", () => {
  const five = adaptiveChartLayout(5, 390);
  const fifteen = adaptiveChartLayout(15, 390);
  const thirty = adaptiveChartLayout(30, 390);
  assert.ok(five.gap > fifteen.gap && fifteen.gap > thirty.gap);
  assert.equal(five.labelEvery, 1);
  assert.ok(thirty.labelEvery > 1);
});

test("mapas del mismo jugador respetan eventIds distintos de analysis y reference", () => {
  const records = buildDashboardFixture();
  const analysis = buildDashboardV2(records, { ...baseScope(), matchIds: [records[0].catalog.matchId] });
  const reference = buildDashboardV2(records, { ...baseScope(), matchIds: [records[1].catalog.matchId] });
  const a = analysis.players.find((player) => player.playerId === "fx-p-4")?.ownShotPoints ?? [];
  const b = reference.players.find((player) => player.playerId === "fx-p-4")?.ownShotPoints ?? [];
  assert.ok(a.length > 0 && b.length > 0);
  assert.ok(a.every((point) => point.matchId === records[0].catalog.matchId));
  assert.ok(b.every((point) => point.matchId === records[1].catalog.matchId));
  assert.equal(new Set([...a, ...b].map((point) => `${point.matchId}:${point.eventId}`)).size, a.length + b.length);
});

function scoreStateRecord(): DashboardMatchRecord {
  const source = buildDashboardFixture()[0];
  const matchId = "score-state-sequence";
  const squad = source.session.players.map((player) => player.id);
  const p1 = ["fx-gk-1", "fx-p-2", "fx-p-4", "fx-p-5", "fx-p-7"];
  const p2 = ["fx-gk-2", "fx-p-5", "fx-p-7", "fx-p-9", "fx-p-10"];
  const goal = (id: string, minute: number, order: number, side: "FOR" | "AGAINST") => createLiveThreatEvent({
    id, matchId, position: { period: 1, minute, order }, side,
    playerId: side === "FOR" ? "fx-p-4" : undefined,
    origin: { x: .5, y: .5 }, outcome: "GOL", phase: "POSITIONAL",
    assist: side === "FOR" ? { status: "NONE" as const } : undefined,
    defensive: side === "AGAINST" ? { version: 2 as const, goalTarget: { x: .5, y: .5, geometryVersion: 3 as const }, goalkeeper: { status: "PLAYER" as const, playerId: "fx-gk-1" } } : undefined,
    now: minute * 10 + order,
  });
  const loss = (id: string, period: number, minute: number, order: number, playerId: string) => createPossessionLostEvent({ id, matchId, position: { period, minute, order }, playerId, now: 100 + minute * 10 + order });
  const events: MatchEvent[] = [
    createLineupInitializedEvent({ id: "score-p1", matchId, position: { period: 1, minute: 0, order: 1 }, squadPlayerIds: squad, onCourtPlayerIds: p1, goalkeeperPlayerId: "fx-gk-1", now: 1 }),
    loss("loss-drawing-a", 1, 1, 1, "fx-p-4"),
    goal("goal-0-1", 2, 1, "AGAINST"),
    loss("loss-trailing", 1, 2, 2, "fx-p-4"),
    goal("goal-1-1", 4, 1, "FOR"),
    loss("loss-drawing-b", 1, 4, 2, "fx-p-4"),
    goal("goal-2-1", 6, 1, "FOR"),
    loss("loss-leading-a", 1, 6, 2, "fx-p-4"),
    goal("goal-2-2", 8, 1, "AGAINST"),
    loss("loss-drawing-c", 1, 8, 2, "fx-p-4"),
    goal("goal-3-2", 10, 1, "FOR"),
    loss("loss-leading-b", 1, 10, 2, "fx-p-4"),
    createGameStateEvent({ id: "score-pj-on", matchId, position: { period: 1, minute: 12, order: 1 }, state: "FLYING_GOALKEEPER", active: true, playerId: "fx-p-4", side: "FOR", now: 220 }),
    loss("loss-leading-pj", 1, 13, 1, "fx-p-4"),
    createGameStateEvent({ id: "score-pj-off", matchId, position: { period: 1, minute: 14, order: 1 }, state: "FLYING_GOALKEEPER", active: false, side: "FOR", now: 240 }),
    createLineupInitializedEvent({ id: "score-p2", matchId, position: { period: 2, minute: 0, order: 1 }, squadPlayerIds: squad, onCourtPlayerIds: p2, goalkeeperPlayerId: "fx-gk-2", now: 300 }),
    loss("loss-leading-p2", 2, 1, 1, "fx-p-9"),
  ];
  return {
    catalog: { ...source.catalog, matchId, opponent: "Secuencia marcador" },
    session: { ...source.session, matchId, preparation: { ...source.session.preparation!, opponent: "Secuencia marcador" }, events },
  };
}

test("estado del marcador deriva intervalos 0-0→0-1→1-1→2-1→2-2→3-2 sin segundos", () => {
  const record = scoreStateRecord();
  assert.deepEqual(deriveScoreStateIntervals(record.session), [
    { state: "DRAWING", startGlobalMinute: 0, endGlobalMinute: 2 },
    { state: "TRAILING", startGlobalMinute: 2, endGlobalMinute: 4 },
    { state: "DRAWING", startGlobalMinute: 4, endGlobalMinute: 6 },
    { state: "LEADING", startGlobalMinute: 6, endGlobalMinute: 8 },
    { state: "DRAWING", startGlobalMinute: 8, endGlobalMinute: 10 },
    { state: "LEADING", startGlobalMinute: 10, endGlobalMinute: 40 },
  ]);
  assert.equal(deriveCompetitiveMinutes(record.session, "ALL", "ALL", [], "ALL", "DRAWING").observed, 6);
  assert.equal(deriveCompetitiveMinutes(record.session, "ALL", "ALL", [], "ALL", "TRAILING").observed, 2);
  assert.equal(deriveCompetitiveMinutes(record.session, "ALL", "ALL", [], "ALL", "LEADING").observed, 32);
});

test("cada evento usa el marcador inmediatamente anterior y el orden resuelve el mismo minuto", () => {
  const session = scoreStateRecord().session;
  const drawing = competitiveEventIds(session, "ALL", "ALL", [], "ALL", "DRAWING");
  const trailing = competitiveEventIds(session, "ALL", "ALL", [], "ALL", "TRAILING");
  const leading = competitiveEventIds(session, "ALL", "ALL", [], "ALL", "LEADING");
  assert.equal(drawing.has("goal-0-1"), true, "el gol que rompe el empate pertenece al estado previo");
  assert.equal(trailing.has("goal-1-1"), true, "el empate pertenece al estado previo perdiendo");
  assert.equal(trailing.has("loss-trailing"), true, "order posterior al gol ya ve 0-1");
  assert.equal(drawing.has("loss-trailing"), false);
  assert.equal(leading.has("goal-2-2"), true, "el gol rival que empata pertenece al estado previo ganando");
  assert.equal(drawing.has("loss-drawing-c"), true);
});

test("pérdidas y minutos cruzan estado de marcador, periodo, P-J, KEY/GOLD y URL independiente", () => {
  const record = scoreStateRecord();
  const leading = buildDashboardV2([record], { ...baseScope(), matchIds: [record.catalog.matchId], scoreState: "LEADING" });
  assert.equal(leading.possessionLosses, 4);
  assert.equal(leading.players.find((player) => player.playerId === "fx-p-4")?.possessionLosses, 3);
  assert.equal(leading.players.find((player) => player.playerId === "fx-p-9")?.possessionLosses, 1);
  assert.equal(buildDashboardV2([record], { ...baseScope(), matchIds: [record.catalog.matchId], scoreState: "LEADING", period: 1 }).rates.observedMinutes, 12);
  assert.equal(buildDashboardV2([record], { ...baseScope(), matchIds: [record.catalog.matchId], scoreState: "LEADING", playingState: "PJ_CDA" }).possessionLosses, 1);
  assert.equal(deriveCompetitiveProjection(record.session, "ALL", "GOLD", [], "ALL", "LEADING").observed, 5);
  const analysis = { ...baseScope(), scoreState: "TRAILING" as const };
  const reference = { ...baseScope(), scoreState: "LEADING" as const };
  const params = new URLSearchParams(mergeDashboardSearchParams({ analysis, reference, referencePreset: "CUSTOM", mode: "PER_40", area: "PLAYERS" }));
  assert.equal(params.get("aScoreState"), "TRAILING");
  assert.equal(params.get("rScoreState"), "LEADING");
  assert.equal(scopeFromSearchParams(params, "a", baseScope()).scoreState, "TRAILING");
  assert.equal(scopeFromSearchParams(params, "r", baseScope()).scoreState, "LEADING");
});

test("pérdidas se agregan en total, por partido y por 40 sin entrar en SCORE ALAM", () => {
  const records = buildDashboardFixture();
  const analysis = buildDashboardV2(records, baseScope());
  assert.ok(analysis.possessionLosses > 0);
  assert.equal(teamMetricValue(analysis, "possessionLosses", "TOTALS"), analysis.possessionLosses);
  assert.equal(teamMetricValue(analysis, "possessionLosses", "PER_MATCH"), analysis.possessionLosses / analysis.samples);
  assert.equal(teamMetricValue(analysis, "possessionLosses", "PER_40"), analysis.rates.possessionLosses40);
  assert.equal(METRIC_DEFINITIONS.POSSESSION_LOSSES.direction, "LOWER_IS_BETTER");
  const player = analysis.players.find((candidate) => candidate.possessionLosses > 0)!;
  const before = buildPlayerScores([{ ...player, possessionLosses: 0, possessionLossesPerMatch: 0, possessionLosses40: 0 }])[0].score;
  assert.equal(buildPlayerScores([player])[0].score, before);
  const average = squadAverage(
    [{ minutes: 10, losses: 2 }, { minutes: 20, losses: 4 }, { minutes: 30, losses: 6 }, { minutes: 0, losses: 999 }],
    (item) => item.minutes > 0 ? item.losses : null,
  );
  assert.equal(average.value, 4);
  assert.equal(average.validValues, 3);
});
