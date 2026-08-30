import { doc, runTransaction, serverTimestamp } from "firebase/firestore";

import { getFirebaseDevServices } from "../firebase";
import { RemoteApplyResult } from "./remoteMatchRepository";
import { RevisionedRemoteRepository } from "./syncCoordinator";
import { TeamSyncOperation } from "./teamSyncTypes";

function firestoreValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class FirestoreDevTeamRepository
  implements RevisionedRemoteRepository<TeamSyncOperation>
{
  async apply(operation: TeamSyncOperation): Promise<RemoteApplyResult> {
    const { db } = await getFirebaseDevServices();
    const collectionName = operation.entityType === "PLAYER" ? "players" : "staff";
    const reference = doc(
      db,
      "teams",
      operation.teamId,
      collectionName,
      operation.entityId,
    );
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
        teamId: operation.teamId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        revision,
        lastOperationId: operation.id,
        clientUpdatedAt: operation.clientUpdatedAt,
        serverUpdatedAt: serverTimestamp(),
        active: operation.payload.active,
        payload: firestoreValue(operation.payload),
      });
      return { status: "APPLIED", revision };
    });
  }
}
