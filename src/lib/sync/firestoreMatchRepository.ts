import { doc, runTransaction, serverTimestamp } from "firebase/firestore";

import { getFirebaseDevServices } from "../firebase";
import {
  RemoteApplyResult,
  RemoteMatchRepository,
} from "./remoteMatchRepository";
import { MatchSyncOperation } from "./syncTypes";

function firestoreValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class FirestoreDevMatchRepository implements RemoteMatchRepository {
  async apply(operation: MatchSyncOperation): Promise<RemoteApplyResult> {
    const { db } = await getFirebaseDevServices();
    const reference =
      operation.entityType === "MATCH"
        ? doc(db, "matches", operation.matchId)
        : doc(db, "matches", operation.matchId, "events", operation.entityId);
    return runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists() ? snapshot.data() : undefined;
      const remoteRevision =
        typeof current?.revision === "number" ? current.revision : 0;
      if (current?.lastOperationId === operation.id) {
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
      transaction.set(reference, {
        schemaVersion: 1,
        matchId: operation.matchId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        revision,
        lastOperationId: operation.id,
        clientUpdatedAt: operation.clientUpdatedAt,
        serverUpdatedAt: serverTimestamp(),
        removed: operation.kind === "TOMBSTONE",
        payload: firestoreValue(operation.payload),
      });
      return { status: "APPLIED", revision };
    });
  }
}
