"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  firebaseDevConfigStatus,
  FirebaseDevConfigStatus,
} from "../lib/firebaseConfig";
import {
  browserMatchRepository,
  isRemoteSyncEligibleMatch,
} from "../lib/sync/localMatchRepository";
import { MatchSyncCoordinator } from "../lib/sync/syncCoordinator";
import {
  RemoteApplyResult,
  RemoteMatchRepository,
} from "../lib/sync/remoteMatchRepository";
import {
  blocksAccessChange,
  hasUnreconciledMatchSyncState,
  MatchSyncOperation,
  MatchSyncSummary,
} from "../lib/sync/syncTypes";
import {
  hasVideoOnlyMatchConflict,
  resolveLocalMatchVideoConflict,
} from "../lib/sync/matchVideoConflict";

const EMPTY_SUMMARY: MatchSyncSummary = {
  pending: 0,
  syncing: 0,
  errors: 0,
  conflicts: 0,
  lastSyncedAt: null,
  lastError: null,
  lastErrorKind: null,
};

const debug =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_SYNC_DEBUG === "true"
    ? (message: string, data?: unknown) => console.debug(`[AlamedAPP] ${message}`, data)
    : undefined;

let firestoreRemote: RemoteMatchRepository | null = null;
const lazyFirestoreRemote: RemoteMatchRepository = {
  async apply(operation: MatchSyncOperation): Promise<RemoteApplyResult> {
    if (!firestoreRemote) {
      const { FirestoreDevMatchRepository } = await import(
        "../lib/sync/firestoreMatchRepository"
      );
      firestoreRemote = new FirestoreDevMatchRepository();
    }
    return firestoreRemote.apply(operation);
  },
  async read(operation: MatchSyncOperation) {
    if (!firestoreRemote) {
      const { FirestoreDevMatchRepository } = await import(
        "../lib/sync/firestoreMatchRepository"
      );
      firestoreRemote = new FirestoreDevMatchRepository();
    }
    return firestoreRemote.read(operation);
  },
};

const browserSyncCoordinator = new MatchSyncCoordinator(
  browserMatchRepository,
  lazyFirestoreRemote,
  { debug },
);

export function syncMatchNow(matchId: string): Promise<MatchSyncSummary> {
  return browserSyncCoordinator.syncMatch(matchId);
}

export interface MatchSyncView {
  summary: MatchSyncSummary;
  config: FirebaseDevConfigStatus;
  eligible: boolean;
  online: boolean;
  retryableErrors: number;
  terminalPermissionErrors: number;
  captureConflicts: number;
  recoveryAvailable: boolean;
  localVideoResolutionAvailable: boolean;
  retry: () => void;
  reconcileIdentical: () => Promise<{ reconciled: number; protected: number; unchanged: number }>;
  resolveLocalVideo: () => Promise<{ status: "RESOLVED" | "PROTECTED"; reason?: string }>;
}

export function useMatchSync(matchId: string): MatchSyncView {
  const config = useMemo(() => firebaseDevConfigStatus(), []);
  const eligible = isRemoteSyncEligibleMatch(matchId);
  const [summary, setSummary] = useState<MatchSyncSummary>(EMPTY_SUMMARY);
  const [online, setOnline] = useState(true);
  const [diagnostics, setDiagnostics] = useState({ retryableErrors: 0, terminalPermissionErrors: 0, captureConflicts: 0, recoveryAvailable: false, localVideoResolutionAvailable: false });

  const refresh = useCallback(() => {
    const state = browserMatchRepository.getSyncState(matchId);
    setSummary(browserMatchRepository.getSummary(matchId));
    setDiagnostics({
      retryableErrors: state.outbox.filter((operation) => operation.status === "ERROR" && blocksAccessChange(operation)).length,
      terminalPermissionErrors: state.outbox.filter((operation) => operation.status === "ERROR" && operation.errorKind === "PERMISSION").length,
      captureConflicts: state.conflicts.filter((conflict) =>
        typeof conflict.remotePayload === "object" && conflict.remotePayload !== null &&
        "kind" in conflict.remotePayload && conflict.remotePayload.kind === "CAPTURE_LEASE_MISMATCH",
      ).length,
      recoveryAvailable: hasUnreconciledMatchSyncState(state),
      localVideoResolutionAvailable: hasVideoOnlyMatchConflict(state),
    });
  }, [matchId]);

  const sync = useCallback(() => {
    if (!eligible || !config.configured || !navigator.onLine) return;
    void browserSyncCoordinator.syncMatch(matchId).then(refresh);
  }, [config.configured, eligible, matchId, refresh]);

  const retry = useCallback(() => {
    if (!eligible || !config.configured || !navigator.onLine) return;
    void browserSyncCoordinator.retryMatch(matchId).then(refresh);
  }, [config.configured, eligible, matchId, refresh]);

  const reconcileIdentical = useCallback(async () => {
    if (!eligible || !config.configured || !navigator.onLine) return { reconciled: 0, protected: 0, unchanged: 0 };
    const operations = browserMatchRepository.getSyncState(matchId).outbox;
    const snapshots = await Promise.all(operations.map((operation) => lazyFirestoreRemote.read(operation)));
    const result = browserMatchRepository.reconcileRemoteSnapshots(matchId, snapshots);
    refresh();
    return result;
  }, [config.configured, eligible, matchId, refresh]);

  const resolveLocalVideo = useCallback(async () => {
    if (!eligible || !config.configured || !navigator.onLine) {
      return { status: "PROTECTED" as const, reason: "Se necesita conexión para volver a validar el remoto." };
    }
    try {
      const result = await resolveLocalMatchVideoConflict(matchId, browserMatchRepository, lazyFirestoreRemote);
      refresh();
      return result;
    } catch {
      refresh();
      return { status: "PROTECTED" as const, reason: "No se pudo validar el remoto. El conflicto sigue protegido." };
    }
  }, [config.configured, eligible, matchId, refresh]);

  useEffect(() => {
    setOnline(navigator.onLine);
    refresh();
    const unsubscribe = browserMatchRepository.subscribe(matchId, () => {
      refresh();
      sync();
    });
    const handleOnline = () => {
      setOnline(true);
      retry();
    };
    const handleOffline = () => {
      setOnline(false);
      refresh();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const interval = window.setInterval(sync, 15_000);
    sync();
    return () => {
      unsubscribe();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.clearInterval(interval);
    };
  }, [matchId, refresh, retry, sync]);

  return { summary, config, eligible, online, ...diagnostics, retry, reconcileIdentical, resolveLocalVideo };
}
