import assert from "node:assert/strict";
import test from "node:test";

import { createLineupInitializedEvent, createLiveThreatEvent } from "./matchEngine";
import { loadMatchSession, LocalStorageAdapter, saveMatchSession } from "./matchPersistence";
import {
  addVideoAnchor,
  createVideoSegment,
  isVideoTimeResolvable,
  parseVideoTimestamp,
  parseYouTubeVideoId,
  resolveEventVideoPosition,
  upsertVideoSegment,
} from "./videoIndex";
import { MatchEvent, MatchSession } from "../types";

const players = Array.from({ length: 5 }, (_, index) => ({ id: `p${index + 1}`, name: `Jugador ${index + 1}`, number: index + 1 }));

function event(id: string, createdAt: number, period = 1, provenance: MatchEvent["provenance"] = "LIVE"): MatchEvent {
  return createLiveThreatEvent({
    id,
    matchId: "m1",
    position: { period, minute: 5, order: 1 },
    side: "FOR",
    playerId: "p1",
    origin: { x: 0.5, y: 0.5 },
    outcome: "PARADA",
    phase: "POSITIONAL",
    provenance,
    now: createdAt,
  });
}

function session(events: MatchEvent[]): MatchSession {
  const lineup = createLineupInitializedEvent({ id: "lineup", matchId: "m1", position: { period: 1, minute: 0, order: 1 }, squadPlayerIds: players.map((item) => item.id), onCourtPlayerIds: players.map((item) => item.id), goalkeeperPlayerId: "p1", now: 1 });
  return { matchId: "m1", players, staff: [], period: 2, minute: 20, periodMinutes: { 1: 20, 2: 20 }, closedPeriods: [1, 2], matchFinished: true, events: [lineup, ...events], past: [], future: [], lastError: null, persistenceStatus: "saved", lastSavedAt: 1 };
}

test("extrae IDs de las variantes admitidas de YouTube e ignora t", () => {
  const id = "abcdefghijk";
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${id}&t=99s`), id);
  assert.equal(parseYouTubeVideoId(`https://youtu.be/${id}?t=8`), id);
  assert.equal(parseYouTubeVideoId(`https://youtube.com/shorts/${id}`), id);
  assert.equal(parseYouTubeVideoId(`https://youtube.com/embed/${id}`), id);
  assert.equal(parseYouTubeVideoId(`https://youtube.com/live/${id}`), id);
  assert.equal(parseYouTubeVideoId("https://example.com/watch?v=abcdefghijk"), null);
});

test("convierte timestamps sin aceptar segundos o minutos inválidos", () => {
  assert.equal(parseVideoTimestamp("0:11"), 11);
  assert.equal(parseVideoTimestamp("08:47"), 527);
  assert.equal(parseVideoTimestamp("20:39"), 1239);
  assert.equal(parseVideoTimestamp("1:02:15"), 3735);
  assert.equal(parseVideoTimestamp("8:60"), null);
  assert.equal(parseVideoTimestamp("NaN"), null);
});

test("solo LIVE conserva un instante utilizable, incluso tras editar updatedAt", () => {
  const live = { ...event("live", 100_000), updatedAt: 999_999 } as MatchEvent;
  assert.equal(isVideoTimeResolvable(live), true);
  assert.equal(isVideoTimeResolvable(event("review", 100_000, 1, "MANUAL_REVIEW")), false);
  assert.equal(isVideoTimeResolvable({ ...live, provenance: undefined }), false);
});

test("un anchor resuelve la posición con margen y nunca guarda URL en el evento", () => {
  const events = [event("a", 100_000), event("b", 112_400)];
  let current = session(events);
  current = upsertVideoSegment(current, createVideoSegment({ id: "s1", urlOrVideoId: "abcdefghijk", periods: [1], leadSeconds: 6, now: 1 }));
  current = addVideoAnchor(current, "s1", { id: "anchor-a", eventId: "a", videoSecond: 50 });
  const result = resolveEventVideoPosition(current, "b");
  assert.equal(result.status, "RESOLVED");
  if (result.status === "RESOLVED") {
    assert.equal(result.estimatedSecond, 62);
    assert.equal(result.openSecond, 56);
    assert.equal(result.url, "https://www.youtube.com/watch?v=abcdefghijk&t=56s");
    assert.equal(result.quality, "SINGLE_ANCHOR");
  }
  assert.equal("videoUrl" in current.events[1], false);
});

