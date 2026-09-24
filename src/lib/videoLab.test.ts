import assert from "node:assert/strict";
import test from "node:test";

import {
  createLineupInitializedEvent,
  createLiveThreatEvent,
  createSubstitutionEvent,
} from "./matchEngine";
import { reduceLiveInteraction } from "./liveInteraction";
import {
  buildVideoLabSyncSegments,
  buildVideoLabTimeline,
  currentVideoLabRow,
  isVideoLabClipEligible,
  proposeVideoSportsInsertion,
  shiftVideoSecond,
  verifyVideoLabEvent,
  videoLabSeekSecond,
} from "./videoLab";
import { MatchEvent, MatchSession, MatchVideoSegment } from "../types";

const players = Array.from({ length: 6 }, (_, index) => ({ id: `p${index + 1}`, name: `Jugador ${index + 1}`, number: index + 1 }));

function threat(id: string, period: number, minute: number, order: number, observedAt: number): MatchEvent {
  return createLiveThreatEvent({
    id,
    matchId: "video-lab",
    position: { period, minute, order },
    side: "FOR",
    playerId: "p2",
    origin: { x: 0.5, y: 0.5 },
    outcome: "PARADA",
    phase: "POSITIONAL",
    provenance: "LIVE",
    observedAt,
    now: observedAt + 4_000,
  });
}

function video(id: string, videoId: string, periods: Array<1 | 2>, anchors: MatchVideoSegment["anchors"]): MatchVideoSegment {
  return { id, provider: "YOUTUBE", videoId, label: id, periods, leadSeconds: 6, anchors, createdAt: 1, updatedAt: 1 };
}

function buildSession(segments: MatchVideoSegment[]): MatchSession {
  const lineup = createLineupInitializedEvent({ id: "lineup", matchId: "video-lab", position: { period: 1, minute: 0, order: 1 }, squadPlayerIds: players.map((player) => player.id), onCourtPlayerIds: ["p1", "p2", "p3", "p4", "p5"], goalkeeperPlayerId: "p1", provenance: "LIVE", observedAt: 1_000, now: 1_100 });
  const p1 = threat("p1-shot", 1, 4, 1, 10_000);
  const substitution = createSubstitutionEvent({ id: "change", matchId: "video-lab", position: { period: 1, minute: 10, order: 1 }, playerOutId: "p2", playerInId: "p6", provenance: "LIVE", observedAt: 20_000, now: 24_000 });
  const p1Later = { ...threat("p1-later", 1, 12, 1, 30_000), playerId: "p6" } as MatchEvent;
  const p2 = threat("p2-shot", 2, 3, 1, 1_000_000);
  return { matchId: "video-lab", players, staff: [], period: 2, minute: 20, periodMinutes: { 1: 20, 2: 20 }, events: [lineup, p1, substitution, p1Later, p2], videoSegments: segments, past: [], future: [], lastError: null, persistenceStatus: "saved", lastSavedAt: 1 };
}

test("la primera pulsación se conserva como observedAt aunque la captura termine después", () => {
  const selected = reduceLiveInteraction({ kind: "IDLE" }, { type: "COURT_PLAYER_TAPPED", playerId: "p2", observedAt: 1_000 });
  const origin = reduceLiveInteraction(selected.state, { type: "COURT_TAPPED", origin: { x: 0.4, y: 0.4 }, eventId: "e1", observedAt: 5_000 });
  const outcome = reduceLiveInteraction(origin.state, { type: "OUTCOME_SELECTED", outcome: "FUERA" });
  const completed = reduceLiveInteraction(outcome.state, { type: "PHASE_SELECTED", phase: "POSITIONAL" });
  assert.equal(completed.effect?.type, "RECORD_THREAT");
  assert.equal(completed.effect?.observedAt, 1_000);

  const sub = reduceLiveInteraction(selected.state, { type: "BENCH_PLAYER_TAPPED", playerId: "p6", observedAt: 9_000 });
  assert.equal(sub.effect?.type, "RECORD_SUBSTITUTION");
  assert.equal(sub.effect?.observedAt, 1_000);
});

