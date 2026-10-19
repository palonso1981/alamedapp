import assert from "node:assert/strict";
import test from "node:test";

import { canonicalToVisualPoint, visualToCanonicalPoint } from "./captureOrientation";
import { buildDashboardAnalyticsSnapshot, inspectDashboardAnalyticsSnapshots } from "./dashboardAnalyticsSnapshots";
import { createLineupInitializedEvent, createLiveThreatEvent, editEvent, replayMatch, softDeleteEvent } from "./matchEngine";
import { buildVideoLabTimeline } from "./videoLab";
import {
  attachDirectoVideoAnchor,
  applyVideoReviewCreation,
  createVideoReviewEvent,
  createVideoReviewLineup,
  formatPreciseVideoTime,
  inspectVideoReviewWorkspace,
  newDirectoVideoEventIds,
  preciseVideoSecond,
  replayVideoReviewAt,
  shiftPreciseVideoSecond,
} from "./videoReviewWorkspace";
import { DashboardMatchRecord } from "./dashboardAnalytics";
import { isVideoReviewPopoutCommand, isVideoReviewPopoutEvent, videoReviewChannelName } from "./videoReviewPopout";
import { MatchEvent, MatchSession, MatchVideoSegment, Player } from "../types";

const players: Player[] = Array.from({ length: 7 }, (_, index) => ({ id: `p${index + 1}`, name: `Jugador ${index + 1}`, number: index + 1, position: index === 0 || index === 5 ? "PORTERO" : "CIERRE" }));
const video = (id: string, periods: Array<1 | 2>, leadSeconds = 6): MatchVideoSegment => ({ id, provider: "YOUTUBE", videoId: `${id}abcdefghijk`.slice(0, 11), label: id, periods, leadSeconds, anchors: [], createdAt: 1, updatedAt: 1 });

function session(events: MatchEvent[] = [], segments = [video("part-1", [1]), video("part-2", [2])]): MatchSession {
  return { matchId: "review", players, staff: [{ id: "staff-1", name: "Entrenador", role: "ENTRENADOR" }], period: 1, minute: 0, periodMinutes: { 1: 0, 2: 0 }, closedPeriods: [], periodCloseSnapshots: {}, matchFinished: false, events, videoSegments: segments, past: [], future: [], lastError: null, persistenceStatus: "saved", lastSavedAt: 1, preparation: { clubId: "cd-alameda", teamId: "team", seasonId: "season", opponent: "Rival", date: "2026-10-18", venue: "HOME", competitionType: "FRIENDLY", status: "READY", calledPlayerIds: players.map((player) => player.id), starterPlayerIds: [], selectedStaffIds: [], targetMinutes: {}, createdAt: 1, updatedAt: 1 } };
}

function lineup(): MatchEvent {
  return createLineupInitializedEvent({ id: "lineup", matchId: "review", position: { period: 1, minute: 0, order: 1 }, squadPlayerIds: players.map((player) => player.id), onCourtPlayerIds: ["p1", "p2", "p3", "p4", "p5"], goalkeeperPlayerId: "p1", provenance: "VIDEO", now: 1 });
}

test("partido vacío exige quinteto y el quinteto canónico recuperado no se vuelve a pedir", () => {
  const empty = session();
  assert.deepEqual(inspectVideoReviewWorkspace(empty), { hasSquad: true, hasInitialLineup: false, sportsEventCount: 0, mode: "EMPTY" });
  const initialized = createVideoReviewLineup(empty, 1, ["p1", "p2", "p3", "p4", "p5"], "p1", 10);
  const ready = session([initialized]);
  assert.equal(inspectVideoReviewWorkspace(ready).hasInitialLineup, true);
  assert.equal(replayMatch(players, ready.events).lineupValidation.goalkeeper.status, "PLAYER");
});

test("anchor conserva décimas, es editable y no incorpora el pre-roll", () => {
  assert.equal(preciseVideoSecond(1307.34), 1307.3);
  assert.equal(shiftPreciseVideoSecond(1307.3, -5), 1302.3);
  assert.equal(formatPreciseVideoTime(1307.3), "21:47.3");
  const base = session([lineup()]);
  const creation = createVideoReviewEvent(base, base.videoSegments![0], { period: 1, minute: 4 }, 1307.34, { kind: "LOSS", playerId: "p2" }, { id: "loss", now: 20 });
  assert.equal(creation.override.videoSecond, 1307.3);
  const next = applyVideoReviewCreation(base, creation);
  const row = buildVideoLabTimeline(next).find((item) => item.event.id === "loss")!;
  assert.equal(row.estimatedSecond, 1307.3);
  assert.equal(row.openSecond, 1301.3);
});

