import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardFixture } from "./dashboardFixture";
import { emptyDashboardScope } from "./dashboardV2";
import { activeVideoLibraryRecords, buildVideoLibraryItems, canonicalVideoRival, dashboardReturnHref, EMPTY_VIDEO_LIBRARY_FILTERS, matchesVideoEventKind, nextReelIndex, reelCutCompletion, removeVideoTag, renameVideoTag, safeVideoLibraryReturnHref, shouldAdvanceReel, shouldCloseVideoFilterMenu, shouldCorrectReelStart, videoLabNavigationHref, videoLibraryFiltersFromSearchParams, videoLibraryFiltersToSearchParams, videoLibraryKeyboardAction, videoLibraryReturnHref, videoLibraryWriteActionState, videoTagUsage } from "./videoLibrary";
import { MatchVideoAnalysisClip } from "../types";

function libraryRecords() {
  const records = structuredClone(buildDashboardFixture().slice(0, 2));
  records.forEach((record, recordIndex) => {
    const reviewable = record.session.events.filter((event) => ["threat_recorded", "possession_lost", "foul_recorded", "card_recorded", "restart_recorded"].includes(event.type) && event.deletedAt === null);
    const segment = { id: `segment-${recordIndex}`, provider: "YOUTUBE" as const, videoId: recordIndex ? "BBBBBBBBBBB" : "AAAAAAAAAAA", label: "Partido", periods: [1, 2] as Array<1 | 2>, leadSeconds: 6, anchors: [], createdAt: 1, updatedAt: 1 };
    record.session.videoSegments = [segment];
    record.session.videoEventOverrides = reviewable.map((event, index) => ({ matchId: record.catalog.matchId, eventId: event.id, segmentId: segment.id, syncSegmentId: `${segment.id}:P${event.period}`, videoSecond: 30 + index * 10, status: "VERIFIED" as const, timeSource: "manual" as const, createdAt: 1, updatedAt: 1 }));
    const playerId = record.session.players[recordIndex]?.id ?? record.session.players[0].id;
    const clip: MatchVideoAnalysisClip = { id: `clip-${recordIndex}`, clubId: record.catalog.clubId ?? "", matchId: record.catalog.matchId, segmentId: `${segment.id}:P1`, videoId: segment.videoId, referenceSecond: 80, startSecond: 77, endSecond: 86, category: recordIndex ? "DEFENSIVO" : "ESTRATEGIA", tags: recordIndex ? ["rival"] : ["presión alta", "ABP"], playerIds: [playerId], comment: "Detalle", createdAt: 2, updatedAt: 2 };
    record.session.videoAnalysisClips = [clip];
    if (reviewable[0]) record.session.videoEventAnalysisDetails = [{ matchId: record.catalog.matchId, eventId: reviewable[0].id, category: recordIndex ? "DEFENSIVO" : "OFENSIVO", tags: recordIndex ? ["bloque bajo"] : ["presión alta"], comment: "Lectura del evento", createdAt: 3, updatedAt: 3 }];
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
  const clipFilters = { ...EMPTY_VIDEO_LIBRARY_FILTERS, playerIds: [clip.playerIds[0]], themes: ["ESTRATEGIA"], tags: ["presión alta"], rivals: [canonicalVideoRival(records[0].catalog.opponent)], matchIds: [records[0].catalog.matchId], seasonIds: [records[0].catalog.seasonId ?? ""], verifiedOnly: true };
  const clips = buildVideoLibraryItems(records, clipFilters, { includeClips: true });
  assert.deepEqual(clips.map((item) => item.key), [`CLIP:${records[0].catalog.matchId}:${clip.id}`]);
  const event = records[0].session.events.find((item) => item.type === "possession_lost" && records[0].session.videoEventOverrides?.some((override) => override.eventId === item.id));
  if (event?.type === "possession_lost") {
    const events = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, playerIds: [event.playerId], eventKinds: ["LOSSES"], verifiedOnly: true }, { includeClips: true });
    assert.ok(events.length > 0);
    assert.ok(events.every((item) => item.source === "EVENT" && item.event.type === "possession_lost"));
  }
});

