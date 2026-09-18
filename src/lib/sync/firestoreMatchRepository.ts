import { doc, getDoc, runTransaction, serverTimestamp, setDoc } from "firebase/firestore";

import { getFirebaseDevServices } from "../firebase";
import {
  RemoteApplyResult,
  RemoteMatchRepository,
} from "./remoteMatchRepository";
import { MatchSyncOperation } from "./syncTypes";
import { RemoteMatchEntitySnapshot, syncPayloadsEqual } from "./syncTypes";

function firestoreValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function firestoreDocument(operation: MatchSyncOperation, revision: number) {
  return {
    schemaVersion: 1,
    matchId: operation.matchId,
    entityType: operation.entityType,
    entityId: operation.entityId,
    revision,
    lastOperationId: operation.id,
    clientUpdatedAt: operation.clientUpdatedAt,
    serverUpdatedAt: serverTimestamp(),
    removed: operation.kind === "TOMBSTONE",
    captureSessionId: operation.captureSessionId ?? null,
    captureAccessId: operation.captureAccessId ?? null,
    captureDeviceInstallId: operation.captureDeviceInstallId ?? null,
    payload: firestoreValue(operation.payload),
  };
}

export class FirestoreDevMatchRepository implements RemoteMatchRepository {
  async read(operation: MatchSyncOperation): Promise<RemoteMatchEntitySnapshot> {
    const { db } = await getFirebaseDevServices();
    const reference = operation.entityType === "MATCH"
      ? doc(db, "matches", operation.matchId)
      : doc(db, "matches", operation.matchId, "events", operation.entityId);
    const snapshot = await getDoc(reference);
    const data = snapshot.exists() ? snapshot.data() : undefined;
    return {
      entityType: operation.entityType,
      entityId: operation.entityId,
      exists: snapshot.exists(),
      revision: typeof data?.revision === "number" ? data.revision : 0,
      removed: data?.removed === true,
      payload: data?.payload ?? null,
    };
  }

  async apply(operation: MatchSyncOperation): Promise<RemoteApplyResult> {
    const { db } = await getFirebaseDevServices();
    const reference =
      operation.entityType === "MATCH"
        ? doc(db, "matches", operation.matchId)
        : doc(db, "matches", operation.matchId, "events", operation.entityId);
    // Un get transaccional de matches/{id} inexistente no puede autorizarse por
    // club/equipo porque resource.data aún no existe. La primera revisión se
    // crea sin ese get; Rules exige revision 1 en create y revision + 1 en
    // update, de modo que un ID ya existente nunca puede sobrescribirse.
    if (operation.entityType === "MATCH" && operation.baseRevision === 0) {
      try {
        await setDoc(reference, firestoreDocument(operation, 1));
        return { status: "APPLIED", revision: 1 };
      } catch (error) {
        try {
          const snapshot = await getDoc(reference);
          if (snapshot.exists()) {
            const current = snapshot.data();
            const remoteRevision = typeof current.revision === "number" ? current.revision : 0;
            if (current.lastOperationId === operation.id ||
                (current.removed === (operation.kind === "TOMBSTONE") &&
                  syncPayloadsEqual(current.payload, firestoreValue(operation.payload)))) {
              return { status: "ALREADY_APPLIED", revision: remoteRevision };
            }
            return { status: "CONFLICT", remoteRevision, remotePayload: current.payload ?? null };
          }
        } catch {
          // Conserva el error original: una lectura inexistente puede estar
          // denegada y no demuestra que el Access esté revocado.
        }
        throw error;
      }
    }
    return runTransaction(db, async (transaction) => {
      const leaseSnapshot = operation.captureSessionId
        ? await transaction.get(doc(db, "matchCaptureLeases", operation.matchId))
        : null;
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists() ? snapshot.data() : undefined;
      const remoteRevision =
        typeof current?.revision === "number" ? current.revision : 0;
      if (operation.captureSessionId) {
        const lease = leaseSnapshot?.exists() ? leaseSnapshot.data() : null;
        if (lease?.status !== "ACTIVE" || lease.captureSessionId !== operation.captureSessionId) {
          return {
            status: "CONFLICT",
            remoteRevision,
            remotePayload: {
              kind: "CAPTURE_LEASE_MISMATCH",
              captureSessionId: lease?.captureSessionId ?? null,
              accessId: lease?.accessId ?? null,
              deviceInstallId: lease?.deviceInstallId ?? null,
              leaseStatus: lease?.status ?? "MISSING",
              remotePayload: current?.payload ?? null,
            },
          };
        }
      }
      if (current?.lastOperationId === operation.id) {
        return { status: "ALREADY_APPLIED", revision: remoteRevision };
      }
      if (current && current.removed === (operation.kind === "TOMBSTONE") && syncPayloadsEqual(current.payload, firestoreValue(operation.payload))) {
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
