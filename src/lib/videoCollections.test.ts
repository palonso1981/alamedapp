import assert from "node:assert/strict";
import test from "node:test";
import { appendCollectionItems, collectionShareHref, createVideoCollection, listedVideoCollections, playableCollectionItems, removeCollectionItem, reorderCollectionItem } from "./videoCollections";
import { VideoLibraryItem } from "./videoLibrary";

function item(key: string, startSecond: number): VideoLibraryItem {
  return {
    key, source: "CLIP", matchId: "match-1", opponent: "Rival", date: "2026-10-01", seasonId: "s1",
    venue: "HOME", competition: "LEAGUE", segmentId: "segment-1", videoId: "youtube-1",
    startSecond, endSecond: startSecond + 8, referenceSecond: startSecond + 2, verified: true,
    playerIds: ["p1"], dominantFeet: [],
    clip: { id: key, clubId: "club-1", matchId: "match-1", segmentId: "segment-1", videoId: "youtube-1", referenceSecond: startSecond + 2, startSecond, endSecond: startSecond + 8, category: `Clip ${key}`, tags: [], playerIds: ["p1"], createdAt: 1, updatedAt: 1 },
    title: `Clip ${key}`,
  };
}

test("colección captura referencias, cortes y orden concretos", () => {
  const value = createVideoCollection({ collectionId: "c1", clubId: "club-1", kind: "COLLECTION", name: "  ABP  ", visibility: "CLUB", items: [item("a", 20), item("b", 40)], now: 100 });
  assert.equal(value.name, "ABP");
  assert.deepEqual(value.items.map((entry) => entry.key), ["a", "b"]);
  assert.deepEqual(value.items.map((entry) => entry.startSecond), [20, 40]);
  assert.equal(value.items[0].clipId, "a");
});

test("reel guardado conserva el corte snapshot aunque cambie el origen", () => {
  const value = createVideoCollection({ collectionId: "c1", clubId: "club-1", kind: "SHARED_REEL", name: "Reel", visibility: "LINK_ONLY", items: [item("a", 20)], now: 100 });
  const changed = item("a", 99);
  const result = playableCollectionItems(value, [changed]);
  assert.equal(result.items[0].startSecond, 20);
  assert.equal(result.items[0].endSecond, 28);
  assert.equal(result.missing.length, 0);
});

test("origen retirado no rompe la colección y queda marcado como no disponible", () => {
  const value = createVideoCollection({ collectionId: "c1", clubId: "club-1", kind: "COLLECTION", name: "Reel", visibility: "CLUB", items: [item("a", 20), item("b", 40)] });
  const result = playableCollectionItems(value, [item("b", 40)]);
  assert.deepEqual(result.items.map((entry) => entry.key), ["b"]);
  assert.deepEqual(result.missing.map((entry) => entry.key), ["a"]);
});

test("edición reordena, retira y añade sin duplicar referencias", () => {
  const initial = createVideoCollection({ collectionId: "c1", clubId: "club-1", kind: "COLLECTION", name: "Reel", visibility: "CLUB", items: [item("a", 20), item("b", 40)] });
  const reordered = reorderCollectionItem(initial, 1, 0, 200);
  assert.deepEqual(reordered.items.map((entry) => entry.key), ["b", "a"]);
  const removed = removeCollectionItem(reordered, "a", 300);
  const appended = appendCollectionItems(removed, [item("b", 40), item("c", 60)], 400);
  assert.deepEqual(appended.items.map((entry) => entry.key), ["b", "c"]);
});

test("solo las colecciones activas y listadas aparecen en la zona normal", () => {
  const listed = createVideoCollection({ collectionId: "c1", clubId: "club-1", kind: "COLLECTION", name: "Lista", visibility: "CLUB", items: [] });
  const hidden = createVideoCollection({ collectionId: "c2", clubId: "club-1", kind: "SHARED_REEL", name: "Enlace", visibility: "LINK_ONLY", items: [] });
  assert.deepEqual(listedVideoCollections([listed, hidden, { ...listed, collectionId: "c3", active: false }]).map((entry) => entry.collectionId), ["c1"]);
  assert.equal(collectionShareHref("c 1", "https://app.example"), "https://app.example/video?collection=c%201");
});