test("eventos enriquecidos participan en filtros de temática y etiquetas sin contaminar el evento deportivo", () => {
  const records = libraryRecords();
  const detail = records[0].session.videoEventAnalysisDetails![0];
  const immutable = structuredClone(records[0].session.events.find((event) => event.id === detail.eventId));
  const filtered = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT", themes: [detail.category!], tags: [detail.tags[0]] });
  assert.deepEqual(filtered.map((item) => item.source === "EVENT" ? item.event.id : ""), [detail.eventId]);
  assert.equal(filtered[0].source, "EVENT");
  if (filtered[0].source === "EVENT") assert.deepEqual(filtered[0].analysisDetail, detail);
  assert.deepEqual(records[0].session.events.find((event) => event.id === detail.eventId), immutable);
  const absent = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT", themes: [detail.category!], tags: ["no existe"] });
  assert.deepEqual(absent, []);
});

test("los ocho filtros principales son multiselección OR dentro y AND entre dimensiones", () => {
  const records = libraryRecords();
  const all = buildVideoLibraryItems(records, EMPTY_VIDEO_LIBRARY_FILTERS, { includeClips: true });
  const threats = all.filter((item) => item.source === "EVENT" && item.event.type === "threat_recorded");
  assert.ok(threats.length >= 2);
  const first = threats[0];
  if (first.source !== "EVENT" || first.event.type !== "threat_recorded") return;
  const firstPhase = first.event.phase;
  const firstOutcome = first.event.outcome;
  const eventFilters = {
    ...EMPTY_VIDEO_LIBRARY_FILTERS,
    playerIds: first.playerIds,
    matchIds: [first.matchId],
    rivals: [canonicalVideoRival(first.opponent)],
    eventKinds: ["SHOTS" as const, "THREATS" as const, "FOULS" as const],
    phases: [firstPhase],
    outcomes: [firstOutcome],
  };
  const filteredEvents = buildVideoLibraryItems(records, eventFilters, { includeClips: true });
  assert.ok(filteredEvents.length > 0);
  assert.ok(filteredEvents.every((item) => item.source === "EVENT" && item.matchId === first.matchId));
  assert.ok(filteredEvents.every((item) => item.source === "EVENT" && item.event.type === "threat_recorded" && item.event.phase === firstPhase && item.event.outcome === firstOutcome));

  const clipA = records[0].session.videoAnalysisClips![0];
  const clipB = records[1].session.videoAnalysisClips![0];
  const clips = buildVideoLibraryItems(records, {
    ...EMPTY_VIDEO_LIBRARY_FILTERS,
    source: "CLIP",
    playerIds: [clipA.playerIds[0], clipB.playerIds[0]],
    matchIds: [records[0].catalog.matchId, records[1].catalog.matchId],
    rivals: [canonicalVideoRival(records[0].catalog.opponent), canonicalVideoRival(records[1].catalog.opponent)],
    tags: [clipA.tags[0], clipB.tags[0]],
    themes: [clipA.category!, clipB.category!],
  });
  assert.deepEqual(new Set(clips.map((item) => item.key)), new Set([
    `CLIP:${records[0].catalog.matchId}:${clipA.id}`,
    `CLIP:${records[1].catalog.matchId}:${clipB.id}`,
  ]));
});

test("REMATES y AMENAZAS son filtros independientes basados en side canónico", () => {
  const records = libraryRecords();
  const shots = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT", eventKinds: ["SHOTS"] });
  const threats = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT", eventKinds: ["THREATS"] });
  assert.ok(shots.length > 0);
  assert.ok(threats.length > 0);
  assert.ok(shots.every((item) => item.source === "EVENT" && item.event.type === "threat_recorded" && item.event.side === "FOR"));
  assert.ok(threats.every((item) => item.source === "EVENT" && item.event.type === "threat_recorded" && item.event.side === "AGAINST"));
  assert.equal(shots.some((item) => threats.some((candidate) => candidate.key === item.key)), false);
});