test("dos URLs producen segmentos P1/P2 independientes", () => {
  const session = buildSession([
    video("first", "abcdefghijk", [1], [{ id: "a1", eventId: "p1-shot", videoSecond: 100 }]),
    video("second", "zyxwvutsrqp", [2], [{ id: "a2", eventId: "p2-shot", videoSecond: 50 }]),
  ]);
  const segments = buildVideoLabSyncSegments(session);
  assert.deepEqual(segments.map(({ period, videoId }) => ({ period, videoId })), [{ period: 1, videoId: "abcdefghijk" }, { period: 2, videoId: "zyxwvutsrqp" }]);
  const rows = buildVideoLabTimeline(session);
  assert.equal(rows.find((row) => row.event.id === "p1-shot")?.estimatedSecond, 100);
  assert.equal(rows.find((row) => row.event.id === "p2-shot")?.estimatedSecond, 50);
});

test("una URL compartida mantiene calibraciones independientes para P1 y P2", () => {
  const shared = video("full", "abcdefghijk", [1, 2], [
    { id: "a1", eventId: "p1-shot", videoSecond: 100 },
    { id: "a2", eventId: "p2-shot", videoSecond: 1_300 },
  ]);
  const session = buildSession([shared]);
  const segments = buildVideoLabSyncSegments(session);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].videoId, segments[1].videoId);
  assert.deepEqual(segments.map((segment) => segment.anchors.map((anchor) => anchor.id)), [["a1"], ["a2"]]);
  const rows = buildVideoLabTimeline(session);
  assert.equal(rows.find((row) => row.event.id === "p1-shot")?.estimatedSecond, 100);
  assert.equal(rows.find((row) => row.event.id === "p2-shot")?.estimatedSecond, 1_300);
});

test("un segundo anchor diagnostica deriva sin reemplazar el anchor primario por mediana", () => {
  const session = buildSession([video("first", "abcdefghijk", [1], [
    { id: "primary", eventId: "p1-shot", videoSecond: 100 },
    { id: "diagnostic", eventId: "p1-later", videoSecond: 300 },
  ])]);
  const row = buildVideoLabTimeline(session).find((candidate) => candidate.event.id === "change")!;
  assert.equal(row.estimatedSecond, 110);
  assert.equal(row.diagnostic.status, "DRIFT_WARNING");
  assert.equal(row.diagnostic.spreadSeconds, 180);
});

test("sustitución es hito visible pero nunca clip y conserva contexto de jugadores", () => {
  const session = buildSession([video("first", "abcdefghijk", [1], [{ id: "a1", eventId: "p1-shot", videoSecond: 100 }])]);
  const row = buildVideoLabTimeline(session).find((candidate) => candidate.event.id === "change")!;
  assert.equal(row.temporalFamily, "LANDMARK");
  assert.equal(row.clipEligible, false);
  assert.equal(isVideoLabClipEligible(row.event), false);
  const before = proposeVideoSportsInsertion(session, "change", "BEFORE")!;
  const after = proposeVideoSportsInsertion(session, "change", "AFTER")!;
  assert.equal(before.provenance, "VIDEO");
  assert.equal(before.onCourtPlayerIds.includes("p2"), true);
  assert.equal(before.onCourtPlayerIds.includes("p6"), false);
  assert.equal(after.onCourtPlayerIds.includes("p2"), false);
  assert.equal(after.onCourtPlayerIds.includes("p6"), true);
});

test("AUTO pasa a VERIFIED y selección usa ventana con lead de seis segundos", () => {
  const session = buildSession([video("first", "abcdefghijk", [1], [{ id: "a1", eventId: "p1-shot", videoSecond: 100 }])]);
  const automatic = buildVideoLabTimeline(session).find((row) => row.event.id === "p1-later")!;
  assert.equal(automatic.status, "AUTO");
  assert.equal(automatic.estimatedSecond, 120);
  assert.equal(videoLabSeekSecond(automatic), 114);
  const verifications = verifyVideoLabEvent({}, automatic, 123);
  const verified = buildVideoLabTimeline(session, verifications).find((row) => row.event.id === "p1-later")!;
  assert.equal(verified.status, "VERIFIED");
  assert.equal(verified.estimatedSecond, 123);
  assert.equal(verified.openSecond, 117);
});

test("controles temporales hacen clamp y el seguimiento elige el último hito pasado", () => {
  assert.equal(shiftVideoSecond(2, -5), 0);
  assert.equal(shiftVideoSecond(20, -1), 19);
  assert.equal(shiftVideoSecond(20, 1), 21);
  assert.equal(shiftVideoSecond(20, 5), 25);
  const session = buildSession([video("first", "abcdefghijk", [1], [{ id: "a1", eventId: "p1-shot", videoSecond: 100 }])]);
  const rows = buildVideoLabTimeline(session);
  assert.equal(currentVideoLabRow(rows, "first:P1", 111)?.event.id, "change");
});
