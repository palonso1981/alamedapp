import { MatchEvent, MatchPreparation, MatchReviewStatus, MatchVideoEventOverride, MatchVideoSegment, Player, StaffMember } from "../../types";

export const MATCH_SYNC_SCHEMA_VERSION = 1 as const;
export const MATCH_REMOTE_SCHEMA_VERSION = 1 as const;

export type SyncEntityType = "MATCH" | "EVENT";
export type SyncOperationKind = "UPSERT" | "TOMBSTONE";
export type SyncOperationStatus = "PENDING" | "SYNCING" | "ERROR" | "CONFLICT";
export type SyncErrorKind =
  | "OFFLINE"
  | "TRANSIENT"
  | "PERMISSION"
  | "CONFLICT"
  | "INVALID_DATA"
  | "FATAL";

export interface MatchRemoteMetadata {
  schemaVersion: typeof MATCH_REMOTE_SCHEMA_VERSION;
  matchId: string;
  players: Player[];
  staff: StaffMember[];
  activePeriod: number;
  minute: number;
  periodMinutes: Record<number, number>;
  closedPeriods: number[];
  periodCloseSnapshots: Record<number, number>;
  reviewPeriod?: number;
  reviewMinute?: number;
  matchFinished: boolean;
  reviewStatus?: MatchReviewStatus;
  reviewRevision?: number;
  reviewStartedAt?: number;
  reviewValidatedAt?: number;
  reviewReopenedAt?: number;
  videoSegments?: MatchVideoSegment[];
  videoEventOverrides?: MatchVideoEventOverride[];
  preparation?: MatchPreparation;
}

export type SyncOperationPayload = MatchRemoteMetadata | MatchEvent;

export interface MatchSyncOperation {
  id: string;
  matchId: string;
  entityType: SyncEntityType;
  entityId: string;
  kind: SyncOperationKind;
  payload: SyncOperationPayload;
  baseRevision: number;
  clientUpdatedAt: number;
  attempts: number;
  status: SyncOperationStatus;
  nextAttemptAt: number;
  lastError?: string;
  errorKind?: SyncErrorKind;
  /** Sesión técnica de Directo. Ausente en operaciones legacy o fuera de captura. */
  captureSessionId?: string;
  captureAccessId?: string;
  captureDeviceInstallId?: string;
}

export interface MatchSyncConflict {
  operationId: string;
  entityKey: string;
  detectedAt: number;
  localPayload: SyncOperationPayload;
  remoteRevision: number;
  remotePayload: unknown;
}

export interface PersistedMatchSyncState {
  schemaVersion: typeof MATCH_SYNC_SCHEMA_VERSION;
  outbox: MatchSyncOperation[];
  knownRemoteRevisions: Record<string, number>;
  lastLocalMutationAt: number | null;
  lastSyncedAt: number | null;
  lastError: string | null;
  lastErrorKind: SyncErrorKind | null;
  conflicts: MatchSyncConflict[];
}

export interface MatchSyncSummary {
  pending: number;
  syncing: number;
  errors: number;
  conflicts: number;
  lastSyncedAt: number | null;
  lastError: string | null;
  lastErrorKind: SyncErrorKind | null;
}

export interface AccessChangeSyncOperation {
  status?: string;
  errorKind?: string;
  nextAttemptAt?: number;
}

/**
 * Única semántica para impedir un cambio de credencial: solo trabajo que el
 * coordinador puede enviar automáticamente ahora o tras recuperar conexión.
 * Conflictos y errores terminales permanecen íntegros para revisión, pero no
 * pueden reaparecer bajo otra identidad por sí solos y por tanto no bloquean.
 */
export function blocksAccessChange(
  operation: AccessChangeSyncOperation,
): boolean {
  const status = operation.status ?? "PENDING";
  if (status === "PENDING" || status === "SYNCING") return true;
  if (status !== "ERROR") return false;
  if (
    operation.errorKind === "PERMISSION" ||
    operation.errorKind === "INVALID_DATA" ||
    operation.errorKind === "FATAL" ||
    operation.errorKind === "CONFLICT"
  ) {
    return false;
  }
  return operation.nextAttemptAt !== Number.MAX_SAFE_INTEGER;
}

export function emptyMatchSyncState(): PersistedMatchSyncState {
  return {
    schemaVersion: MATCH_SYNC_SCHEMA_VERSION,
    outbox: [],
    knownRemoteRevisions: {},
    lastLocalMutationAt: null,
    lastSyncedAt: null,
    lastError: null,
    lastErrorKind: null,
    conflicts: [],
  };
}