test("selector TODOS/CDA/RIVAL combina el lado con resultado y otros eventos laterales", () => {
  const records = libraryRecords();
  const allGoals = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT", outcomes: ["GOL"] });
  assert.ok(allGoals.some((item) => item.source === "EVENT" && item.event.type === "threat_recorded" && item.event.side === "FOR"));
  assert.ok(allGoals.some((item) => item.source === "EVENT" && item.event.type === "threat_recorded" && item.event.side === "AGAINST"));
  for (const side of ["FOR", "AGAINST"] as const) {
    const goals = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT", side, outcomes: ["GOL"] });
    assert.ok(goals.length > 0);
    assert.ok(goals.every((item) => item.source === "EVENT" && "side" in item.event && item.event.side === side && item.event.type === "threat_recorded" && item.event.outcome === "GOL"));
    const cards = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT", side, eventKinds: ["CARDS"] });
    assert.ok(cards.every((item) => item.source === "EVENT" && item.event.type === "card_recorded" && item.event.side === side));
  }
});

test("ABP agrupa solo taxonomía canónica y permite córner, falta, banda, penalti y doble penalti", () => {
  const records = libraryRecords();
  const all = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT" });
  const kinds = ["SET_PIECES", "SET_PIECE_CORNER", "SET_PIECE_FREE_KICK", "SET_PIECE_KICK_IN", "SET_PIECE_PENALTY", "SET_PIECE_DOUBLE_PENALTY"] as const;
  const setPieces = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT", eventKinds: ["SET_PIECES"] });
  assert.ok(setPieces.length > 0);
  assert.ok(setPieces.every((item) => item.source === "EVENT" && matchesVideoEventKind(item.event, "SET_PIECES")));
  for (const kind of kinds.slice(1)) {
    const expected = all.filter((item) => item.source === "EVENT" && matchesVideoEventKind(item.event, kind));
    const filtered = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT", eventKinds: [kind] });
    assert.deepEqual(filtered.map((item) => item.key), expected.map((item) => item.key), kind);
  }
  assert.equal(setPieces.some((item) => item.source === "EVENT" && ["possession_lost", "card_recorded"].includes(item.event.type)), false);
});

test("el reel conserva exactamente el conjunto filtrado por lado y semántica", () => {
  const items = buildVideoLibraryItems(libraryRecords(), { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT", side: "AGAINST", eventKinds: ["THREATS"], outcomes: ["PARADA"] });
  assert.ok(items.length > 0);
  assert.ok(items.every((item) => item.source === "EVENT" && item.event.type === "threat_recorded" && item.event.side === "AGAINST" && item.event.outcome === "PARADA"));
  items.slice(0, -1).forEach((item, index) => assert.deepEqual(reelCutCompletion(items, index, item.endSecond, true), { kind: "NEXT", index: index + 1 }));
});

test("menús de filtros permanecen abiertos al seleccionar y cierran fuera, con otro menú o ESC", () => {
  assert.equal(shouldCloseVideoFilterMenu("OPTION_SELECTED"), false);
  assert.equal(shouldCloseVideoFilterMenu("HEADER_TOGGLE"), false);
  assert.equal(shouldCloseVideoFilterMenu("OUTSIDE_POINTER"), true);
  assert.equal(shouldCloseVideoFilterMenu("OTHER_MENU_OPENED"), true);
  assert.equal(shouldCloseVideoFilterMenu("ESCAPE"), true);
});

test("rival agrupa variantes equivalentes y VERIFIED no oculta AUTO cuando está desactivado", () => {
  const records = libraryRecords();
  records[0].catalog.opponent = "  Águilas   F.S. ";
  records[1].catalog.opponent = "Aguilas F.S.";
  const firstOverride = records[0].session.videoEventOverrides![0];
  records[0].session.videoEventOverrides![0] = { ...firstOverride, status: undefined };
  const rival = canonicalVideoRival("ÁGUILAS F.S.");
  const unverified = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, rivals: [rival] }, { includeClips: true });
  const verified = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, rivals: [rival], verifiedOnly: true }, { includeClips: true });
  assert.ok(unverified.some((item) => !item.verified));
  assert.ok(verified.length > 0 && verified.every((item) => item.verified));
  assert.ok(unverified.every((item) => canonicalVideoRival(item.opponent) === rival));
});

