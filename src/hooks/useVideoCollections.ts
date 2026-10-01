"use client";

import { useEffect, useState } from "react";
import { hydrateVideoCollections, syncVideoCollections, videoCollectionRepository } from "../lib/sync/videoCollectionRepository";
import { VideoCollection } from "../lib/videoCollections";

export function useVideoCollections(clubId: string, enabled = true): {
  collections: VideoCollection[];
  pending: number;
  conflicts: number;
  upsert(value: VideoCollection): void;
  softDelete(collectionId: string): void;
} {
  const [version, setVersion] = useState(0);
  useEffect(() => videoCollectionRepository.subscribe(clubId, () => setVersion((value) => value + 1)), [clubId]);
  useEffect(() => {
    if (!enabled) return;
    void hydrateVideoCollections(clubId).then(() => syncVideoCollections(clubId)).catch(() => undefined);
  }, [clubId, enabled]);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const reconnect = () => { void syncVideoCollections(clubId); };
    window.addEventListener("online", reconnect);
    return () => window.removeEventListener("online", reconnect);
  }, [clubId, enabled]);
  void version;
  return {
    collections: videoCollectionRepository.list(clubId),
    pending: videoCollectionRepository.pending(clubId),
    conflicts: videoCollectionRepository.conflicts(clubId),
    upsert: (value) => videoCollectionRepository.upsert(clubId, value),
    softDelete: (collectionId) => videoCollectionRepository.softDelete(clubId, collectionId),
  };
}
