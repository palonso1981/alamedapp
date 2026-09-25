import { LocalMatchRepository } from "./localMatchRepository";
import { RemoteMatchRepository } from "./remoteMatchRepository";
import {
  MatchRemoteMetadata,
  MatchSyncConflict,
  MatchSyncOperation,
  PersistedMatchSyncState,
  syncPayloadsEqual,
} from "./syncTypes";

type VideoMetadata = Pick<MatchRemoteMetadata, "videoSegments" | "videoEventOverrides" | "videoAnalysisClips">;

export type MatchVideoConflictResolution =
  | { status: "RESOLVED"; remoteRevision: number; wroteRemote: boolean }
  | { status: "PROTECTED"; reason: string };

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function splitVideoMetadata(value: unknown): {
  rest: Record<string, unknown>;
  video: VideoMetadata;
} | null {
  const source = objectValue(value);
  if (!source) return null;
  const {
    videoSegments = [],
    videoEventOverrides = [],
    videoAnalysisClips = [],
    ...rest
  } = source;
  if (!Array.isArray(videoSegments) || !Array.isArray(videoEventOverrides) || !Array.isArray(videoAnalysisClips)) return null;
  return {
    rest,
    video: {
      videoSegments: videoSegments as MatchRemoteMetadata["videoSegments"],
      videoEventOverrides: videoEventOverrides as MatchRemoteMetadata["videoEventOverrides"],
      videoAnalysisClips: videoAnalysisClips as MatchRemoteMetadata["videoAnalysisClips"],
    },
  };
}

/** Devuelve el payload remoto preservado, sustituyendo exclusivamente vídeo. */
export function buildLocalVideoResolutionPayload(
  localPayload: unknown,
  remotePayload: unknown,
): MatchRemoteMetadata | null {
  const local = splitVideoMetadata(localPayload);
  const remote = splitVideoMetadata(remotePayload);
  if (!local || !remote || !syncPayloadsEqual(local.rest, remote.rest)) return null;
  if (syncPayloadsEqual(local.video, remote.video)) return null;
  return {
    ...remotePayload as MatchRemoteMetadata,
    videoSegments: local.video.videoSegments,
    videoEventOverrides: local.video.videoEventOverrides,
    videoAnalysisClips: local.video.videoAnalysisClips,
  };
}

function matchVideoConflict(
  state: PersistedMatchSyncState,
): { operation: MatchSyncOperation; conflict: MatchSyncConflict } | null {
  for (const conflict of state.conflicts) {
    const operation = state.outbox.find((item) => item.id === conflict.operationId);
    if (
      operation?.entityType === "MATCH" &&
      operation.status === "CONFLICT" &&
      !operation.captureSessionId &&
      buildLocalVideoResolutionPayload(operation.payload, conflict.remotePayload)
    ) {
      return { operation, conflict };
    }
  }
  return null;
}

export function hasVideoOnlyMatchConflict(state: PersistedMatchSyncState): boolean {
  return matchVideoConflict(state) !== null;
}

/**
 * Resuelve únicamente metadata de vídeo. Cada intento relee el remoto y vuelve
 * a validar el resto del MATCH antes de aplicar control optimista.
 */
export async function resolveLocalMatchVideoConflict(
  matchId: string,
  local: LocalMatchRepository,
  remote: RemoteMatchRepository,
): Promise<MatchVideoConflictResolution> {
  const candidate = matchVideoConflict(local.getSyncState(matchId));
  if (!candidate) {
    return { status: "PROTECTED", reason: "El conflicto ya no está limitado exclusivamente a vídeo." };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await remote.read(candidate.operation);
    if (!snapshot.exists || snapshot.removed) {
      return { status: "PROTECTED", reason: "El MATCH remoto ya no está disponible para una resolución segura." };
    }
    if (syncPayloadsEqual(candidate.operation.payload, snapshot.payload)) {
      local.reconcileRemoteSnapshots(matchId, [snapshot]);
      return { status: "RESOLVED", remoteRevision: snapshot.revision, wroteRemote: false };
    }
    const mergedPayload = buildLocalVideoResolutionPayload(candidate.operation.payload, snapshot.payload);
    if (!mergedPayload) {
      local.reconcileRemoteSnapshots(matchId, [snapshot]);
      return { status: "PROTECTED", reason: "El remoto contiene diferencias ajenas al vídeo. No se ha escrito nada." };
    }
    const result = await remote.apply({
      ...candidate.operation,
      payload: mergedPayload,
      baseRevision: snapshot.revision,
      status: "PENDING",
      nextAttemptAt: 0,
      lastError: undefined,
      errorKind: undefined,
    });
    if (result.status !== "CONFLICT") {
      local.markSynced(matchId, candidate.operation.id, result.revision);
      return { status: "RESOLVED", remoteRevision: result.revision, wroteRemote: true };
    }
  }

  const latest = await remote.read(candidate.operation);
  local.reconcileRemoteSnapshots(matchId, [latest]);
  return { status: "PROTECTED", reason: "El remoto cambió durante la resolución. Se conserva el conflicto." };
}