test("filtros avanzados aplican temporada, periodo, sede, competición y jornada", () => {
  const records = libraryRecords();
  records[0].catalog.seasonId = "season-a";
  records[0].session.preparation!.seasonId = "season-a";
  records[0].catalog.venue = "HOME";
  records[0].session.preparation!.venue = "HOME";
  records[0].session.preparation!.competitionType = "LEAGUE";
  records[0].session.preparation!.matchday = 7;
  const items = buildVideoLibraryItems(records, {
    ...EMPTY_VIDEO_LIBRARY_FILTERS,
    matchIds: [records[0].catalog.matchId],
    seasonIds: ["season-a"], periods: [1], venues: ["HOME"], competitions: ["LEAGUE"], matchdays: [7],
  }, { includeClips: true });
  assert.ok(items.length > 0);
  assert.ok(items.every((item) => item.matchId === records[0].catalog.matchId && item.seasonId === "season-a" && item.period === 1 && item.venue === "HOME" && item.competition === "LEAGUE" && item.matchday === 7));
});

test("filtros avanzados de portero, zonas y pie usan dimensiones deportivas fiables", () => {
  const records = libraryRecords();
  records.forEach((record) => {
    const player = record.session.players.find((candidate) => candidate.id === "fx-gk-1");
    if (player) player.dominantFoot = "LEFT";
  });
  const goalkeeper = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT", goalkeeperIds: ["fx-gk-1"] });
  assert.ok(goalkeeper.length > 0);
  assert.ok(goalkeeper.every((item) => item.source === "EVENT" && item.event.type === "threat_recorded" && item.event.defensive?.goalkeeper.status === "PLAYER" && item.event.defensive.goalkeeper.playerId === "fx-gk-1"));

  const originResults = (["Z1", "Z2", "Z3", "Z4", "Z5", "Z6"] as const).map((zone) => buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT", originZones: [zone] }));
  assert.ok(originResults.some((items) => items.length > 0));
  assert.ok(originResults.flat().every((item) => item.source === "EVENT" && item.event.type === "threat_recorded"));

  const targetResults = (["LEFT_HIGH", "CENTER_HIGH", "RIGHT_HIGH", "LEFT_LOW", "CENTER_LOW", "RIGHT_LOW"] as const).map((zone) => buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT", targetZones: [zone] }));
  assert.ok(targetResults.some((items) => items.length > 0));
  assert.ok(targetResults.flat().every((item) => item.source === "EVENT" && item.event.type === "threat_recorded"));

  const foot = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, dominantFeet: ["LEFT"] }, { includeClips: true });
  assert.ok(foot.length > 0 && foot.every((item) => item.dominantFeet.includes("LEFT")));
});

test("partidos archivados o eliminados no aparecen en la Biblioteca", () => {
  const records = libraryRecords();
  records[0].catalog.archivedAt = 100;
  records[1].session.preparation!.deletedAt = 200;
  assert.deepEqual(activeVideoLibraryRecords(records), []);
  assert.deepEqual(buildVideoLibraryItems(records, EMPTY_VIDEO_LIBRARY_FILTERS, { includeClips: true }), []);
});

test("gestión de etiquetas renombra, fusiona y elimina sin borrar clips", () => {
  const clips = libraryRecords().flatMap((record) => record.session.videoAnalysisClips ?? []);
  const renamed = renameVideoTag(clips, "presión alta", "ABP", 99);
  assert.equal(renamed.length, clips.length);
  assert.equal(videoTagUsage(renamed, "ABP"), 1);
  assert.deepEqual(renamed[0].tags, ["ABP"]);
  assert.equal(renamed[0].updatedAt, 99);
  const removed = removeVideoTag(renamed, "abp", 100);
  assert.equal(removed.length, clips.length);
  assert.deepEqual(removed[0].tags, []);
  assert.equal(removed[0].updatedAt, 100);
});

