import { VideoLibraryItem } from "./videoLibrary";

export const VIDEO_COLLECTION_SCHEMA_VERSION = 1 as const;

export type VideoCollectionVisibility = "CLUB" | "LINK_ONLY";
export type VideoCollectionKind = "COLLECTION" | "SHARED_REEL";

/** Referencia estable al origen más una instantánea inmutable del corte audiovisual. */
export interface VideoCollectionItem {
  key: string;
  source: "EVENT" | "CLIP";
  matchId: string;
  eventId?: string;
  clipId?: string;
  segmentId: string;
  videoId: string;
  startSecond: number;
  endSecond: number;
  referenceSecond: number;
  title: string;
  opponent: string;
  date: string;
  playerIds: string[];
  verified: boolean;
}

export interface VideoCollection {
  schemaVersion: typeof VIDEO_COLLECTION_SCHEMA_VERSION;
  collectionId: string;
  clubId: string;
  kind: VideoCollectionKind;
  name: string;
  description?: string;
  visibility: VideoCollectionVisibility;
  items: VideoCollectionItem[];
  active: boolean;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function videoCollectionItem(item: VideoLibraryItem): VideoCollectionItem {
  return {
    key: item.key,
    source: item.source,
    matchId: item.matchId,
    eventId: item.source === "EVENT" ? item.event.id : undefined,
    clipId: item.source === "CLIP" ? item.clip.id : undefined,
    segmentId: item.segmentId,
    videoId: item.videoId,
    startSecond: item.startSecond,
    endSecond: item.endSecond,
    referenceSecond: item.referenceSecond,
    title: item.source === "EVENT" ? item.title : item.clip.category || item.clip.tags[0] || "Clip de análisis",
    opponent: item.opponent,
    date: item.date,
    playerIds: [...item.playerIds],
    verified: item.verified,
  };
}

export function createVideoCollection(input: {
  collectionId: string;
  clubId: string;
  kind: VideoCollectionKind;
  name: string;
  description?: string;
  visibility: VideoCollectionVisibility;
  items: readonly VideoLibraryItem[];
  now?: number;
}): VideoCollection {
  const now = input.now ?? Date.now();
  return {
    schemaVersion: VIDEO_COLLECTION_SCHEMA_VERSION,
    collectionId: input.collectionId,
    clubId: input.clubId,
    kind: input.kind,
    name: input.name.trim() || "Reel sin título",
    description: input.description?.trim() || undefined,
    visibility: input.visibility,
    items: input.items.map(videoCollectionItem),
    active: true,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function collectionShareHref(collectionId: string, origin = ""): string {
  const path = `/video?collection=${encodeURIComponent(collectionId)}`;
  return origin ? new URL(path, origin).toString() : path;
}

export function listedVideoCollections(collections: readonly VideoCollection[]): VideoCollection[] {
  return collections.filter((item) => item.active && item.deletedAt === null && item.kind === "COLLECTION");
}

export function playableCollectionItems(
  collection: VideoCollection,
  currentItems: readonly VideoLibraryItem[],
): { items: VideoLibraryItem[]; missing: VideoCollectionItem[] } {
  const byKey = new Map(currentItems.map((item) => [item.key, item]));
  const missing: VideoCollectionItem[] = [];
  const items = collection.items.flatMap((saved) => {
    const current = byKey.get(saved.key);
    if (!current) {
      missing.push(saved);
      return [];
    }
    return [{
      ...current,
      segmentId: saved.segmentId,
      videoId: saved.videoId,
      startSecond: saved.startSecond,
      endSecond: saved.endSecond,
      referenceSecond: saved.referenceSecond,
      verified: saved.verified,
      playerIds: [...saved.playerIds],
      title: current.source === "EVENT" ? saved.title : undefined,
      clip: current.source === "CLIP" ? { ...current.clip, category: saved.title } : undefined,
    } as VideoLibraryItem];
  });
  return { items, missing };
}

export function reorderCollectionItem(collection: VideoCollection, from: number, to: number, now = Date.now()): VideoCollection {
  if (from === to || from < 0 || to < 0 || from >= collection.items.length || to >= collection.items.length) return collection;
  const items = [...collection.items];
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  return { ...collection, items, updatedAt: now };
}

export function removeCollectionItem(collection: VideoCollection, key: string, now = Date.now()): VideoCollection {
  return { ...collection, items: collection.items.filter((item) => item.key !== key), updatedAt: now };
}

export function appendCollectionItems(collection: VideoCollection, items: readonly VideoLibraryItem[], now = Date.now()): VideoCollection {
  const known = new Set(collection.items.map((item) => item.key));
  return { ...collection, items: [...collection.items, ...items.filter((item) => !known.has(item.key)).map(videoCollectionItem)], updatedAt: now };
}
