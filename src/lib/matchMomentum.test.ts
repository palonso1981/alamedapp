import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DashboardMatchRecord } from "./dashboardAnalytics";
import {
  buildMatchMomentum,
  classifyMomentumDanger,
  deriveSharedPlayerIntervals,
  EMPTY_MOMENTUM_FILTERS,
  momentumBinTotal,
  momentumExportHeading,
} from "./matchMomentum";
import {
  createLineupInitializedEvent,
  createLiveThreatEvent,
  createSubstitutionEvent,
} from "./matchEngine";
import { MatchEvent, MatchSession, Player, ThreatPhase } from "../types";

const players: Player[] = Array.from({ length: 6 }, (_, index) => ({
  id: `p${index + 1}`,
  name: `Jugador ${index + 1}`,
  number: index + 1,
  position: index === 0 ? "PORTERO" : "ALA",
  goalkeeperCapable: index === 0,
}));

function threat(id: string, period: number, minute: number, order: number, side: "FOR" | "AGAINST", outcome: "GOL" | "PARADA" | "FUERA", x: number, phase: ThreatPhase = "POSITIONAL"): MatchEvent {
  return createLiveThreatEvent({
    id, matchId: "momentum", position: { period, minute, order }, side,
    playerId: side === "FOR" ? "p2" : undefined,
    origin: { x, y: .5 }, outcome, phase: phase === "UNSPECIFIED" ? "POSITIONAL" : phase,
    defensive: side === "AGAINST" ? {
      version: 2, goalTarget: { x: outcome === "FUERA" ? .1 : .5, y: outcome === "FUERA" ? .1 : .5, geometryVersion: 3 },
      goalkeeper: { status: "PLAYER", playerId: "p1" },
      keeperBodyPart: outcome === "PARADA" ? "TORSO" : undefined,
      saveOutcome: outcome === "PARADA" ? "CATCH" : undefined,
    } : undefined,
    now: minute * 100 + order,
  });
}

function record(): DashboardMatchRecord {
  const events: MatchEvent[] = [
    createLineupInitializedEvent({ id: "lineup-p1", matchId: "momentum", position: { period: 1, minute: 0, order: 1 }, squadPlayerIds: players.map((player) => player.id), onCourtPlayerIds: ["p1", "p2", "p3", "p4", "p5"], goalkeeperPlayerId: "p1", now: 1 }),
    threat("normal", 1, 2, 1, "FOR", "FUERA", .5),
    threat("near", 1, 2, 2, "FOR", "FUERA", .9),
    threat("high", 1, 2, 3, "FOR", "PARADA", .9),
    threat("goal", 1, 2, 4, "FOR", "GOL", .9),
    threat("rival-high", 1, 4, 1, "AGAINST", "PARADA", .1, "TRANSITION"),
    createSubstitutionEvent({ id: "sub", matchId: "momentum", position: { period: 1, minute: 8, order: 1 }, playerOutId: "p2", playerInId: "p6", now: 801 }),
    createLineupInitializedEvent({ id: "lineup-p2", matchId: "momentum", position: { period: 2, minute: 0, order: 1 }, squadPlayerIds: players.map((player) => player.id), onCourtPlayerIds: ["p1", "p3", "p4", "p5", "p6"], goalkeeperPlayerId: "p1", now: 2001 }),
    threat("p2-goal", 2, 3, 1, "AGAINST", "GOL", .5, "TRANSITION"),
  ];
  const session: MatchSession = { matchId: "momentum", players, staff: [], period: 2, minute: 20, periodMinutes: { 1: 20, 2: 20 }, closedPeriods: [1, 2], matchFinished: true, events, past: [], future: [], lastError: null, persistenceStatus: "saved", lastSavedAt: 1 };
  return { catalog: { matchId: "momentum", clubId: "club", teamId: "team", seasonId: "season", opponent: "Cumbres", venue: "HOME", date: "2026-09-27", status: "FINISHED", updatedAt: 1 }, session };
}

