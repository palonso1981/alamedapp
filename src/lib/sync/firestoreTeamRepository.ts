import {
  doc,
  DocumentReference,
  Firestore,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import { getFirebaseDevServices } from "../firebase";
import { RemoteApplyResult } from "./remoteMatchRepository";
import { RevisionedRemoteRepository } from "./syncCoordinator";
import {
  TeamEntityType,
  TeamSyncAtomicCompanion,
  TeamSyncNamespace,
  TeamSyncOperation,
  TeamSyncPayload,
} from "./teamSyncTypes";

function firestoreValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableFirestoreValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableFirestoreValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableFirestoreValue(nested)]),
    );
  }
  return value;
}

function sameFirestorePayload(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableFirestoreValue(firestoreValue(left))) ===
    JSON.stringify(stableFirestoreValue(firestoreValue(right)));
}

function firestoreDocument(
  operation: TeamSyncOperation,
  revision: number,
  entityType: TeamEntityType = operation.entityType,
  entityId: string = operation.entityId,
  payload: TeamSyncPayload = operation.payload,
) {
  const canonical = operation.namespace === "CLUBS";
  const documentEntityId = entityType === "SEASON_PLAYER" && "playerId" in payload
    ? payload.playerId
    : entityType === "SEASON_STAFF" && "staffId" in payload
      ? payload.staffId
      : entityId;
  return {
    schemaVersion: canonical ? 3 : 2,
    clubId: operation.teamId,
    teamId: operation.teamId,
    entityType,
    entityId: documentEntityId,
    revision,
    lastOperationId: operation.id,
    clientUpdatedAt: operation.clientUpdatedAt,
    serverUpdatedAt: serverTimestamp(),
    active: payload.active,
    authorizationTeamId: operation.authorizationTeamId ?? null,
    authorizationSeasonId: operation.authorizationSeasonId ?? null,
    payload: firestoreValue(payload),
  };
}

function entityReference(
  db: Firestore,
  namespace: TeamSyncNamespace,
  clubId: string,
  entityType: TeamEntityType,
  entityId: string,
  payload: TeamSyncPayload,
): DocumentReference {
  if (namespace === "CLUBS") {
    if (entityType === "CLUB") return doc(db, "clubs", clubId);
    if (entityType === "TEAM_UNIT") return doc(db, "clubs", clubId, "teams", entityId);
    if (entityType === "PLAYER" || entityType === "STAFF") {
      return doc(db, "clubs", clubId, entityType === "PLAYER" ? "players" : "staff", entityId);
    }
    if (entityType === "SEASON") {
      return doc(db, "clubs", clubId, "teams", "teamId" in payload ? payload.teamId : "invalid", "seasons", entityId);
    }
    return doc(
      db,
      "clubs",
      clubId,
      "teams",
      "teamId" in payload ? payload.teamId : "invalid",
      "seasons",
      "seasonId" in payload ? payload.seasonId : "invalid",
      entityType === "SEASON_PLAYER" ? "players" : "staff",
      entityType === "SEASON_PLAYER" && "playerId" in payload
        ? payload.playerId
        : entityType === "SEASON_STAFF" && "staffId" in payload
          ? payload.staffId
          : "invalid",
    );
  }
  if (entityType === "TEAM") return doc(db, "teams", clubId);
  if (entityType === "TEAM_UNIT") return doc(db, "teams", clubId, "teams", entityId);
  if (entityType === "PLAYER" || entityType === "STAFF") {
    return doc(db, "teams", clubId, entityType === "PLAYER" ? "players" : "staff", entityId);
  }
  if (entityType === "SEASON") return doc(db, "teams", clubId, "seasons", entityId);
  return doc(
    db,
    "teams",
    clubId,
    "seasons",
    "seasonId" in payload ? payload.seasonId : "invalid",
    entityType === "SEASON_PLAYER" ? "players" : "staff",
    entityType === "SEASON_PLAYER" && "playerId" in payload
      ? payload.playerId
      : entityType === "SEASON_STAFF" && "staffId" in payload
        ? payload.staffId
        : "invalid",
  );
}

