import assert from "node:assert/strict";
import test from "node:test";

import { createLineupInitializedEvent, createLiveThreatEvent } from "./matchEngine";
import { loadMatchSession, LocalStorageAdapter, saveMatchSession } from "./matchPersistence";
import {
  addVideoAnchor,
  buildYouTubeWatchAtUrl,
  createVideoSegment,
  isVideoTimeResolvable,
  parseVideoTimestamp,
  parseYouTubeVideoId,
  resolveEventVideoPosition,
  removeVideoAnchor,
  removeVideoEventOverride,
  removeVideoSegment,
  upsertVideoEventOverride,
  upsertVideoSegment,
  youtubeBaseUrl,
  videoEventTime,
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

test("prioriza observedAt y mantiene fallback compatible a createdAt en LIVE legacy", () => {
  const current = { ...event("observed", 120_000), observedAt: 100_000 } as MatchEvent;
  assert.deepEqual(videoEventTime(current), { timestamp: 100_000, source: "observedAt" });
  const legacy = { ...current } as MatchEvent;
  delete legacy.observedAt;
  assert.deepEqual(videoEventTime(legacy), { timestamp: 120_000, source: "createdAt" });
  assert.equal(videoEventTime({ ...legacy, provenance: "MANUAL_REVIEW" }), null);
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

test("anchor y override 432 con margen 6 abren la jugada desde 426", () => {
  const videoId = "ydQf4OF4bmE";
  const anchored = event("anchored-432", 100_000);
  const overridden = event("override-432", 110_000);
  let current = session([anchored, overridden]);
  current = upsertVideoSegment(current, createVideoSegment({ id: "chelva-p1", urlOrVideoId: videoId, periods: [1], leadSeconds: 6, now: 1 }));
  current = addVideoAnchor(current, "chelva-p1", { id: "anchor-432", eventId: anchored.id, videoSecond: 432 });
  const anchorResolution = resolveEventVideoPosition(current, anchored.id);
  assert.equal(anchorResolution.status, "RESOLVED");
  if (anchorResolution.status === "RESOLVED") {
    assert.equal(anchorResolution.estimatedSecond, 432);
    assert.equal(anchorResolution.openSecond, 426);
    assert.equal(anchorResolution.videoId, videoId);
    assert.equal(anchorResolution.url, `https://www.youtube.com/watch?v=${videoId}&t=426s`);
  }

  current = upsertVideoEventOverride(current, { eventId: overridden.id, segmentId: "chelva-p1", videoSecond: 432, now: 2 });
  const overrideResolution = resolveEventVideoPosition(current, overridden.id);
  assert.equal(overrideResolution.status, "RESOLVED");
  if (overrideResolution.status === "RESOLVED") {
    assert.equal(overrideResolution.estimatedSecond, 432);
    assert.equal(overrideResolution.openSecond, 426);
    assert.equal(overrideResolution.videoId, videoId);
    assert.equal(overrideResolution.url, `https://www.youtube.com/watch?v=${videoId}&t=426s`);
    assert.equal(buildYouTubeWatchAtUrl(overrideResolution.videoId, overrideResolution.openSecond), `https://www.youtube.com/watch?v=${videoId}&t=426s`);
  }
});

test("separa apertura precisa de jugada y apertura del vídeo base", () => {
  const videoId = "ydQf4OF4bmE";
  assert.equal(youtubeBaseUrl(videoId), `https://www.youtube.com/watch?v=${videoId}`);
  assert.equal(buildYouTubeWatchAtUrl(videoId, 426), `https://www.youtube.com/watch?v=${videoId}&t=426s`);
  assert.equal(buildYouTubeWatchAtUrl(videoId, -9), `https://www.youtube.com/watch?v=${videoId}&t=0s`);
  assert.doesNotMatch(youtubeBaseUrl(videoId), /start=|[?&]t=/);
});

test("anchor 432 con margen 6 comparte openSecond 426 entre player y YouTube externo", () => {
  const videoId = "ydQf4OF4bmE";
  const anchored = event("anchor-open-second", 100_000);
  let current = session([anchored]);
  current = upsertVideoSegment(current, createVideoSegment({ id: "chelva-p1", urlOrVideoId: videoId, periods: [1], leadSeconds: 6, now: 1 }));
  current = addVideoAnchor(current, "chelva-p1", { id: "anchor-432", eventId: anchored.id, videoSecond: 432 });

  const resolution = resolveEventVideoPosition(current, anchored.id);
  assert.equal(resolution.status, "RESOLVED");
  if (resolution.status === "RESOLVED") {
    assert.equal(resolution.openSecond, 426);
    assert.equal(resolution.url, `https://www.youtube.com/watch?v=${videoId}&t=426s`);
    assert.equal(buildYouTubeWatchAtUrl(resolution.videoId, resolution.openSecond), `https://www.youtube.com/watch?v=${videoId}&t=426s`);
  }
  assert.equal(buildYouTubeWatchAtUrl(videoId, current.videoSegments?.[0].anchors[0].videoSecond ?? -1), `https://www.youtube.com/watch?v=${videoId}&t=432s`);
  assert.equal(current.videoSegments?.[0].anchors[0].videoSecond, 432);
  assert.equal(current.videoSegments?.[0].leadSeconds, 6);
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

test("override 00:17 abre a 00:11 sin alterar anchors ni otro evento", () => {
  const events = [event("a", 100_000), event("late", 150_000)];
  let current = session(events);
  current = upsertVideoSegment(current, createVideoSegment({ id: "s1", urlOrVideoId: "abcdefghijk", periods: [1], leadSeconds: 6, now: 1 }));
  current = addVideoAnchor(current, "s1", { id: "anchor-a", eventId: "a", videoSecond: 20 });
  const automaticA = resolveEventVideoPosition(current, "a");
  const automaticLate = resolveEventVideoPosition(current, "late");
  const anchors = structuredClone(current.videoSegments?.[0].anchors);
  current = upsertVideoEventOverride(current, { eventId: "late", segmentId: "s1", videoSecond: 17, now: 2 });
  const manual = resolveEventVideoPosition(current, "late");
  assert.equal(manual.status, "RESOLVED");
  if (manual.status === "RESOLVED") {
    assert.equal(manual.quality, "MANUAL");
    assert.equal(manual.estimatedSecond, 17);
    assert.equal(manual.openSecond, 11);
    assert.equal(manual.url, "https://www.youtube.com/watch?v=abcdefghijk&t=11s");
  }
  assert.deepEqual(resolveEventVideoPosition(current, "a"), automaticA);
  assert.deepEqual(current.videoSegments?.[0].anchors, anchors);
  current = removeVideoEventOverride(current, "late");
  assert.deepEqual(resolveEventVideoPosition(current, "late"), automaticLate);
});

test("evento sin timestamp fiable se resuelve manualmente solo en su segmento", () => {
  const review = event("review", 0, 1, "MANUAL_REVIEW");
  let current = session([review]);
  current = upsertVideoSegment(current, createVideoSegment({ id: "p1", urlOrVideoId: "abcdefghijk", periods: [1], now: 1 }));
  current = upsertVideoSegment(current, createVideoSegment({ id: "p2", urlOrVideoId: "zyxwvutsrqp", periods: [2], now: 2 }));
  assert.equal(resolveEventVideoPosition(current, "review").status, "NO_POSITION");
  current = upsertVideoEventOverride(current, { eventId: "review", segmentId: "p1", videoSecond: 3, now: 3 });
  const result = resolveEventVideoPosition(current, "review");
  assert.equal(result.status, "RESOLVED");
  if (result.status === "RESOLVED") {
    assert.equal(result.segmentId, "p1");
    assert.equal(result.videoId, "abcdefghijk");
    assert.equal(result.openSecond, 0);
  }
  assert.throws(() => upsertVideoEventOverride(current, { eventId: "review", segmentId: "p2", videoSecond: 3 }), /parte cubierta/);
});

test("distingue sin vídeo, vídeo pendiente y evento sin posición fiable", () => {
  const live = event("live", 100_000);
  const review = event("review", 110_000, 1, "MANUAL_REVIEW");
  let current = session([live, review]);
  assert.deepEqual(resolveEventVideoPosition(current, "live"), { status: "NO_VIDEO" });
  current = upsertVideoSegment(current, createVideoSegment({ id: "s1", urlOrVideoId: "abcdefghijk", periods: [1], now: 1 }));
  const pending = resolveEventVideoPosition(current, "live");
  const unavailable = resolveEventVideoPosition(current, "review");
  assert.equal(pending.status, "PENDING_SYNC");
  assert.equal(unavailable.status, "NO_POSITION");
  assert.equal("url" in pending, false);
  assert.equal("url" in unavailable, false);
});

test("P1 y P2 no mezclan tiempos ni IDs entre segmentos independientes", () => {
  const events = [event("p1", 100_000, 1), event("p2", 200_000, 2)];
  let current = session(events);
  current = upsertVideoSegment(current, createVideoSegment({ id: "s1", urlOrVideoId: "abcdefghijk", periods: [1], now: 1 }));
  current = upsertVideoSegment(current, createVideoSegment({ id: "s2", urlOrVideoId: "zyxwvutsrqp", periods: [2], now: 2 }));
  current = addVideoAnchor(current, "s1", { id: "a1", eventId: "p1", videoSecond: 20 });
  current = addVideoAnchor(current, "s2", { id: "a2", eventId: "p2", videoSecond: 1300 });
  assert.equal(resolveEventVideoPosition(current, "p1").status, "RESOLVED");
  const p2 = resolveEventVideoPosition(current, "p2");
  assert.equal(p2.status, "RESOLVED");
  if (p2.status === "RESOLVED") {
    assert.equal(p2.estimatedSecond, 1300);
    assert.equal(p2.videoId, "zyxwvutsrqp");
    assert.match(p2.url, /^https:\/\/www\.youtube\.com\/watch\?v=zyxwvutsrqp&t=/);
  }
});

test("cambiar videoId limpia anchors para no conservar una calibración inválida", () => {
  const events = [event("a", 100_000)];
  let current = session(events);
  const original = createVideoSegment({ id: "s1", urlOrVideoId: "abcdefghijk", periods: [1], now: 1 });
  current = upsertVideoSegment(current, { ...original, anchors: [{ id: "a1", eventId: "a", videoSecond: 20 }] });
  current = upsertVideoSegment(current, { ...original, videoId: "zyxwvutsrqp", anchors: original.anchors, updatedAt: 2 });
  assert.deepEqual(current.videoSegments?.[0].anchors, []);
});

test("etiqueta humana se deriva de cobertura y sigue siendo editable", () => {
  assert.equal(createVideoSegment({ urlOrVideoId: "abcdefghijk", periods: [1], now: 1 }).label, "1ª parte");
  assert.equal(createVideoSegment({ urlOrVideoId: "abcdefghijk", periods: [2], now: 1 }).label, "2ª parte");
  assert.equal(createVideoSegment({ urlOrVideoId: "abcdefghijk", periods: [1, 2], now: 1 }).label, "Partido completo");
  assert.equal(createVideoSegment({ urlOrVideoId: "abcdefghijk", periods: [2], label: "P2 cámara grada", now: 1 }).label, "P2 cámara grada");
});

test("dos segmentos conservan identidad cobertura y anchors independientes", () => {
  const events = [event("p1", 100_000, 1), event("p2", 200_000, 2)];
  let current = session(events);
  current = upsertVideoSegment(current, createVideoSegment({ id: "p1-video", urlOrVideoId: "abcdefghijk", periods: [1], now: 1 }));
  current = upsertVideoSegment(current, createVideoSegment({ id: "p2-video", urlOrVideoId: "zyxwvutsrqp", periods: [2], now: 2 }));
  current = addVideoAnchor(current, "p1-video", { id: "p1-anchor", eventId: "p1", videoSecond: 30 });
  current = addVideoAnchor(current, "p2-video", { id: "p2-anchor", eventId: "p2", videoSecond: 40 });
  assert.equal(current.videoSegments?.length, 2);
  assert.equal(current.videoSegments?.[0].videoId, "abcdefghijk");
  assert.equal(current.videoSegments?.[0].anchors[0].eventId, "p1");
  assert.equal(current.videoSegments?.[1].videoId, "zyxwvutsrqp");
  assert.equal(current.videoSegments?.[1].anchors[0].eventId, "p2");
  const p1 = resolveEventVideoPosition(current, "p1");
  const p2 = resolveEventVideoPosition(current, "p2");
  assert.equal(p1.status, "RESOLVED");
  assert.equal(p2.status, "RESOLVED");
  if (p1.status === "RESOLVED") assert.equal(p1.videoId, "abcdefghijk");
  if (p2.status === "RESOLVED") assert.equal(p2.videoId, "zyxwvutsrqp");
});

test("un segmento completo resuelve eventos de ambas partes sin modificar eventos históricos", () => {
  const events = [event("p1", 100_000, 1), event("p2", 200_000, 2)];
  const originalEvents = structuredClone(events);
  let current = session(events);
  current = upsertVideoSegment(current, createVideoSegment({ id: "full", urlOrVideoId: "abcdefghijk", periods: [1, 2], now: 1 }));
  current = addVideoAnchor(current, "full", { id: "p1-anchor", eventId: "p1", videoSecond: 30 });
  current = addVideoAnchor(current, "full", { id: "p2-anchor", eventId: "p2", videoSecond: 1230 });
  assert.equal(resolveEventVideoPosition(current, "p1").status, "RESOLVED");
  assert.equal(resolveEventVideoPosition(current, "p2").status, "RESOLVED");
  assert.deepEqual(current.events.slice(1), originalEvents);
});

test("persistencia V3 conserva segmentos anchors y overrides y acepta sesiones sin vídeo", () => {
  const values = new Map<string, string>();
  const storage: LocalStorageAdapter = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  const events = [event("a", 100_000)];
  let current = session(events);
  current = upsertVideoSegment(current, createVideoSegment({ id: "s1", urlOrVideoId: "abcdefghijk", periods: [1, 2], now: 1 }));
  current = addVideoAnchor(current, "s1", { id: "a1", eventId: "a", videoSecond: 20 });
  current = upsertVideoEventOverride(current, { eventId: "a", segmentId: "s1", videoSecond: 17, now: 2 });
  assert.equal(saveMatchSession(current, storage, 10).ok, true);
  assert.deepEqual(loadMatchSession("m1", storage)?.videoSegments, current.videoSegments);
  assert.deepEqual(loadMatchSession("m1", storage)?.videoEventOverrides, current.videoEventOverrides);
  assert.equal(saveMatchSession({ ...current, videoSegments: undefined }, storage, 11).ok, true);
  assert.deepEqual(loadMatchSession("m1", storage)?.videoSegments, []);
});

test("editar lead y borrar anchor o segmento conserva eventos y limpia metadata dependiente", () => {
  const sourceEvents = [event("video-event", 100_000)];
  const immutableEvents = structuredClone(sourceEvents);
  let current = session(sourceEvents);
  const segment = createVideoSegment({ id: "editable-video", urlOrVideoId: "abcdefghijk", periods: [1], leadSeconds: 6, now: 1 });
  current = upsertVideoSegment(current, segment);
  current = addVideoAnchor(current, segment.id, { id: "anchor", eventId: "video-event", videoSecond: 432 });
  current = upsertVideoEventOverride(current, { eventId: "video-event", segmentId: segment.id, videoSecond: 432, now: 2 });
  current = upsertVideoSegment(current, { ...current.videoSegments![0], leadSeconds: 9, updatedAt: 3 });
  const adjusted = resolveEventVideoPosition(current, "video-event");
  assert.equal(adjusted.status, "RESOLVED");
  if (adjusted.status === "RESOLVED") assert.equal(adjusted.openSecond, 423);

  current = removeVideoAnchor(current, segment.id, "anchor");
  assert.equal(current.videoSegments?.[0].anchors.length, 0);
  assert.equal(current.videoEventOverrides?.length, 1, "quitar el anchor no borra el ajuste manual independiente");
  current = removeVideoSegment(current, segment.id);
  assert.deepEqual(current.videoSegments, []);
  assert.deepEqual(current.videoEventOverrides, []);
  assert.deepEqual(current.events.slice(1), immutableEvents);
});
