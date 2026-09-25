import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardFixture } from "./dashboardFixture";
import { emptyDashboardScope } from "./dashboardV2";
import { buildVideoLibraryItems, dashboardReturnHref, EMPTY_VIDEO_LIBRARY_FILTERS, nextReelIndex, shouldAdvanceReel } from "./videoLibrary";
import { MatchVideoAnalysisClip } from "../types";

function libraryRecords() {
  const records = structuredClone(buildDashboardFixture().slice(0, 2));
  records.forEach((record, recordIndex) => {
    const reviewable = record.session.events.filter((event) => ["threat_recorded", "possession_lost", "foul_recorded", "card_recorded", "restart_recorded"].includes(event.type) && event.deletedAt === null).slice(0, 4);
    const segment = { id: `segment-${recordIndex}`, provider: "YOUTUBE" as const, videoId: recordIndex ? "BBBBBBBBBBB" : "AAAAAAAAAAA", label: "Partido", periods: [1, 2] as Array<1 | 2>, leadSeconds: 6, anchors: [], createdAt: 1, updatedAt: 1 };
    record.session.videoSegments = [segment];
    record.session.videoEventOverrides = reviewable.map((event, index) => ({ matchId: record.catalog.matchId, eventId: event.id, segmentId: segment.id, syncSegmentId: `${segment.id}:P${event.period}`, videoSecond: 30 + index * 10, status: "VERIFIED" as const, timeSource: "manual" as const, createdAt: 1, updatedAt: 1 }));
    const playerId = record.session.players[recordIndex]?.id ?? record.session.players[0].id;
    const clip: MatchVideoAnalysisClip = { id: `clip-${recordIndex}`, clubId: record.catalog.clubId ?? "", matchId: record.catalog.matchId, segmentId: `${segment.id}:P1`, videoId: segment.videoId, referenceSecond: 80, startSecond: 77, endSecond: 86, category: recordIndex ? "DEFENSIVO" : "ESTRATEGIA", tags: recordIndex ? ["rival"] : ["presión alta", "ABP"], playerIds: [playerId], comment: "Detalle", createdAt: 2, updatedAt: 2 };
    record.session.videoAnalysisClips = [clip];
  });
  return records;
}

test("Biblioteca lista eventos y clips sin mezclar sus modelos", () => {
  const records = libraryRecords();
  const items = buildVideoLibraryItems(records, EMPTY_VIDEO_LIBRARY_FILTERS, { includeClips: true });
  assert.ok(items.some((item) => item.source === "EVENT"));
  assert.equal(items.filter((item) => item.source === "CLIP").length, 2);
  assert.equal(items.find((item) => item.source === "CLIP")?.verified, true);
  assert.equal(records[0].session.events.some((event) => "tags" in event), false);
});

test("selector de fuente separa TODO, eventos y todos los clips sin filtros auxiliares", () => {
  const records = libraryRecords();
  const all = buildVideoLibraryItems(records, EMPTY_VIDEO_LIBRARY_FILTERS);
  const events = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT" });
  const clips = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "CLIP" });
  assert.ok(all.some((item) => item.source === "EVENT"));
  assert.equal(all.filter((item) => item.source === "CLIP").length, 2);
  assert.ok(events.length > 0 && events.every((item) => item.source === "EVENT"));
  assert.equal(clips.length, 2);
  assert.ok(clips.every((item) => item.source === "CLIP"));
});

test("Biblioteca combina jugador, evento, categoría, etiqueta, rival, partido, temporada y VERIFIED", () => {
  const records = libraryRecords();
  const clip = records[0].session.videoAnalysisClips![0];
  const clipFilters = { ...EMPTY_VIDEO_LIBRARY_FILTERS, playerId: clip.playerIds[0], category: "ESTRATEGIA", tag: "presión alta", rival: records[0].catalog.opponent, matchId: records[0].catalog.matchId, seasonId: records[0].catalog.seasonId ?? "", verifiedOnly: true };
  const clips = buildVideoLibraryItems(records, clipFilters, { includeClips: true });
  assert.deepEqual(clips.map((item) => item.key), [`CLIP:${records[0].catalog.matchId}:${clip.id}`]);
  const event = records[0].session.events.find((item) => item.type === "possession_lost" && records[0].session.videoEventOverrides?.some((override) => override.eventId === item.id));
  if (event?.type === "possession_lost") {
    const events = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, playerId: event.playerId, eventKind: "possession_lost", verifiedOnly: true }, { includeClips: true });
    assert.ok(events.length > 0);
    assert.ok(events.every((item) => item.source === "EVENT" && item.event.type === "possession_lost"));
  }
});

test("scope estadístico reutiliza filterDashboardDataset y excluye clips por defecto", () => {
  const records = libraryRecords();
  const first = records[0];
  const scope = emptyDashboardScope(first.catalog.clubId ?? "", first.catalog.teamId ?? "", first.catalog.seasonId ?? "");
  scope.matchIds = [first.catalog.matchId];
  const items = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT" }, { dashboardScope: scope, includeClips: false });
  assert.ok(items.length > 0);
  assert.ok(items.every((item) => item.source === "EVENT" && item.matchId === first.catalog.matchId));
  const withAnalysisFilter = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, category: "ESTRATEGIA" }, { dashboardScope: scope, includeClips: false });
  assert.ok(withAnalysisFilter.some((item) => item.source === "CLIP"));
});

test("reel navega circularmente, avanza al final y conserva vídeos distintos", () => {
  const items = buildVideoLibraryItems(libraryRecords(), EMPTY_VIDEO_LIBRARY_FILTERS, { includeClips: true });
  assert.equal(nextReelIndex(items, items.length - 1, 1), 0);
  assert.equal(nextReelIndex(items, 0, -1), items.length - 1);
  assert.equal(shouldAdvanceReel(items[0], items[0].endSecond - 1, true), false);
  assert.equal(shouldAdvanceReel(items[0], items[0].endSecond, true), true);
  assert.equal(shouldAdvanceReel(items[0], items[0].endSecond, false), false);
  assert.equal(new Set(items.map((item) => item.videoId)).size, 2);
});

test("volver al análisis conserva exactamente el scope Dashboard y elimina solo filtros de Biblioteca", () => {
  const href = dashboardReturnHref("from=dashboard&aClub=club&aTeam=team&aCompetition=ALL&rCompetition=LEAGUE&mode=TOTALS&area=PLAYERS&vSource=CLIP&vMatch=match&vVerified=1");
  assert.equal(href, "/dashboard?aClub=club&aTeam=team&aCompetition=ALL&rCompetition=LEAGUE&mode=TOTALS&area=PLAYERS");
  assert.equal(dashboardReturnHref("from=dashboard&vSource=EVENT"), "/dashboard");
});