test("Directo con vídeo añade metadata VERIFIED exacta sin modificar MatchEvent", () => {
  const base = session([lineup()]);
  const event = createLiveThreatEvent({ id: "directo-video", matchId: "review", position: { period: 1, minute: 6, order: 2 }, side: "FOR", playerId: "p2", origin: { x: 0.7, y: 0.4 }, outcome: "FUERA", phase: "POSITIONAL", provenance: "LIVE", now: 30 });
  const current = { ...base, events: [...base.events, event] };
  const beforeEvent = structuredClone(event);
  assert.deepEqual(newDirectoVideoEventIds(base.events, current.events), [event.id]);
  const anchored = attachDirectoVideoAnchor(current, { eventIds: [event.id], segmentId: "part-1", videoSecond: 221.34, now: 40 });
  assert.deepEqual(anchored.events.find((candidate) => candidate.id === event.id), beforeEvent);
  assert.deepEqual(anchored.videoEventOverrides, [{
    matchId: "review",
    eventId: event.id,
    segmentId: "part-1",
    syncSegmentId: "part-1:P1",
    videoSecond: 221.3,
    status: "VERIFIED",
    timeSource: "manual",
    createdAt: 40,
    updatedAt: 40,
  }]);
});

test("Directo normal no añade metadata y cada parte exige su fuente compatible", () => {
  const p1 = createLiveThreatEvent({ id: "p1", matchId: "review", position: { period: 1, minute: 2, order: 2 }, side: "FOR", playerId: "p2", origin: { x: 0.7, y: 0.4 }, outcome: "FUERA", phase: "POSITIONAL", provenance: "LIVE", now: 2 });
  const p2 = createLiveThreatEvent({ id: "p2", matchId: "review", position: { period: 2, minute: 2, order: 1 }, side: "FOR", playerId: "p3", origin: { x: 0.7, y: 0.4 }, outcome: "PARADA", phase: "POSITIONAL", provenance: "LIVE", now: 3 });
  const current = session([lineup(), p1, p2]);
  assert.equal(current.videoEventOverrides, undefined, "sin videoContext, Directo conserva exactamente su evento normal");
  assert.throws(() => attachDirectoVideoAnchor(current, { eventIds: [p2.id], segmentId: "part-1", videoSecond: 20 }), /no cubre el periodo/);
  const anchored = attachDirectoVideoAnchor(current, { eventIds: [p2.id], segmentId: "part-2", videoSecond: 20.8, now: 50 });
  assert.equal(anchored.videoEventOverrides?.[0].syncSegmentId, "part-2:P2");
  assert.equal(anchored.videoEventOverrides?.[0].videoSecond, 20.8);
});

test("dos partes de vídeo mantienen source independiente del periodo deportivo", () => {
  const sharedP1 = video("cut-a", [1]);
  const secondP1 = video("cut-b", [1]);
  const base = session([lineup()], [sharedP1, secondP1]);
  const first = createVideoReviewEvent(base, sharedP1, { period: 1, minute: 2 }, 10.2, { kind: "LOSS", playerId: "p2" }, { id: "a" });
  const afterFirst = applyVideoReviewCreation(base, first);
  const second = createVideoReviewEvent(afterFirst, secondP1, { period: 1, minute: 3 }, 4.5, { kind: "FOUL", side: "AGAINST" }, { id: "b" });
  const complete = applyVideoReviewCreation(afterFirst, second);
  assert.deepEqual(complete.videoEventOverrides?.map((item) => [item.eventId, item.segmentId, item.videoSecond]), [["a", "cut-a", 10.2], ["b", "cut-b", 4.5]]);
});

