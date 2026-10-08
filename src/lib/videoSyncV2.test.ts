import assert from "node:assert/strict";
import test from "node:test";

import { createLineupInitializedEvent, createLiveThreatEvent, replayMatch } from "./matchEngine";
import {
  buildVideoLabSyncAudit,
  buildVideoLabSyncSegments,
  buildVideoLabTimeline,
  calibrateVideoLabFromEvent,
  confirmVideoLabControl,
  persistVideoLabVerification,
} from "./videoLab";
import {
  resolveAutomaticEventVideoPosition,
  resolveEventVideoPosition,
  upsertVideoCalibration,
  upsertVideoEventOverride,
  videoEventTime,
} from "./videoIndex";
import { MatchEvent, MatchSession, MatchVideoSegment } from "../types";

const players = Array.from({ length: 5 }, (_, index) => ({ id: `p${index + 1}`, name: `P${index + 1}`, number: index + 1 }));

function action(id: string, period: 1 | 2, minute: number, order: number, observedAt: number, extra: Partial<MatchEvent> = {}): MatchEvent {
  return { ...createLiveThreatEvent({
    id, matchId: "sync-v2", position: { period, minute, order }, side: "FOR", playerId: "p2",
    origin: { x: 0.5, y: 0.5 }, outcome: "PARADA", phase: "POSITIONAL", provenance: "LIVE",
    observedAt, now: observedAt + 4_000,
  }), ...extra } as MatchEvent;
}

function segment(id: string, periods: Array<1 | 2>, anchors: MatchVideoSegment["anchors"] = []): MatchVideoSegment {
  return { id, provider: "YOUTUBE", videoId: id === "p2" ? "zyxwvutsrqp" : "abcdefghijk", label: id, periods, leadSeconds: 6, anchors, createdAt: 1, updatedAt: 1 };
}

function session(events: MatchEvent[], segments: MatchVideoSegment[]): MatchSession {
  return { matchId: "sync-v2", players, staff: [], period: 2, minute: 20, periodMinutes: { 1: 20, 2: 20 }, closedPeriods: [], periodCloseSnapshots: {}, matchFinished: true, events, videoSegments: segments, past: [], future: [], lastError: null, persistenceStatus: "saved", lastSavedAt: 1 };
}

function calibration(current: MatchSession, eventId: string, segmentId: string, period: 1 | 2, videoSecond: number, kind: "INITIAL" | "RECALIBRATION", now = 1): MatchSession {
  return upsertVideoCalibration(current, { id: `${kind}-${eventId}`, segmentId, syncSegmentId: `${segmentId}:P${period}`, period, eventId, videoSecond, kind, now });
}

test("vídeo continuo: tiempo muerto, mopa o lesión no cambian el offset", () => {
  const events = [action("start", 1, 1, 1, 10_000), action("after-timeout", 1, 5, 1, 70_000), action("after-mop", 1, 9, 1, 130_000)];
  const current = session(events, [segment("full", [1], [{ id: "a", eventId: "start", videoSecond: 100 }])]);
  assert.equal(resolveAutomaticEventVideoPosition(current, "after-timeout")?.estimatedSecond, 160);
  assert.equal(resolveAutomaticEventVideoPosition(current, "after-mop")?.estimatedSecond, 220);
});

test("calibración inicial crea AUTO canónico y lead solo afecta a la apertura", () => {
  let current = session([action("a", 1, 1, 1, 10_000), action("b", 1, 4, 1, 30_000)], [segment("full", [1])]);
  current = calibration(current, "a", "full", 1, 100, "INITIAL");
  const auto = resolveAutomaticEventVideoPosition(current, "b")!;
  assert.equal(auto.estimatedSecond, 120);
  assert.equal(auto.openSecond, 114);
});

test("recalibrar desde un evento conserva anteriores y cambia AUTO posteriores", () => {
  const events = [action("a", 1, 1, 1, 10_000), action("b", 1, 5, 1, 20_000), action("c", 1, 8, 1, 30_000)];
  let current = calibration(session(events, [segment("full", [1])]), "a", "full", 1, 100, "INITIAL");
  assert.equal(resolveAutomaticEventVideoPosition(current, "c")?.estimatedSecond, 120);
  current = calibration(current, "b", "full", 1, 250, "RECALIBRATION", 2);
  assert.equal(resolveAutomaticEventVideoPosition(current, "a")?.estimatedSecond, 100);
  assert.equal(resolveAutomaticEventVideoPosition(current, "b")?.estimatedSecond, 250);
  assert.equal(resolveAutomaticEventVideoPosition(current, "c")?.estimatedSecond, 260);
});