test("estado de filtros persiste multiselección y limpia filtros legacy al reabrir", () => {
  const filters = {
    ...EMPTY_VIDEO_LIBRARY_FILTERS,
    source: "CLIP" as const,
    side: "FOR" as const,
    playerIds: ["p1", "p2"], matchIds: ["m1", "m2"], rivals: ["rival a"], eventKinds: ["CARDS" as const],
    phases: ["TRANSITION" as const], outcomes: ["GOL" as const], tags: ["ABP"], themes: ["ESTRATEGIA"], seasonIds: ["s1"],
    periods: [1, 2], venues: ["HOME" as const], competitions: ["LEAGUE" as const], matchdays: [3], goalkeeperIds: ["g1"],
    originZones: ["Z2" as const], targetZones: ["CENTER_LOW" as const], dominantFeet: ["LEFT" as const], verifiedOnly: true,
  };
  const serialized = videoLibraryFiltersToSearchParams(filters, "from=dashboard&vPlayer=legacy&vMatch=legacy");
  assert.equal(serialized.get("from"), "dashboard");
  assert.equal(serialized.has("vPlayer"), false);
  assert.deepEqual(videoLibraryFiltersFromSearchParams(serialized), filters);
  assert.deepEqual(videoLibraryFiltersFromSearchParams(new URLSearchParams("from=dashboard")), EMPTY_VIDEO_LIBRARY_FILTERS);
});

test("scope estadístico reutiliza filterDashboardDataset y excluye clips por defecto", () => {
  const records = libraryRecords();
  const first = records[0];
  const scope = emptyDashboardScope(first.catalog.clubId ?? "", first.catalog.teamId ?? "", first.catalog.seasonId ?? "");
  scope.matchIds = [first.catalog.matchId];
  const items = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT" }, { dashboardScope: scope, includeClips: false });
  assert.ok(items.length > 0);
  assert.ok(items.every((item) => item.source === "EVENT" && item.matchId === first.catalog.matchId));
  const withAnalysisFilter = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, themes: ["ESTRATEGIA"] }, { dashboardScope: scope, includeClips: false });
  assert.ok(withAnalysisFilter.some((item) => item.source === "CLIP"));
});

test("Salesianos + córner conserva exactamente las amenazas de córner del Dashboard", () => {
  const records = libraryRecords();
  const record = records.find((candidate) => candidate.session.events.some((event) => event.type === "threat_recorded" && event.phase === "SET_PIECE_CORNER"));
  assert.ok(record);
  if (!record) return;
  record.catalog.opponent = "Salesianos";
  const cornerIds = new Set(record.session.events.filter((event) => event.type === "threat_recorded" && event.phase === "SET_PIECE_CORNER").map((event) => event.id));
  const anchor = record.session.events.find((event) => !cornerIds.has(event.id) && event.deletedAt === null);
  assert.ok(anchor);
  if (!anchor) return;
  record.session.videoSegments![0].anchors = [{ id: "anchor-context", eventId: anchor.id, videoSecond: 30 }];
  record.session.videoEventOverrides = record.session.videoEventOverrides?.filter((override) => !cornerIds.has(override.eventId));
  const scope = emptyDashboardScope(record.catalog.clubId ?? "", record.catalog.teamId ?? "", record.catalog.seasonId ?? "");
  scope.matchIds = [record.catalog.matchId];
  scope.phases = ["SET_PIECE_CORNER"];
  const items = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT" }, { dashboardScope: scope });
  assert.ok(items.length > 0);
  assert.ok(items.every((item) => item.source === "EVENT" && item.event.type === "threat_recorded" && item.event.phase === "SET_PIECE_CORNER"));
  assert.equal(items.some((item) => item.source === "EVENT" && ["restart_recorded", "foul_recorded", "card_recorded"].includes(item.event.type)), false);
});