test("evento VIDEO y evento LIVE canónicos producen el mismo resultado deportivo", () => {
  const base = session([lineup()]);
  const live = createLiveThreatEvent({ id: "live", matchId: "review", position: { period: 1, minute: 5, order: 1 }, side: "FOR", playerId: "p2", origin: { x: 0.8, y: 0.4 }, outcome: "GOL", phase: "TRANSITION", assist: { status: "PENDING" }, pendingReview: true, provenance: "LIVE", now: 20 });
  const videoCreation = createVideoReviewEvent(base, base.videoSegments![0], { period: 1, minute: 5 }, 55.5, { kind: "THREAT", side: "FOR", playerId: "p2", origin: { x: 0.8, y: 0.4 }, outcome: "GOL", phase: "TRANSITION" }, { id: "video", now: 20 });
  assert.deepEqual(replayMatch(players, [...base.events, live]).score, replayMatch(players, applyVideoReviewCreation(base, videoCreation).events).score);
});

test("sustitución histórica reconstruye inmediatamente pista, minutos y orden del mismo minuto", () => {
  const before = createLiveThreatEvent({ id: "before", matchId: "review", position: { period: 1, minute: 7, order: 2 }, side: "FOR", playerId: "p2", origin: { x: 0.5, y: 0.5 }, outcome: "FUERA", phase: "POSITIONAL", provenance: "LIVE", now: 2 });
  const after = createLiveThreatEvent({ id: "after", matchId: "review", position: { period: 1, minute: 8, order: 1 }, side: "FOR", playerId: "p6", origin: { x: 0.5, y: 0.5 }, outcome: "PARADA", phase: "POSITIONAL", provenance: "LIVE", now: 3 });
  const base = session([lineup(), before, after]);
  const change = createVideoReviewEvent(base, base.videoSegments![0], { period: 1, minute: 7 }, 100, { kind: "SUBSTITUTION", playerOutId: "p2", playerInId: "p6" }, { id: "change", referenceEventId: "before", now: 4 });
  const next = applyVideoReviewCreation(base, change);
  const ordered = next.events.filter((event) => event.period === 1 && event.minute === 7).sort((a, b) => a.order - b.order);
  assert.deepEqual(ordered.map((event) => event.id), ["before", "change"]);
  assert.deepEqual(replayVideoReviewAt(next, 1, 8).onCourtPlayerIds, ["p1", "p6", "p3", "p4", "p5"]);
  assert.equal(replayMatch(players, next.events).playerMinutes.p2.totalMinutes, 7);
});

test("sustituir al portero funcional transfiere la portería al jugador entrante", () => {
  const base = session([lineup()]);
  const change = createVideoReviewEvent(base, base.videoSegments![0], { period: 1, minute: 5 }, 20, { kind: "SUBSTITUTION", playerOutId: "p1", playerInId: "p6" }, { id: "keeper-change" });
  const replay = replayMatch(players, applyVideoReviewCreation(base, change).events);
  assert.deepEqual(replay.onCourtPlayerIds, ["p6", "p2", "p3", "p4", "p5"]);
  assert.equal(replay.lineupValidation.goalkeeper.status, "PLAYER");
  assert.equal(replay.lineupValidation.goalkeeper.status === "PLAYER" ? replay.lineupValidation.goalkeeper.playerId : undefined, "p6");
});

test("cambio histórico incompatible conserva identidad y expone advertencia sin reasignar", () => {
  const laterP2 = createLiveThreatEvent({ id: "later-p2", matchId: "review", position: { period: 1, minute: 9, order: 1 }, side: "FOR", playerId: "p2", origin: { x: 0.4, y: 0.4 }, outcome: "FUERA", phase: "POSITIONAL", provenance: "LIVE", now: 3 });
  const base = session([lineup(), laterP2]);
  const change = createVideoReviewEvent(base, base.videoSegments![0], { period: 1, minute: 8 }, 100, { kind: "SUBSTITUTION", playerOutId: "p2", playerInId: "p6" }, { id: "change", now: 4 });
  const next = applyVideoReviewCreation(base, change);
  const preserved = next.events.find((event) => event.id === "later-p2");
  assert.equal(preserved?.type === "threat_recorded" ? preserved.playerId : undefined, "p2");
  assert.ok(replayMatch(players, next.events).issues.some((issue) => issue.eventId === "later-p2" && issue.code === "INVALID_THREAT_AUTHOR"));
});

