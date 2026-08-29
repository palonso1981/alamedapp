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
  MatchSyncOperation,
  MatchSyncSummary,
} from "../lib/sync/syncTypes";

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
};

const browserSyncCoordinator = new MatchSyncCoordinator(
  browserMatchRepository,
  lazyFirestoreRemote,
  { debug },
);

export interface MatchSyncView {
  summary: MatchSyncSummary;
  config: FirebaseDevConfigStatus;
  eligible: boolean;
  online: boolean;
  retry: () => void;
}

export function useMatchSync(matchId: string): MatchSyncView {
  const config = useMemo(() => firebaseDevConfigStatus(), []);
  const eligible = isRemoteSyncEligibleMatch(matchId);
  const [summary, setSummary] = useState<MatchSyncSummary>(EMPTY_SUMMARY);
  const [online, setOnline] = useState(true);

  const refresh = useCallback(() => {
    setSummary(browserMatchRepository.getSummary(matchId));
  }, [matchId]);

  const sync = useCallback(() => {
    if (!eligible || !config.configured || !navigator.onLine) return;
    void browserSyncCoordinator.syncMatch(matchId).then(refresh);
  }, [config.configured, eligible, matchId, refresh]);

  const retry = useCallback(() => {
    if (!eligible || !config.configured || !navigator.onLine) return;
    void browserSyncCoordinator.retryMatch(matchId).then(refresh);
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

  return { summary, config, eligible, online, retry };
}