export function syncEntityKey(
  entityType: SyncEntityType,
  entityId: string,
): string {
  return entityType === "MATCH" ? "match" : `event:${entityId}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validOperation(value: unknown, matchId: string): value is MatchSyncOperation {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    value.matchId === matchId &&
    (value.entityType === "MATCH" || value.entityType === "EVENT") &&
    typeof value.entityId === "string" &&
    (value.kind === "UPSERT" || value.kind === "TOMBSTONE") &&
    isObject(value.payload) &&
    typeof value.baseRevision === "number" &&
    Number.isInteger(value.baseRevision) &&
    value.baseRevision >= 0 &&
    typeof value.clientUpdatedAt === "number" &&
    typeof value.attempts === "number" &&
    Number.isInteger(value.attempts) &&
    ["PENDING", "SYNCING", "ERROR", "CONFLICT"].includes(String(value.status)) &&
    typeof value.nextAttemptAt === "number"
    && (value.captureSessionId === undefined || typeof value.captureSessionId === "string")
    && (value.captureAccessId === undefined || typeof value.captureAccessId === "string")
    && (value.captureDeviceInstallId === undefined || typeof value.captureDeviceInstallId === "string")
  );
}

/** A retry after a browser close keeps the same operation id. */
export function migrateMatchSyncState(
  value: unknown,
  matchId: string,
): PersistedMatchSyncState {
  if (!isObject(value) || value.schemaVersion !== MATCH_SYNC_SCHEMA_VERSION) {
    return emptyMatchSyncState();
  }
  const revisions: Record<string, number> = isObject(value.knownRemoteRevisions)
    ? (Object.fromEntries(
        Object.entries(value.knownRemoteRevisions).filter(
          ([key, revision]) =>
            key.length > 0 &&
            typeof revision === "number" &&
            Number.isInteger(revision) &&
            revision >= 0,
        ),
      ) as Record<string, number>)
    : {};
  const validOutbox = Array.isArray(value.outbox)
    ? value.outbox.filter((operation) => validOperation(operation, matchId)).map(
        (operation) => ({
          ...operation,
          status: operation.status === "SYNCING" ? "PENDING" : operation.status,
        }),
      )
    : [];
  // Older clients could append one CONFLICT operation per local edit of the
  // same entity. Keep only the latest local payload: there is still one
  // unresolved entity conflict, not several independent conflicts.
  const latestConflictIndexByEntity = new Map<string, number>();
  validOutbox.forEach((operation, index) => {
    if (operation.status !== "CONFLICT") return;
    const key = syncEntityKey(operation.entityType, operation.entityId);
    const previousIndex = latestConflictIndexByEntity.get(key);
    if (
      previousIndex === undefined ||
      validOutbox[previousIndex].clientUpdatedAt <= operation.clientUpdatedAt
    ) {
      latestConflictIndexByEntity.set(key, index);
    }
  });
  const outbox = validOutbox.filter((operation, index) => {
    if (operation.status !== "CONFLICT") return true;
    return (
      latestConflictIndexByEntity.get(
        syncEntityKey(operation.entityType, operation.entityId),
      ) === index
    );
  });
  const retainedOperationIds = new Set(outbox.map((operation) => operation.id));
  return {
    schemaVersion: MATCH_SYNC_SCHEMA_VERSION,
    outbox,
    knownRemoteRevisions: revisions,
    lastLocalMutationAt:
      typeof value.lastLocalMutationAt === "number" ? value.lastLocalMutationAt : null,
    lastSyncedAt: typeof value.lastSyncedAt === "number" ? value.lastSyncedAt : null,
    lastError: typeof value.lastError === "string" ? value.lastError : null,
    lastErrorKind:
      typeof value.lastErrorKind === "string"
        ? (value.lastErrorKind as SyncErrorKind)
        : null,
    conflicts: Array.isArray(value.conflicts)
      ? (value.conflicts.filter(
          (conflict) =>
            isObject(conflict) &&
            typeof conflict.operationId === "string" &&
            retainedOperationIds.has(conflict.operationId),
        ) as unknown as MatchSyncConflict[])
      : [],
  };
}

export function summarizeSyncState(
  state: PersistedMatchSyncState,
): MatchSyncSummary {
  return {
    pending: state.outbox.filter((operation) => operation.status === "PENDING").length,
    syncing: state.outbox.filter((operation) => operation.status === "SYNCING").length,
    errors: state.outbox.filter((operation) => operation.status === "ERROR").length,
    conflicts: state.outbox.filter((operation) => operation.status === "CONFLICT").length,
    lastSyncedAt: state.lastSyncedAt,
    lastError: state.lastError,
    lastErrorKind: state.lastErrorKind,
  };
}
