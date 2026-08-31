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
    const payload = operation.payload;
    const reference = operation.entityType === "TEAM"
      ? doc(db, "teams", operation.teamId)
      : operation.entityType === "PLAYER" || operation.entityType === "STAFF"
        ? doc(
            db,
            "teams",
            operation.teamId,
            operation.entityType === "PLAYER" ? "players" : "staff",
            operation.entityId,
          )
        : operation.entityType === "SEASON"
          ? doc(db, "teams", operation.teamId, "seasons", operation.entityId)
          : doc(
              db,
              "teams",
              operation.teamId,
              "seasons",
              "seasonId" in payload ? payload.seasonId : "invalid",
              operation.entityType === "SEASON_PLAYER" ? "players" : "staff",
              operation.entityType === "SEASON_PLAYER" && "playerId" in payload
                ? payload.playerId
                : operation.entityType === "SEASON_STAFF" && "staffId" in payload
                  ? payload.staffId
                  : "invalid",
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
      const documentEntityId = operation.entityType === "SEASON_PLAYER" && "playerId" in payload
        ? payload.playerId
        : operation.entityType === "SEASON_STAFF" && "staffId" in payload
          ? payload.staffId
          : operation.entityId;
      transaction.set(reference, {
        schemaVersion: 2,
        teamId: operation.teamId,
        entityType: operation.entityType,
        entityId: documentEntityId,
        revision,
        lastOperationId: operation.id,
        clientUpdatedAt: operation.clientUpdatedAt,
        serverUpdatedAt: serverTimestamp(),
        active: payload.active,
        payload: firestoreValue(payload),
      });
      return { status: "APPLIED", revision };
    });
  }
}
