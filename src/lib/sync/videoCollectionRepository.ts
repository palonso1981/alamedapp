import { collection, doc, getDocs, runTransaction, serverTimestamp } from "firebase/firestore";
import { canMutateSports } from "../access/accessDomain";
import { getRuntimeAccessGrant } from "../access/accessRuntime";
import { getFirebaseDevServices } from "../firebase";
import { VideoCollection } from "../videoCollections";

const STORAGE_PREFIX = "alamedapp:video-collections:v1:";

type OperationStatus = "PENDING" | "SYNCING" | "ERROR" | "CONFLICT";

export interface VideoCollectionOperation {
  operationId: string;
  collectionId: string;
  payload: VideoCollection;
  baseRevision: number;
  status: OperationStatus;
  attempts: number;
  updatedAt: number;
  error?: string;
}

interface PersistedState {
  schemaVersion: 1;
  collections: VideoCollection[];
  revisions: Record<string, number>;
  outbox: VideoCollectionOperation[];
}

function emptyState(): PersistedState {
  return { schemaVersion: 1, collections: [], revisions: {}, outbox: [] };
}

function key(clubId: string): string { return `${STORAGE_PREFIX}${clubId}`; }

function read(clubId: string): PersistedState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = JSON.parse(window.localStorage.getItem(key(clubId)) ?? "null") as Partial<PersistedState> | null;
    if (!raw || raw.schemaVersion !== 1) return emptyState();
    return {
      schemaVersion: 1,
      collections: Array.isArray(raw.collections) ? raw.collections : [],
      revisions: raw.revisions && typeof raw.revisions === "object" ? raw.revisions : {},
      outbox: Array.isArray(raw.outbox) ? raw.outbox.map((operation) => operation.status === "SYNCING" ? { ...operation, status: "PENDING" as const } : operation) : [],
    };
  } catch { return emptyState(); }
}

const listeners = new Map<string, Set<() => void>>();

function write(clubId: string, state: PersistedState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key(clubId), JSON.stringify(state));
  listeners.get(clubId)?.forEach((listener) => listener());
}

function id(): string { return globalThis.crypto.randomUUID(); }

function enqueue(clubId: string, collectionValue: VideoCollection): void {
  const grant = getRuntimeAccessGrant();
  if (grant && !canMutateSports(grant)) throw new Error("Este acceso es de solo lectura.");
  const state = read(clubId);
  const previousIndex = state.outbox.findIndex((operation) => operation.collectionId === collectionValue.collectionId && operation.status !== "SYNCING");
  const previous = previousIndex >= 0 ? state.outbox[previousIndex] : undefined;
  const operation: VideoCollectionOperation = {
    operationId: previous?.operationId ?? id(),
    collectionId: collectionValue.collectionId,
    payload: structuredClone(collectionValue),
    baseRevision: previous?.baseRevision ?? state.revisions[collectionValue.collectionId] ?? 0,
    status: previous?.status === "CONFLICT" ? "CONFLICT" : "PENDING",
    attempts: previous?.attempts ?? 0,
    updatedAt: Date.now(),
    error: previous?.status === "CONFLICT" ? previous.error : undefined,
  };
  const outbox = [...state.outbox];
  if (previousIndex >= 0) outbox[previousIndex] = operation; else outbox.push(operation);
  const collections = [...state.collections.filter((item) => item.collectionId !== collectionValue.collectionId), structuredClone(collectionValue)];
  write(clubId, { ...state, collections, outbox });
  void syncVideoCollections(clubId);
}

function envelope(operation: VideoCollectionOperation, clubId: string, revision: number) {
  return {
    schemaVersion: 1,
    clubId,
    entityType: "VIDEO_COLLECTION",
    entityId: operation.collectionId,
    revision,
    lastOperationId: operation.operationId,
    active: operation.payload.active,
    clientUpdatedAt: operation.updatedAt,
    serverUpdatedAt: serverTimestamp(),
    payload: JSON.parse(JSON.stringify(operation.payload)),
  };
}