test("una recalibración nunca mueve overrides VERIFIED anteriores o posteriores", () => {
  const events = [action("a", 1, 1, 1, 10_000), action("b", 1, 5, 1, 20_000), action("c", 1, 8, 1, 30_000)];
  let current = calibration(session(events, [segment("full", [1])]), "a", "full", 1, 100, "INITIAL");
  current = upsertVideoEventOverride(current, { eventId: "a", segmentId: "full", syncSegmentId: "full:P1", videoSecond: 101, now: 1 });
  current = upsertVideoEventOverride(current, { eventId: "c", segmentId: "full", syncSegmentId: "full:P1", videoSecond: 333, now: 1 });
  current = calibration(current, "b", "full", 1, 250, "RECALIBRATION", 2);
  const before = resolveEventVideoPosition(current, "a");
  const after = resolveEventVideoPosition(current, "c");
  assert.equal(before.status === "RESOLVED" && before.estimatedSecond, 101);
  assert.equal(after.status === "RESOLVED" && after.estimatedSecond, 333);
});

test("JUGADA ANTERIOR sigue en replay pero no aporta timestamp AUTO", () => {
  const lineup = createLineupInitializedEvent({ id: "lineup", matchId: "sync-v2", position: { period: 1, minute: 0, order: 1 }, squadPlayerIds: players.map((player) => player.id), onCourtPlayerIds: players.map((player) => player.id), goalkeeperPlayerId: "p1", observedAt: 1_000, now: 1_000 });
  const late = action("late", 1, 6, 1, 50_000, { videoTiming: "RETROSPECTIVE" });
  const current = session([lineup, late], [segment("full", [1], [{ id: "a", eventId: "lineup", videoSecond: 10 }])]);
  assert.equal(replayMatch(players, current.events).timeline.some((entry) => entry.event.id === "late"), true);
  assert.equal(videoEventTime(late), null);
  assert.equal(resolveEventVideoPosition(current, "late").status, "NO_POSITION");
});

test("JUGADA ANTERIOR con ACCIÓN AQUÍ obtiene posición VERIFIED", () => {
  const late = action("late", 1, 6, 1, 50_000, { videoTiming: "RETROSPECTIVE" });
  const current = upsertVideoEventOverride(session([late], [segment("full", [1])]), { eventId: "late", segmentId: "full", syncSegmentId: "full:P1", videoSecond: 222, timeSource: "manual", now: 1 });
  const resolved = resolveEventVideoPosition(current, "late");
  assert.equal(resolved.status, "RESOLVED");
  if (resolved.status === "RESOLVED") assert.equal(resolved.estimatedSecond, 222);
});

test("un vídeo completo mantiene offsets independientes para P1 y P2", () => {
  const events = [action("p1a", 1, 1, 1, 10_000), action("p1b", 1, 2, 1, 20_000), action("p2a", 2, 1, 1, 1_000_000), action("p2b", 2, 2, 1, 1_010_000)];
  let current = session(events, [segment("full", [1, 2])]);
  current = calibration(current, "p1a", "full", 1, 100, "INITIAL");
  current = calibration(current, "p2a", "full", 2, 1_300, "INITIAL");
  assert.equal(resolveAutomaticEventVideoPosition(current, "p1b")?.estimatedSecond, 110);
  assert.equal(resolveAutomaticEventVideoPosition(current, "p2b")?.estimatedSecond, 1_310);
});

test("dos vídeos mantienen P1 y P2 independientes", () => {
  const events = [action("p1", 1, 1, 1, 10_000), action("p2", 2, 1, 1, 1_000_000)];
  let current = session(events, [segment("p1", [1]), segment("p2", [2])]);
  current = calibration(current, "p1", "p1", 1, 100, "INITIAL");
  current = calibration(current, "p2", "p2", 2, 50, "INITIAL");
  assert.equal(resolveAutomaticEventVideoPosition(current, "p1")?.segment.id, "p1");
  assert.equal(resolveAutomaticEventVideoPosition(current, "p2")?.segment.id, "p2");
});