test("Biblioteca respeta también resultados y zonas avanzadas sin ampliar el conjunto", () => {
  const records = libraryRecords();
  const record = records.find((candidate) => candidate.session.events.some((event) => event.type === "threat_recorded" && event.outcome === "GOL"));
  assert.ok(record);
  if (!record) return;
  const base = emptyDashboardScope(record.catalog.clubId ?? "", record.catalog.teamId ?? "", record.catalog.seasonId ?? "");
  base.matchIds = [record.catalog.matchId];
  const goals = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT" }, { dashboardScope: { ...base, outcomes: ["GOL"] } });
  assert.ok(goals.length > 0);
  assert.ok(goals.every((item) => item.source === "EVENT" && item.event.type === "threat_recorded" && item.event.outcome === "GOL"));

  const candidate = record.session.events.find((event) => event.type === "threat_recorded");
  assert.ok(candidate?.type === "threat_recorded");
  if (candidate?.type !== "threat_recorded") return;
  const far = candidate.origin.x >= .25;
  const lane = candidate.origin.y >= 2 / 3 ? 1 : candidate.origin.y <= 1 / 3 ? 3 : 2;
  const zone = `Z${far ? lane + 3 : lane}` as typeof base.originZones[number];
  const zoned = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT" }, { dashboardScope: { ...base, originZones: [zone] } });
  assert.ok(zoned.length > 0);
  assert.ok(zoned.every((item) => item.source === "EVENT" && item.event.type === "threat_recorded"));
});

