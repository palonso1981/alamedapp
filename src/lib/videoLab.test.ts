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
  createVideoAnalysisClip,
  createVideoSportsInsertion,
  defaultVideoClipWindow,
  hasVideoLabAvailable,
  isVideoLabClipEligible,
  nextVideoLabRow,
  persistVideoLabVerification,
  proposeVideoSportsInsertion,
  shiftVideoSecond,
  videoClipTagSuggestions,
  verifyVideoLabEvent,
  videoLabSeekSecond,
} from "./videoLab";
import { loadMatchSession, LocalStorageAdapter, saveMatchSession } from "./matchPersistence";
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
  return { matchId: "video-lab", players, staff: [], period: 2, minute: 20, periodMinutes: { 1: 20, 2: 20 }, closedPeriods: [], periodCloseSnapshots: {}, matchFinished: false, events: [lineup, p1, substitution, p1Later, p2], videoSegments: segments, past: [], future: [], lastError: null, persistenceStatus: "saved", lastSavedAt: 1 };
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

test("Video Lab solo se ofrece cuando existe un YouTube configurado", () => {
  assert.equal(hasVideoLabAvailable(buildSession([])), false);
  assert.equal(hasVideoLabAvailable(buildSession([video("first", "abcdefghijk", [1], [])])), true);
  assert.equal(hasVideoLabAvailable({ ...buildSession([]), videoSegments: [video("empty", "", [1], [])] }), false);
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

test("CORRECTA persiste VERIFIED con fuente automática sin modificar MatchEvent ni observedAt", () => {
  const original = buildSession([video("first", "abcdefghijk", [1], [{ id: "a1", eventId: "p1-shot", videoSecond: 100 }])]);
  const immutableEvents = structuredClone(original.events);
  const automatic = buildVideoLabTimeline(original).find((row) => row.event.id === "p1-later")!;
  assert.equal(automatic.timeSource, "observedAt");
  const verified = persistVideoLabVerification(original, automatic, { now: 100 });
  assert.deepEqual(verified.events, immutableEvents);
  assert.equal(verified.events.find((event) => event.id === "p1-later")?.observedAt, 30_000);
  assert.deepEqual(verified.videoEventOverrides, [{
    matchId: "video-lab",
    eventId: "p1-later",
    segmentId: "first",
    syncSegmentId: "first:P1",
    videoSecond: 120,
    status: "VERIFIED",
    timeSource: "observedAt",
    createdAt: 100,
    updatedAt: 100,
  }]);
  assert.equal(buildVideoLabTimeline(verified).find((row) => row.event.id === "p1-later")?.status, "VERIFIED");
});

test("ACCIÓN AQUÍ persiste el segundo manual y corrige sin duplicar", () => {
  const original = buildSession([video("first", "abcdefghijk", [1], [{ id: "a1", eventId: "p1-shot", videoSecond: 100 }])]);
  const row = buildVideoLabTimeline(original).find((candidate) => candidate.event.id === "p1-later")!;
  const first = persistVideoLabVerification(original, row, { videoSecond: 123, timeSource: "manual", now: 100 });
  const correctedRow = buildVideoLabTimeline(first).find((candidate) => candidate.event.id === "p1-later")!;
  const corrected = persistVideoLabVerification(first, correctedRow, { videoSecond: 127, timeSource: "manual", now: 200 });
  assert.equal(corrected.videoEventOverrides?.length, 1);
  assert.equal(corrected.videoEventOverrides?.[0].videoSecond, 127);
  assert.equal(corrected.videoEventOverrides?.[0].createdAt, 100);
  assert.equal(corrected.videoEventOverrides?.[0].updatedAt, 200);
});

test("reload conserva VERIFIED y dos periodos del mismo vídeo usan syncSegmentId distinto", () => {
  const shared = video("full", "abcdefghijk", [1, 2], [
    { id: "a1", eventId: "p1-shot", videoSecond: 100 },
    { id: "a2", eventId: "p2-shot", videoSecond: 1_300 },
  ]);
  let current = buildSession([shared]);
  const initialRows = buildVideoLabTimeline(current);
  current = persistVideoLabVerification(current, initialRows.find((row) => row.event.id === "p1-later")!, { videoSecond: 121, timeSource: "manual", now: 10 });
  current = persistVideoLabVerification(current, initialRows.find((row) => row.event.id === "p2-shot")!, { videoSecond: 1_305, timeSource: "manual", now: 20 });
  assert.deepEqual(current.videoEventOverrides?.map((item) => item.syncSegmentId), ["full:P1", "full:P2"]);
  const values = new Map<string, string>();
  const storage: LocalStorageAdapter = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  assert.equal(saveMatchSession(current, storage, 30).ok, true);
  const reloaded = loadMatchSession("video-lab", storage)!;
  assert.deepEqual(buildVideoLabTimeline(reloaded).filter((row) => row.status === "VERIFIED").map((row) => [row.event.id, row.estimatedSecond]), [["p1-later", 121], ["p2-shot", 1_305]]);
});

test("verificar permite avanzar a la siguiente jugada sin volver al inicio", () => {
  const session = buildSession([video("first", "abcdefghijk", [1], [{ id: "a1", eventId: "p1-shot", videoSecond: 100 }])]);
  const rows = buildVideoLabTimeline(session);
  const current = rows.find((row) => row.event.id === "p1-shot")!;
  const next = nextVideoLabRow(rows, current.syncSegmentId!, current.event.id);
  assert.equal(next?.event.id, "change");
  assert.equal(nextVideoLabRow(rows, current.syncSegmentId!, "p1-later"), null);
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

test("+ EVENTO crea provenance VIDEO tras la sustitución y VERIFIED sin mutar cronología previa", () => {
  const session = buildSession([video("first", "abcdefghijk", [1], [{ id: "a1", eventId: "p1-shot", videoSecond: 100 }])]);
  const immutable = structuredClone(session.events);
  const segment = buildVideoLabSyncSegments(session)[0];
  const result = createVideoSportsInsertion(session, "change", segment, 117, { kind: "LOSS", playerId: "p6" }, 99, "video-event")!;
  assert.deepEqual(session.events, immutable);
  assert.equal(result.event.provenance, "VIDEO");
  assert.deepEqual({ period: result.event.period, minute: result.event.minute, order: result.event.order }, { period: 1, minute: 10, order: 2 });
  assert.equal(result.onCourtPlayerIds.includes("p6"), true);
  assert.equal(result.onCourtPlayerIds.includes("p2"), false);
  assert.deepEqual(result.override, { matchId: "video-lab", eventId: "video-event", segmentId: "first", syncSegmentId: "first:P1", videoSecond: 117, status: "VERIFIED", timeSource: "manual", createdAt: 99, updatedAt: 99 });
  assert.equal(result.event.observedAt, undefined);
});

test("clips proponen -3/+6, admiten vacío, varios jugadores y etiquetas reutilizables", () => {
  assert.deepEqual(defaultVideoClipWindow(2), { referenceSecond: 2, startSecond: 0, endSecond: 8 });
  assert.deepEqual(defaultVideoClipWindow(40), { referenceSecond: 40, startSecond: 37, endSecond: 46 });
  const empty = createVideoAnalysisClip({ id: "c0", now: 10, clubId: "club", matchId: "video-lab", segmentId: "first:P1", videoId: "abcdefghijk", referenceSecond: 40, startSecond: 37, endSecond: 46, category: "", tags: [], playerIds: [], comment: "" });
  assert.equal(empty.category, undefined);
  assert.deepEqual(empty.playerIds, []);
  const rich = createVideoAnalysisClip({ id: "c1", now: 20, clubId: "club", matchId: "video-lab", segmentId: "first:P1", videoId: "abcdefghijk", referenceSecond: 50, startSecond: 45, endSecond: 58, category: "OFENSIVO", tags: [" presión alta ", "ABP", "ABP"], playerIds: ["p1", "p2", "p1"], comment: " Segundo palo " });
  assert.deepEqual(rich.tags, ["presión alta", "ABP"]);
  assert.deepEqual(rich.playerIds, ["p1", "p2"]);
  assert.equal(rich.comment, "Segundo palo");
  assert.deepEqual(videoClipTagSuggestions([empty, rich, { ...rich, id: "c2", tags: ["ABP"], updatedAt: 30 }]), ["ABP", "presión alta"]);
});

test("clip separado persiste tras reload sin contaminar MatchEvent", () => {
  const session = buildSession([video("first", "abcdefghijk", [1], [{ id: "a1", eventId: "p1-shot", videoSecond: 100 }])]);
  const events = structuredClone(session.events);
  const clip = createVideoAnalysisClip({ id: "clip-reload", now: 50, clubId: "club", matchId: session.matchId, segmentId: "first:P1", videoId: "abcdefghijk", referenceSecond: 40, startSecond: 37, endSecond: 46, tags: ["rival #7"], playerIds: ["p1", "p4"] });
  const values = new Map<string, string>();
  const storage: LocalStorageAdapter = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  assert.equal(saveMatchSession({ ...session, videoAnalysisClips: [clip] }, storage, 60).ok, true);
  const reloaded = loadMatchSession(session.matchId, storage)!;
  assert.deepEqual(reloaded.videoAnalysisClips, [clip]);
  assert.equal(JSON.stringify(reloaded.events), JSON.stringify(events));
});