test("editar o eliminar una sustitución usa replay canónico", () => {
  const base = session([lineup()]);
  const creation = createVideoReviewEvent(base, base.videoSegments![0], { period: 1, minute: 6 }, 30, { kind: "SUBSTITUTION", playerOutId: "p2", playerInId: "p6" }, { id: "change" });
  const changed = applyVideoReviewCreation(base, creation);
  const edited = editEvent(players, changed.events, "change", { substitution: { playerOutId: "p3", playerInId: "p6" } });
  assert.ok(replayMatch(players, edited).onCourtPlayerIds.includes("p2"));
  assert.ok(!replayMatch(players, edited).onCourtPlayerIds.includes("p3"));
  const deleted = softDeleteEvent(players, edited, "change");
  assert.deepEqual(replayMatch(players, deleted).onCourtPlayerIds, ["p1", "p2", "p3", "p4", "p5"]);
});

test("el mapa usa exactamente la conversión canónica de Directo", () => {
  const visual = { x: 0.18, y: 0.77 };
  const canonical = visualToCanonicalPoint(visual, "LEFT");
  assert.deepEqual(canonical, { x: 0.82, y: 0.77 });
  assert.deepEqual(canonicalToVisualPoint(canonical, "LEFT"), visual);
});

test("solo el partido mutado queda DIRTY y no se recalcula al editar", () => {
  const first = session([lineup()]);
  const second = { ...session([lineup()]), matchId: "review-2", events: session([lineup()]).events.map((event) => ({ ...event, id: `${event.id}-2`, matchId: "review-2" })) };
  const asRecord = (value: MatchSession): DashboardMatchRecord => ({ catalog: { matchId: value.matchId, clubId: "cd-alameda", teamId: "team", seasonId: "season", opponent: "Rival", date: "2026-10-18", venue: "HOME", status: "READY", updatedAt: 1 }, session: value });
  const records = [asRecord(first), asRecord(second)];
  const snapshots = records.map((record) => buildDashboardAnalyticsSnapshot(record, 1));
  const creation = createVideoReviewEvent(first, first.videoSegments![0], { period: 1, minute: 3 }, 20, { kind: "LOSS", playerId: "p2" }, { id: "loss" });
  const inspections = inspectDashboardAnalyticsSnapshots([asRecord(applyVideoReviewCreation(first, creation)), asRecord(second)], snapshots);
  assert.deepEqual(inspections.map((item) => item.state), ["DIRTY", "CURRENT"]);
});

test("seleccionar un evento existente sin override no lo verifica", () => {
  const event = createLiveThreatEvent({ id: "event", matchId: "review", position: { period: 1, minute: 2, order: 1 }, side: "FOR", playerId: "p2", origin: { x: 0.5, y: 0.5 }, outcome: "FUERA", phase: "POSITIONAL", provenance: "LIVE", now: 3 });
  const base = session([lineup(), event]);
  assert.equal(base.videoEventOverrides, undefined);
  assert.equal(buildVideoLabTimeline(base).find((row) => row.event.id === "event")?.status, "AUTO");
});

test("protocolo pop-out separa comandos de reproducción de la edición deportiva", () => {
  assert.equal(videoReviewChannelName("match-1"), "alamedapp:video-review:match-1");
  assert.equal(isVideoReviewPopoutCommand({ type: "SEEK", second: 14.2 }), true);
  assert.equal(isVideoReviewPopoutCommand({ type: "SEEK" }), false);
  assert.equal(isVideoReviewPopoutCommand({ type: "RATE", playbackRate: 1.5 }), true);
  assert.equal(isVideoReviewPopoutCommand({ type: "RATE", playbackRate: Number.NaN }), false);
  assert.equal(isVideoReviewPopoutCommand({ type: "STATE", videoId: "video", label: "P1", second: 4.2, playing: true, playbackRate: 1 }), true);
  assert.equal(isVideoReviewPopoutCommand({ type: "CREATE_EVENT", event: {} }), false);
  assert.equal(isVideoReviewPopoutEvent({ type: "TIME", second: 14.2, playing: true, playbackRate: 1.5 }), true);
  assert.equal(isVideoReviewPopoutEvent({ type: "TIME", second: -1, playing: true, playbackRate: 1.5 }), false);
  assert.equal(isVideoReviewPopoutEvent({ type: "CLOSED" }), true);
  assert.equal(isVideoReviewPopoutEvent({ type: "UPSERT", event: {} }), false);
});