test("anchors legacy siguen funcionando y no se convierten en recalibraciones", () => {
  const events = [action("a", 1, 1, 1, 10_000), action("b", 1, 5, 1, 20_000), action("c", 1, 9, 1, 30_000)];
  const current = session(events, [segment("full", [1], [{ id: "first", eventId: "a", videoSecond: 100 }, { id: "later", eventId: "b", videoSecond: 500 }])]);
  assert.equal(resolveAutomaticEventVideoPosition(current, "c")?.estimatedSecond, 120);
});

test("Video Lab, Biblioteca y VER JUGADA comparten el resolver canónico", () => {
  const events = [action("a", 1, 1, 1, 10_000), action("b", 1, 5, 1, 30_000)];
  const current = calibration(session(events, [segment("full", [1])]), "a", "full", 1, 100, "INITIAL");
  const lab = buildVideoLabTimeline(current).find((row) => row.event.id === "b")!;
  const general = resolveEventVideoPosition(current, "b");
  assert.equal(general.status, "RESOLVED");
  if (general.status === "RESOLVED") assert.equal(lab.estimatedSecond, general.estimatedSecond);
});

test("controles se distribuyen por tiempo y excluyen eventos no fiables", () => {
  const events = [
    action("start", 1, 1, 1, 10_000), action("middle", 1, 5, 1, 50_000),
    action("late-input", 1, 7, 1, 70_000, { videoTiming: "RETROSPECTIVE" }),
    action("pending", 1, 8, 1, 80_000, { reviewState: "PENDING_REVIEW" }),
    action("end", 1, 10, 1, 100_000),
  ];
  const current = calibration(session(events, [segment("full", [1])]), "start", "full", 1, 100, "INITIAL");
  const audit = buildVideoLabSyncAudit(current, buildVideoLabSyncSegments(current)[0]);
  assert.deepEqual(audit.controlEventIds, ["middle", "end"]);
});

test("calibración + dos controles produce COMPROBADA y una recalibración la invalida", () => {
  const events = [action("start", 1, 1, 1, 10_000), action("middle", 1, 5, 1, 50_000), action("end", 1, 10, 1, 100_000)];
  let current = calibration(session(events, [segment("full", [1])]), "start", "full", 1, 100, "INITIAL");
  const syncSegment = buildVideoLabSyncSegments(current)[0];
  for (const eventId of ["middle", "end"]) {
    const row = buildVideoLabTimeline(current).find((item) => item.event.id === eventId)!;
    current = confirmVideoLabControl(current, row, { id: `check-${eventId}`, now: 2 });
  }
  assert.equal(buildVideoLabSyncAudit(current, syncSegment).checked, true);
  current = calibration(current, "middle", "full", 1, 250, "RECALIBRATION", 3);
  assert.equal(buildVideoLabSyncAudit(current, syncSegment).checked, false);
});

test("ACCIÓN AQUÍ individual no crea calibración ni desplaza otras AUTO", () => {
  const events = [action("a", 1, 1, 1, 10_000), action("b", 1, 5, 1, 20_000), action("c", 1, 9, 1, 30_000)];
  let current = calibration(session(events, [segment("full", [1])]), "a", "full", 1, 100, "INITIAL");
  const before = resolveAutomaticEventVideoPosition(current, "c")?.estimatedSecond;
  const row = buildVideoLabTimeline(current).find((item) => item.event.id === "b")!;
  current = persistVideoLabVerification(current, row, { videoSecond: 999, timeSource: "manual", now: 2 });
  assert.equal(resolveAutomaticEventVideoPosition(current, "c")?.estimatedSecond, before);
  assert.equal(current.videoCalibrations?.length, 1);
});

test("calibración desde Video Lab persiste VERIFIED sin tocar timestamps deportivos", () => {
  const events = [action("a", 1, 1, 1, 10_000)];
  const original = session(events, [segment("full", [1])]);
  const row = buildVideoLabTimeline(original)[0];
  const next = calibrateVideoLabFromEvent(original, row, 100, "INITIAL", { id: "cal", now: 2 });
  assert.deepEqual(next.events, original.events);
  assert.equal(next.videoEventOverrides?.[0].status, "VERIFIED");
  assert.equal(next.videoCalibrations?.[0].kind, "INITIAL");
});