test("Dashboard → VIDEO conserva el lado de amenaza sin ampliar el conjunto", () => {
  const records = libraryRecords();
  const first = records[0];
  const base = emptyDashboardScope(first.catalog.clubId ?? "", first.catalog.teamId ?? "", first.catalog.seasonId ?? "");
  base.matchIds = [first.catalog.matchId];
  for (const side of ["FOR", "AGAINST"] as const) {
    const items = buildVideoLibraryItems(records, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT" }, { dashboardScope: { ...base, threatSides: [side] } });
    assert.ok(items.length > 0);
    assert.ok(items.every((item) => item.source === "EVENT" && item.event.type === "threat_recorded" && item.event.side === side));
  }
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

test("reel automático recorre diez cortes y se detiene al final sin hacer loop", () => {
  const base = buildVideoLibraryItems(libraryRecords(), EMPTY_VIDEO_LIBRARY_FILTERS, { includeClips: true });
  assert.ok(base.length > 0);
  const items = Array.from({ length: 12 }, (_, index) => ({
    ...base[index % base.length],
    key: `${base[index % base.length].key}:${index}`,
    videoId: index % 2 === 0 ? "AAAAAAAAAAA" : "BBBBBBBBBBB",
    startSecond: 10 + index * 5,
    endSecond: 14 + index * 5,
    verified: index % 2 === 0,
  }));
  for (let index = 0; index < items.length - 1; index += 1) {
    assert.deepEqual(reelCutCompletion(items, index, items[index].endSecond, true), { kind: "NEXT", index: index + 1 });
  }
  assert.deepEqual(reelCutCompletion(items, items.length - 1, items.at(-1)!.endSecond, true), { kind: "FINISHED" });
  assert.deepEqual(reelCutCompletion(items, 0, items[0].endSecond - 1, true), { kind: "WAIT" });
  assert.deepEqual(reelCutCompletion(items, 0, items[0].endSecond, false), { kind: "WAIT" });
  assert.equal(new Set(items.map((item) => item.videoId)).size, 2);
  assert.ok(items.some((item) => item.verified) && items.some((item) => !item.verified));
});

test("reel de un único corte termina sin seleccionar de nuevo el primero", () => {
  const [item] = buildVideoLibraryItems(libraryRecords(), EMPTY_VIDEO_LIBRARY_FILTERS, { includeClips: true });
  assert.ok(item);
  assert.deepEqual(reelCutCompletion([item], 0, item.endSecond, true), { kind: "FINISHED" });
});

test("el siguiente corte corrige un arranque transitorio en 00:00 sin reubicar una reproducción ya correcta", () => {
  assert.equal(shouldCorrectReelStart(0, 426), true);
  assert.equal(shouldCorrectReelStart(426, 426), false);
  assert.equal(shouldCorrectReelStart(427, 426), false);
  assert.equal(shouldCorrectReelStart(430, 426), true);
});

test("teclado reserva espacio para reproducción y flechas para navegación, salvo en controles editables", () => {
  assert.equal(videoLibraryKeyboardAction("Space", false), "TOGGLE_PLAYBACK");
  assert.equal(videoLibraryKeyboardAction("ArrowLeft", false), "PREVIOUS");
  assert.equal(videoLibraryKeyboardAction("ArrowRight", false), "NEXT");
  assert.equal(videoLibraryKeyboardAction("Space", true), null);
  assert.equal(videoLibraryKeyboardAction("ArrowLeft", true), null);
  assert.equal(videoLibraryKeyboardAction("ArrowRight", true), null);
});

test("volver al análisis conserva exactamente el scope Dashboard y elimina solo filtros de Biblioteca", () => {
  const href = dashboardReturnHref("from=dashboard&aClub=club&aTeam=team&aCompetition=ALL&rCompetition=LEAGUE&mode=TOTALS&area=PLAYERS&vSource=CLIP&vMatch=match&vVerified=1");
  assert.equal(href, "/dashboard?aClub=club&aTeam=team&aCompetition=ALL&rCompetition=LEAGUE&mode=TOTALS&area=PLAYERS");
  assert.equal(dashboardReturnHref("from=dashboard&vSource=EVENT"), "/dashboard");
});

test("VIDEO abre el Video Lab exacto y conserva filtros, multiselecciones y resultado activo al volver", () => {
  const items = buildVideoLibraryItems(libraryRecords(), EMPTY_VIDEO_LIBRARY_FILTERS, { includeClips: true });
  const event = items.find((item) => item.source === "EVENT")!;
  const clip = items.find((item) => item.source === "CLIP")!;
  const current = "vPlayers=p1&vPlayers=p2&vKinds=LOSSES&vSide=FOR&vVerified=1&from=dashboard&aTeam=team";
  const eventHref = new URL(videoLabNavigationHref(event, current, "EDIT"), "https://app.invalid");
  assert.equal(eventHref.pathname, `/partido/${event.matchId}/video-lab`);
  assert.equal(eventHref.searchParams.get("focusEventId"), event.event.id);
  assert.equal(eventHref.searchParams.get("videoAction"), "edit-event");
  assert.equal(eventHref.searchParams.get("segmentId"), event.segmentId);
  assert.deepEqual(eventHref.searchParams.getAll("vPlayers"), ["p1", "p2"]);
  const returnTo = eventHref.searchParams.get("returnTo")!;
  assert.equal(returnTo, videoLibraryReturnHref(current, event.key));
  assert.match(returnTo, /vSide=FOR/);
  assert.match(returnTo, /vVerified=1/);
  assert.match(returnTo, /aTeam=team/);

  const clipHref = new URL(videoLabNavigationHref(clip, current, "EDIT"), "https://app.invalid");
  assert.equal(clipHref.searchParams.get("focusClipId"), clip.clip.id);
  assert.equal(clipHref.searchParams.get("videoAction"), "edit-clip");
  assert.equal(clipHref.searchParams.get("videoSecond"), String(clip.startSecond));
});

test("+ AÑADIR transporta el segundo real y el retorno solo admite Biblioteca interna", () => {
  const [item] = buildVideoLibraryItems(libraryRecords(), EMPTY_VIDEO_LIBRARY_FILTERS, { includeClips: true });
  const href = new URL(videoLabNavigationHref(item, "vSide=AGAINST", "ADD", 143.6), "https://app.invalid");
  assert.equal(href.searchParams.get("videoAction"), "add");
  assert.equal(href.searchParams.get("videoSecond"), "144");
  assert.equal(href.searchParams.get("segmentId"), item.segmentId);
  assert.equal(safeVideoLibraryReturnHref(href.searchParams.get("returnTo")), href.searchParams.get("returnTo"));
  assert.equal(safeVideoLibraryReturnHref("https://evil.invalid/video?vSide=FOR"), null);
  assert.equal(safeVideoLibraryReturnHref("/dashboard"), null);
});

test("ADMIN y EDITOR conservan acciones de escritura; VIEWER solo consume vídeo", () => {
  assert.deepEqual(videoLibraryWriteActionState(true), { canAdd: true, canEdit: true });
  assert.deepEqual(videoLibraryWriteActionState(false), { canAdd: false, canEdit: false });
});
