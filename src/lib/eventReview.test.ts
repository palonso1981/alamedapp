import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildDashboardAnalysis } from "./dashboardAnalysis";
import { DashboardMatchRecord } from "./dashboardAnalytics";
import {
  createLineupInitializedEvent,
  createLiveThreatEvent,
  createPossessionLostEvent,
  createSubstitutionEvent,
  editEvent,
  replayMatch,
  softDeleteEvent,
} from "./matchEngine";
import { buildMatchMomentum } from "./matchMomentum";
import { loadMatchSession, LocalStorageAdapter, saveMatchSession } from "./matchPersistence";
import { MatchEvent, MatchSession, Player } from "../types";

class MemoryStorage implements LocalStorageAdapter {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const players: Player[] = [
  { id: "gk", name: "Portero", number: 1, position: "PORTERO", goalkeeperCapable: true },
  { id: "a", name: "Jugador A", number: 4 },
  { id: "b", name: "Jugador B", number: 5 },
  { id: "c", name: "Jugador C", number: 6 },
  { id: "d", name: "Jugador D", number: 7 },
  { id: "e", name: "Jugador E", number: 8 },
];

function lineup(matchId: string): MatchEvent {
  return createLineupInitializedEvent({
    id: `${matchId}-lineup`, matchId,
    position: { period: 1, minute: 0, order: 1 },
    squadPlayerIds: players.map((player) => player.id),
    onCourtPlayerIds: ["gk", "a", "b", "c", "d"],
    goalkeeperPlayerId: "gk", now: 1,
  });
}

function record(matchId: string, events: MatchEvent[]): DashboardMatchRecord {
  const preparation = {
    clubId: "club", teamId: "team", seasonId: "season", opponent: "Rival",
    venue: "HOME" as const, date: "2026-10-06", status: "FINISHED" as const,
    calledPlayerIds: players.map((player) => player.id), starterPlayerIds: ["gk", "a", "b", "c", "d"],
    startingGoalkeeperId: "gk", selectedStaffIds: [], targetMinutes: {}, createdAt: 1, updatedAt: 2,
  };
  const session: MatchSession = {
    matchId, preparation, players, staff: [], period: 2, minute: 20,
    periodMinutes: { 1: 20, 2: 20 }, closedPeriods: [1, 2], matchFinished: true,
    reviewStatus: "IN_REVIEW", events, past: [], future: [], lastError: null,
    persistenceStatus: "saved", lastSavedAt: 2,
  };
  return {
    catalog: { matchId, clubId: "club", teamId: "team", seasonId: "season", opponent: "Rival", venue: "HOME", date: "2026-10-06", status: "FINISHED", updatedAt: 2 },
    session,
  };
}

function analysis(events: MatchEvent[]) {
  return buildDashboardAnalysis([record("review-event", events)], {
    clubId: "club", teamId: "team", seasonId: "season", matchId: "review-event",
  });
}

test("editar desde revisión conserva identidad y recalcula jugador, fase, resultado y coordenadas", () => {
  const loss = createPossessionLostEvent({
    id: "loss", matchId: "review-event", position: { period: 1, minute: 2, order: 1 }, playerId: "a", now: 20,
  });
  const shot = createLiveThreatEvent({
    id: "shot", matchId: "review-event", position: { period: 1, minute: 3, order: 1 },
    side: "FOR", playerId: "a", origin: { x: 0.2, y: 0.3 }, outcome: "FUERA", phase: "POSITIONAL", now: 30,
  });
  let events = [lineup("review-event"), loss, shot];
  events = editEvent(players, events, loss.id, { possessionLost: { playerId: "b" } }, 40);
  events = editEvent(players, events, shot.id, {
    threat: { phase: "TRANSITION", outcome: "GOL", origin: { x: 0.82, y: 0.61 }, assist: { status: "NONE" } },
  }, 50);

  const edited = events.find((event) => event.id === shot.id);
  assert.equal(edited?.id, "shot");
  assert.equal(edited?.createdAt, 30);
  assert.equal(edited?.type === "threat_recorded" && edited.phase, "TRANSITION");
  assert.deepEqual(edited?.type === "threat_recorded" && edited.origin, { x: 0.82, y: 0.61 });
  assert.equal(replayMatch(players, events).score.for, 1);

  const derived = analysis(events);
  assert.equal(derived.players.find((player) => player.playerId === "a")?.possessionLosses, 0);
  assert.equal(derived.players.find((player) => player.playerId === "b")?.possessionLosses, 1);
  assert.equal(derived.analytics.phases.POSITIONAL.FOR, 0);
  assert.equal(derived.analytics.phases.TRANSITION.FOR, 1);
  assert.equal(derived.analytics.goalsFor, 1);
});

test("PENDING_REVIEW no computa y confirmar lo reincorpora exactamente una vez", () => {
  const goal = createLiveThreatEvent({
    id: "goal", matchId: "review-event", position: { period: 1, minute: 4, order: 1 },
    side: "FOR", playerId: "a", origin: { x: 0.8, y: 0.5 }, outcome: "GOL", phase: "POSITIONAL", assist: { status: "NONE" }, now: 40,
  });
  let events = [lineup("review-event"), goal];
  assert.equal(replayMatch(players, events).score.for, 1);
  events = editEvent(players, events, goal.id, { reviewState: "PENDING_REVIEW" }, 50);
  assert.equal(events.find((event) => event.id === goal.id)?.reviewState, "PENDING_REVIEW");
  assert.equal(replayMatch(players, events).score.for, 0);
  assert.equal(analysis(events).analytics.threats.FOR.total, 0);
  assert.equal(buildMatchMomentum(record("review-event", events)).actions.length, 0);

  events = editEvent(players, events, goal.id, { reviewState: null }, 60);
  assert.equal(events.find((event) => event.id === goal.id)?.reviewState, undefined);
  assert.equal(replayMatch(players, events).score.for, 1);
  assert.equal(analysis(events).analytics.threats.FOR.total, 1);
  assert.equal(buildMatchMomentum(record("review-event", events)).actions.length, 1);
});

test("un evento estructural pendiente deja de alterar lineup según el replay canónico", () => {
  const substitution = createSubstitutionEvent({
    id: "sub", matchId: "review-event", position: { period: 1, minute: 5, order: 1 }, playerOutId: "a", playerInId: "e", now: 50,
  });
  let events = [lineup("review-event"), substitution];
  assert.deepEqual(replayMatch(players, events).onCourtPlayerIds, ["gk", "e", "b", "c", "d"]);
  events = editEvent(players, events, substitution.id, { reviewState: "PENDING_REVIEW" }, 60);
  assert.deepEqual(replayMatch(players, events).onCourtPlayerIds, ["gk", "a", "b", "c", "d"]);
  events = editEvent(players, events, substitution.id, { reviewState: null }, 70);
  assert.deepEqual(replayMatch(players, events).onCourtPlayerIds, ["gk", "e", "b", "c", "d"]);
});

test("tombstone y revisión persisten sin romper la referencia audiovisual", () => {
  const goal = createLiveThreatEvent({
    id: "linked-goal", matchId: "review-event", position: { period: 1, minute: 6, order: 1 },
    side: "FOR", playerId: "a", origin: { x: 0.8, y: 0.5 }, outcome: "GOL", phase: "POSITIONAL", assist: { status: "NONE" }, now: 60,
  });
  const override = { matchId: "review-event", eventId: goal.id, segmentId: "video", syncSegmentId: "video:P1", videoSecond: 123, status: "VERIFIED" as const, timeSource: "manual" as const, createdAt: 60, updatedAt: 60 };
  let session = { ...record("review-event", [lineup("review-event"), goal]).session, videoEventOverrides: [override] };
  session = { ...session, events: editEvent(players, session.events, goal.id, { reviewState: "PENDING_REVIEW" }, 70) };
  const storage = new MemoryStorage();
  assert.equal(saveMatchSession(session, storage).ok, true);
  const reopened = loadMatchSession("review-event", storage)!;
  assert.equal(reopened.events.find((event) => event.id === goal.id)?.reviewState, "PENDING_REVIEW");
  assert.deepEqual(reopened.videoEventOverrides, [override]);

  const deletedEvents = softDeleteEvent(players, editEvent(players, reopened.events, goal.id, { reviewState: null }, 80), goal.id, 90);
  assert.equal(deletedEvents.find((event) => event.id === goal.id)?.deletedAt, 90);
  assert.equal(replayMatch(players, deletedEvents).score.for, 0);
  assert.deepEqual(reopened.videoEventOverrides, [override], "el tombstone deportivo no purga metadata audiovisual");
});

test("Video Lab expone edición solo bajo canWrite, pendiente y tombstone sin un editor paralelo", () => {
  const source = readFileSync("src/app/partido/[id]/video-lab/page.tsx", "utf8");
  assert.match(source, /<EventEditor/);
  assert.match(source, /canWrite && <div[^>]*>[\s\S]*EDITAR EVENTO[\s\S]*MARCAR PENDIENTE[\s\S]*ELIMINAR EVENTO/);
  assert.match(source, /\? PENDIENTES/);
  assert.match(source, /setEventReviewPending/);
  assert.match(source, /softDeleteEvent/);
});

test("Video Sync V2 expone calibración, controles y aviso de jugada anterior", () => {
  const lab = readFileSync("src/app/partido/[id]/video-lab/page.tsx", "utf8");
  const live = readFileSync("src/app/partido/[id]/directo/page.tsx", "utf8");
  assert.match(lab, /CALIBRAR PERIODO AQUÍ/);
  assert.match(lab, /RECALIBRAR DESDE AQUÍ/);
  assert.match(lab, /SINCRONIZACIÓN COMPROBADA/);
  assert.match(lab, /JUGADA ANTERIOR/);
  assert.match(live, /REGISTRANDO JUGADA ANTERIOR/);
  assert.match(live, /videoTiming/);
});