const running = new Map<string, Promise<void>>();

export async function syncVideoCollections(clubId: string): Promise<void> {
  const active = running.get(clubId);
  if (active) return active;
  const task = (async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const { db } = await getFirebaseDevServices();
    while (true) {
      const state = read(clubId);
      const operation = state.outbox.find((item) => item.status === "PENDING" || item.status === "ERROR");
      if (!operation) return;
      operation.status = "SYNCING";
      operation.attempts += 1;
      write(clubId, state);
      try {
        const reference = doc(db, "clubs", clubId, "videoCollections", operation.collectionId);
        const result = await runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(reference);
          const current = snapshot.data();
          const remoteRevision = typeof current?.revision === "number" ? current.revision : 0;
          if (current?.lastOperationId === operation.operationId) return { revision: remoteRevision, conflict: false };
          if (remoteRevision !== operation.baseRevision) return { revision: remoteRevision, conflict: true };
          const revision = remoteRevision + 1;
          transaction.set(reference, envelope(operation, clubId, revision));
          return { revision, conflict: false };
        });
        const next = read(clubId);
        const pending = next.outbox.find((item) => item.operationId === operation.operationId);
        if (!pending) continue;
        if (result.conflict) {
          pending.status = "CONFLICT";
          pending.error = `Revisión remota ${result.revision}; se conserva la versión local.`;
          write(clubId, next);
          return;
        }
        next.outbox = next.outbox.filter((item) => item.operationId !== operation.operationId);
        next.revisions[operation.collectionId] = result.revision;
        write(clubId, next);
      } catch (error) {
        const next = read(clubId);
        const pending = next.outbox.find((item) => item.operationId === operation.operationId);
        if (pending) {
          pending.status = "ERROR";
          pending.error = error instanceof Error ? error.message : "No se pudo sincronizar la colección.";
          write(clubId, next);
        }
        return;
      }
    }
  })().finally(() => { running.delete(clubId); });
  running.set(clubId, task);
  return task;
}

export async function hydrateVideoCollections(clubId: string): Promise<void> {
  const { db } = await getFirebaseDevServices();
  const snapshots = await getDocs(collection(db, "clubs", clubId, "videoCollections"));
  const remote = snapshots.docs.flatMap((snapshot) => {
    const data = snapshot.data();
    return data?.payload ? [{ value: data.payload as VideoCollection, revision: Number(data.revision) || 0 }] : [];
  });
  const state = read(clubId);
  const protectedIds = new Set(state.outbox.map((operation) => operation.collectionId));
  const collections = [
    ...state.collections.filter((item) => protectedIds.has(item.collectionId)),
    ...remote.filter((entry) => !protectedIds.has(entry.value.collectionId)).map((entry) => entry.value),
  ];
  const revisions = { ...state.revisions };
  remote.forEach((entry) => { if (!protectedIds.has(entry.value.collectionId)) revisions[entry.value.collectionId] = entry.revision; });
  write(clubId, { ...state, collections, revisions });
}

export const videoCollectionRepository = {
  list(clubId: string): VideoCollection[] { return read(clubId).collections; },
  pending(clubId: string): number { return read(clubId).outbox.filter((item) => item.status === "PENDING" || item.status === "SYNCING" || item.status === "ERROR").length; },
  conflicts(clubId: string): number { return read(clubId).outbox.filter((item) => item.status === "CONFLICT").length; },
  upsert(clubId: string, value: VideoCollection): void { enqueue(clubId, value); },
  softDelete(clubId: string, collectionId: string, now = Date.now()): void {
    const current = read(clubId).collections.find((item) => item.collectionId === collectionId);
    if (current) enqueue(clubId, { ...current, active: false, deletedAt: now, updatedAt: now });
  },
  subscribe(clubId: string, listener: () => void): () => void {
    const clubListeners = listeners.get(clubId) ?? new Set();
    clubListeners.add(listener);
    listeners.set(clubId, clubListeners);
    return () => { clubListeners.delete(listener); };
  },
};
