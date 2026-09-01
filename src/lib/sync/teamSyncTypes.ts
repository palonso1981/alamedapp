import {
  ClubProfile,
  MasterPlayer,
  MasterStaffMember,
  Season,
  SeasonPlayer,
  SeasonStaff,
  TeamProfile,
} from "../../types";
import {
  MatchSyncSummary,
  SyncErrorKind,
  SyncOperationStatus,
} from "./syncTypes";

export const TEAM_SYNC_SCHEMA_VERSION = 3 as const;
export type TeamSyncNamespace = "CLUBS" | "LEGACY_TEAMS";
export type TeamEntityType =
  | "CLUB"
  | "TEAM"
  | "TEAM_UNIT"
  | "PLAYER"
  | "STAFF"
  | "SEASON"
  | "SEASON_PLAYER"
  | "SEASON_STAFF";
export type TeamSyncPayload =
  | ClubProfile
  | TeamProfile
  | MasterPlayer
  | MasterStaffMember
  | Season
  | SeasonPlayer
  | SeasonStaff;

export interface TeamSyncOperation {
  id: string;
  teamId: string;
  entityType: TeamEntityType;
  entityId: string;
  /** Operaciones antiguas se migran a LEGACY_TEAMS; las nuevas usan CLUBS. */
  namespace: TeamSyncNamespace;
  kind: "UPSERT";
  payload: TeamSyncPayload;
  baseRevision: number;
  clientUpdatedAt: number;
  attempts: number;
  status: SyncOperationStatus;
  nextAttemptAt: number;
  lastError?: string;
  errorKind?: SyncErrorKind;
}

export interface TeamSyncConflict {
  operationId: string;
  entityKey: string;
  detectedAt: number;
  localPayload: TeamSyncPayload;
  remoteRevision: number;
  remotePayload: unknown;
}

export interface TeamSyncState {
  schemaVersion: typeof TEAM_SYNC_SCHEMA_VERSION;
  outbox: TeamSyncOperation[];
  knownRemoteRevisions: Record<string, number>;
  lastLocalMutationAt: number | null;
  lastSyncedAt: number | null;
  lastError: string | null;
  lastErrorKind: SyncErrorKind | null;
  conflicts: TeamSyncConflict[];
}

export function teamEntityKey(
  type: TeamEntityType,
  id: string,
  namespace: TeamSyncNamespace = "CLUBS",
): string {
  return `${namespace.toLowerCase()}:${type.toLowerCase()}:${id}`;
}

export function emptyTeamSyncState(): TeamSyncState {
  return {
    schemaVersion: TEAM_SYNC_SCHEMA_VERSION,
    outbox: [],
    knownRemoteRevisions: {},
    lastLocalMutationAt: null,
    lastSyncedAt: null,
    lastError: null,
    lastErrorKind: null,
    conflicts: [],
  };
}

export function summarizeTeamSync(state: TeamSyncState): MatchSyncSummary {
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
