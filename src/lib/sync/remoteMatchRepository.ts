import {
  MatchSyncOperation,
  SyncErrorKind,
  syncEntityKey,
} from "./syncTypes";

export type RemoteApplyResult =
  | { status: "APPLIED" | "ALREADY_APPLIED"; revision: number }
  | {
      status: "CONFLICT";
      remoteRevision: number;
      remotePayload: unknown;
    };

export interface RemoteMatchRepository {
  apply(operation: MatchSyncOperation): Promise<RemoteApplyResult>;
}

export class RemoteSyncError extends Error {
  constructor(
    public readonly kind: SyncErrorKind,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "RemoteSyncError";
  }
}

export function classifyRemoteError(error: unknown): RemoteSyncError {
  if (error instanceof RemoteSyncError) return error;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  const message = error instanceof Error ? error.message : "Error remoto desconocido.";
  if (["unavailable", "deadline-exceeded", "resource-exhausted", "aborted"].some((item) => code.includes(item))) {
    return new RemoteSyncError("TRANSIENT", message, true);
  }
  if (["permission-denied", "unauthenticated"].some((item) => code.includes(item))) {
    return new RemoteSyncError("PERMISSION", message, false);
  }
  if (["invalid-argument", "failed-precondition"].some((item) => code.includes(item))) {
    return new RemoteSyncError("INVALID_DATA", message, false);
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return new RemoteSyncError("OFFLINE", "Sin conexión; los datos siguen guardados localmente.", true);
  }
  return new RemoteSyncError("FATAL", message, false);
}

interface InMemoryRemoteDocument {
  revision: number;
  lastOperationId: string;
  payload: unknown;
  removed: boolean;
}

/** Adaptador determinista para pruebas de offline, retry y conflictos. */
export class InMemoryRemoteMatchRepository implements RemoteMatchRepository {
  readonly documents = new Map<string, InMemoryRemoteDocument>();
  online = true;
  failAfterApplyOnce = false;
  applyCalls = 0;

  async apply(operation: MatchSyncOperation): Promise<RemoteApplyResult> {
    this.applyCalls += 1;
    if (!this.online) {
      throw new RemoteSyncError("OFFLINE", "Remoto simulado sin conexión.", true);
    }
    const key = `${operation.matchId}:${syncEntityKey(operation.entityType, operation.entityId)}`;
    const current = this.documents.get(key);
    if (current?.lastOperationId === operation.id) {
      return { status: "ALREADY_APPLIED", revision: current.revision };
    }
    const remoteRevision = current?.revision ?? 0;
    if (remoteRevision !== operation.baseRevision) {
      return {
        status: "CONFLICT",
        remoteRevision,
        remotePayload: current?.payload ?? null,
      };
    }
    const revision = remoteRevision + 1;
    this.documents.set(key, {
      revision,
      lastOperationId: operation.id,
      payload: structuredClone(operation.payload),
      removed: operation.kind === "TOMBSTONE",
    });
    if (this.failAfterApplyOnce) {
      this.failAfterApplyOnce = false;
      throw new RemoteSyncError("TRANSIENT", "ACK simulado perdido.", true);
    }
    return { status: "APPLIED", revision };
  }

  seed(
    matchId: string,
    entityType: MatchSyncOperation["entityType"],
    entityId: string,
    revision: number,
    payload: unknown,
  ): void {
    this.documents.set(`${matchId}:${syncEntityKey(entityType, entityId)}`, {
      revision,
      lastOperationId: `remote-seed-${revision}`,
      payload,
      removed: false,
    });
  }
}