test("varios anchors usan mediana robusta y avisan si discrepan", () => {
  const events = [event("a", 100_000), event("b", 110_000), event("c", 120_000), event("target", 115_000)];
  let current = session(events);
  current = upsertVideoSegment(current, createVideoSegment({ id: "s1", urlOrVideoId: "abcdefghijk", periods: [1], now: 1 }));
  current = addVideoAnchor(current, "s1", { id: "aa", eventId: "a", videoSecond: 40 });
  current = addVideoAnchor(current, "s1", { id: "ab", eventId: "b", videoSecond: 50 });
  current = addVideoAnchor(current, "s1", { id: "ac", eventId: "c", videoSecond: 90 });
  const result = resolveEventVideoPosition(current, "target");
  assert.equal(result.status, "RESOLVED");
  if (result.status === "RESOLVED") {
    assert.equal(result.estimatedSecond, 55);
    assert.equal(result.quality, "MULTI_ANCHOR_WARNING");
    assert.equal(result.anchorSpreadSeconds, 30);
  }
});

test("distingue sin vídeo, vídeo pendiente y evento sin posición fiable", () => {
  const live = event("live", 100_000);
  const review = event("review", 110_000, 1, "MANUAL_REVIEW");
  let current = session([live, review]);
  assert.deepEqual(resolveEventVideoPosition(current, "live"), { status: "NO_VIDEO" });
  current = upsertVideoSegment(current, createVideoSegment({ id: "s1", urlOrVideoId: "abcdefghijk", periods: [1], now: 1 }));
  assert.equal(resolveEventVideoPosition(current, "live").status, "PENDING_SYNC");
  assert.equal(resolveEventVideoPosition(current, "review").status, "NO_POSITION");
});

test("P1 y P2 pueden apuntar al mismo vídeo mediante segmentos lógicos independientes", () => {
  const events = [event("p1", 100_000, 1), event("p2", 200_000, 2)];
  let current = session(events);
  current = upsertVideoSegment(current, createVideoSegment({ id: "s1", urlOrVideoId: "abcdefghijk", periods: [1], now: 1 }));
  current = upsertVideoSegment(current, createVideoSegment({ id: "s2", urlOrVideoId: "abcdefghijk", periods: [2], now: 2 }));
  current = addVideoAnchor(current, "s1", { id: "a1", eventId: "p1", videoSecond: 20 });
  current = addVideoAnchor(current, "s2", { id: "a2", eventId: "p2", videoSecond: 1300 });
  assert.equal(resolveEventVideoPosition(current, "p1").status, "RESOLVED");
  const p2 = resolveEventVideoPosition(current, "p2");
  assert.equal(p2.status, "RESOLVED");
  if (p2.status === "RESOLVED") assert.equal(p2.estimatedSecond, 1300);
});

test("cambiar videoId limpia anchors para no conservar una calibración inválida", () => {
  const events = [event("a", 100_000)];
  let current = session(events);
  const original = createVideoSegment({ id: "s1", urlOrVideoId: "abcdefghijk", periods: [1], now: 1 });
  current = upsertVideoSegment(current, { ...original, anchors: [{ id: "a1", eventId: "a", videoSecond: 20 }] });
  current = upsertVideoSegment(current, { ...original, videoId: "zyxwvutsrqp", anchors: original.anchors, updatedAt: 2 });
  assert.deepEqual(current.videoSegments?.[0].anchors, []);
});

test("persistencia V3 conserva segmentos y anchors y acepta sesiones sin vídeo", () => {
  const values = new Map<string, string>();
  const storage: LocalStorageAdapter = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  const events = [event("a", 100_000)];
  let current = session(events);
  current = upsertVideoSegment(current, createVideoSegment({ id: "s1", urlOrVideoId: "abcdefghijk", periods: [1, 2], now: 1 }));
  current = addVideoAnchor(current, "s1", { id: "a1", eventId: "a", videoSecond: 20 });
  assert.equal(saveMatchSession(current, storage, 10).ok, true);
  assert.deepEqual(loadMatchSession("m1", storage)?.videoSegments, current.videoSegments);
  assert.equal(saveMatchSession({ ...current, videoSegments: undefined }, storage, 11).ok, true);
  assert.deepEqual(loadMatchSession("m1", storage)?.videoSegments, []);
});