test("Momentum clasifica peligrosidad con prioridad exclusiva sin doble conteo", () => {
  const data = record();
  const events = data.session.events.filter((event) => event.type === "threat_recorded");
  assert.deepEqual(events.slice(0, 4).map(classifyMomentumDanger), ["NORMAL", "NEAR", "HIGH", "GOAL"]);
  const momentum = buildMatchMomentum(data);
  const bin = momentum.bins.find((item) => item.key === "1:2")!;
  assert.equal(momentumBinTotal(bin, "FOR"), 4);
  assert.deepEqual(bin.FOR, { NORMAL: 1, NEAR: 1, HIGH: 1, GOAL: 1 });
});

test("Momentum dibuja CDA arriba y rival abajo mediante series separadas", () => {
  const momentum = buildMatchMomentum(record());
  assert.equal(momentum.bins.find((item) => item.key === "1:2")?.FOR.GOAL, 1);
  assert.equal(momentum.bins.find((item) => item.key === "1:4")?.AGAINST.HIGH, 1);
});

test("Momentum filtra TODO, P1, P2, fase y peligrosidad", () => {
  const data = record();
  assert.equal(buildMatchMomentum(data).actions.length, 6);
  assert.ok(buildMatchMomentum(data, { ...EMPTY_MOMENTUM_FILTERS, period: 1 }).actions.every((item) => item.period === 1));
  assert.deepEqual(buildMatchMomentum(data, { ...EMPTY_MOMENTUM_FILTERS, period: 2 }).actions.map((item) => item.eventId), ["p2-goal"]);
  assert.deepEqual(buildMatchMomentum(data, { ...EMPTY_MOMENTUM_FILTERS, phases: ["TRANSITION"] }).actions.map((item) => item.eventId), ["rival-high", "p2-goal"]);
  assert.deepEqual(buildMatchMomentum(data, { ...EMPTY_MOMENTUM_FILTERS, danger: "HIGH" }).actions.map((item) => item.eventId), ["high", "rival-high"]);
});

test("una acción sin coordenadas fiables permanece NORMAL", () => {
  const event = threat("invalid", 1, 1, 1, "FOR", "PARADA", Number.NaN);
  assert.equal(event.type === "threat_recorded" ? classifyMomentumDanger(event) : null, "NORMAL");
});

test("la selección de uno o varios jugadores deriva intervalos e intersección desde sustituciones", () => {
  const session = record().session;
  assert.deepEqual(deriveSharedPlayerIntervals(session, ["p2"]), [{ start: 0, end: 8 }]);
  assert.deepEqual(deriveSharedPlayerIntervals(session, ["p1", "p2"]), [{ start: 0, end: 8 }]);
  assert.deepEqual(deriveSharedPlayerIntervals(session, ["p1", "p6"]), [{ start: 8, end: 40 }]);
  assert.deepEqual(deriveSharedPlayerIntervals(session, ["p2", "p6"]), []);
});

test("la coincidencia solo atenúa fuera del intervalo y no elimina el partido", () => {
  const momentum = buildMatchMomentum(record(), { ...EMPTY_MOMENTUM_FILTERS, playerIds: ["p2"] });
  assert.equal(momentum.actions.length, 6);
  assert.equal(momentum.bins.find((item) => item.key === "1:2")?.highlighted, true);
  assert.equal(momentum.bins.find((item) => item.key === "2:3")?.highlighted, false);
  assert.equal(momentum.sharedMinutes, 8);
});

test("la exportación incorpora partido y filtros activos", () => {
  const filters = { ...EMPTY_MOMENTUM_FILTERS, period: 1 as const, phases: ["TRANSITION" as const], playerIds: ["p1", "p2"] };
  assert.equal(momentumExportHeading(buildMatchMomentum(record(), filters), filters), "Cumbres · P1 · TRANSITION · Todas las peligrosidades · Jugador 1 + Jugador 2");
});

test("el componente conserva selector interno y SVG responsive sin overflow global", () => {
  const source = readFileSync("src/components/dashboard/MatchMomentumPanel.tsx", "utf8");
  assert.match(source, /aria-label="Partido de Momentum"/);
  assert.match(source, /viewBox=/);
  assert.match(source, /className="h-auto w-full/);
  assert.match(source, /COMPARTIR \/ EXPORTAR IMAGEN/);
});