function companionReference(db: Firestore, operation: TeamSyncOperation, companion: TeamSyncAtomicCompanion) {
  return entityReference(
    db,
    operation.namespace,
    operation.teamId,
    companion.entityType,
    companion.entityId,
    companion.payload,
  );
}

export class FirestoreDevTeamRepository
  implements RevisionedRemoteRepository<TeamSyncOperation>
{
  async apply(operation: TeamSyncOperation): Promise<RemoteApplyResult> {
    const { db } = await getFirebaseDevServices();
    const payload = operation.payload;
    const reference = entityReference(
      db,
      operation.namespace,
      operation.teamId,
      operation.entityType,
      operation.entityId,
      payload,
    );
    // Una creación no empieza leyendo un documento inexistente: Rules aún no
    // tiene resource.data con el que autorizar ese get. Las reglas exigen
    // revision 1 en create y revision + 1 en update, así que este setDoc no
    // puede convertir base 0 en una sobrescritura de un documento existente.
    if (operation.baseRevision === 0) {
      try {
        if (operation.atomicCompanions?.length) {
          const batch = writeBatch(db);
          batch.set(reference, firestoreDocument(operation, 1));
          for (const companion of operation.atomicCompanions) {
            batch.set(
              companionReference(db, operation, companion),
              firestoreDocument(
                operation,
                1,
                companion.entityType,
                companion.entityId,
                companion.payload,
              ),
            );
          }
          await batch.commit();
        } else {
          await setDoc(reference, firestoreDocument(operation, 1));
        }
        return { status: "APPLIED", revision: 1 };
      } catch (error) {
        try {
          const snapshot = await getDoc(reference);
          if (snapshot.exists()) {
            const current = snapshot.data();
            const remoteRevision = typeof current.revision === "number" ? current.revision : 0;
            const companionSnapshots = await Promise.all(
              (operation.atomicCompanions ?? []).map(async (companion) => ({
                companion,
                snapshot: await getDoc(companionReference(db, operation, companion)),
              })),
            );
            const companionsAlreadyApplied = companionSnapshots.every(({ companion, snapshot: companionSnapshot }) => {
              if (!companionSnapshot.exists()) return false;
              const companionCurrent = companionSnapshot.data();
              return companionCurrent.lastOperationId === operation.id ||
                sameFirestorePayload(companionCurrent.payload, companion.payload);
            });
            if (
              (current.lastOperationId === operation.id || sameFirestorePayload(current.payload, payload)) &&
              companionsAlreadyApplied
            ) {
              return { status: "ALREADY_APPLIED", revision: remoteRevision };
            }
            return { status: "CONFLICT", remoteRevision, remotePayload: current.payload ?? null };
          }
        } catch {
          // Se conserva el error de escritura original; permission-denied no
          // equivale a ausencia ni autoriza un last-write-wins.
        }
        throw error;
      }
    }
    return runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists() ? snapshot.data() : undefined;
      const remoteRevision =
        typeof current?.revision === "number" ? current.revision : 0;
      if (current?.lastOperationId === operation.id) {
        return { status: "ALREADY_APPLIED", revision: remoteRevision };
      }
      if (
        current?.payload !== undefined &&
        sameFirestorePayload(current.payload, payload)
      ) {
        return { status: "ALREADY_APPLIED", revision: remoteRevision };
      }
      if (remoteRevision !== operation.baseRevision) {
        return {
          status: "CONFLICT",
          remoteRevision,
          remotePayload: current?.payload ?? null,
        };
      }
      const revision = remoteRevision + 1;
      transaction.set(reference, firestoreDocument(operation, revision));
      return { status: "APPLIED", revision };
    });
  }
}
