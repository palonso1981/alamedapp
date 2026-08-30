"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  firebaseDevConfigStatus,
  FirebaseDevConfigStatus,
} from "../lib/firebaseConfig";
import { browserTeamRepository } from "../lib/sync/localTeamRepository";
import { RemoteApplyResult } from "../lib/sync/remoteMatchRepository";
import {
  RevisionedRemoteRepository,
  SyncCoordinator,
} from "../lib/sync/syncCoordinator";
import { TeamSyncOperation } from "../lib/sync/teamSyncTypes";
import { MatchSyncSummary } from "../lib/sync/syncTypes";

const EMPTY_SUMMARY: MatchSyncSummary = {
  pending: 0,
  syncing: 0,
  errors: 0,
  conflicts: 0,
  lastSyncedAt: null,
  lastError: null,
  lastErrorKind: null,
};

let firestoreRemote: RevisionedRemoteRepository<TeamSyncOperation> | null = null;
const lazyRemote: RevisionedRemoteRepository<TeamSyncOperation> = {
  async apply(operation: TeamSyncOperation): Promise<RemoteApplyResult> {
    if (!firestoreRemote) {
      const { FirestoreDevTeamRepository } = await import(
        "../lib/sync/firestoreTeamRepository"
      );
      firestoreRemote = new FirestoreDevTeamRepository();
    }
    return firestoreRemote.apply(operation);
  },
};

const coordinator = new SyncCoordinator(browserTeamRepository, lazyRemote);

export interface TeamSyncView {
  summary: MatchSyncSummary;
  config: FirebaseDevConfigStatus;
  online: boolean;
  retry: () => void;
}

export function useTeamSync(teamId: string): TeamSyncView {
  const config = useMemo(() => firebaseDevConfigStatus(), []);
  const [summary, setSummary] = useState<MatchSyncSummary>(EMPTY_SUMMARY);
  const [online, setOnline] = useState(true);
  const refresh = useCallback(
    () => setSummary(browserTeamRepository.getSummary(teamId)),
    [teamId],
  );
  const sync = useCallback(() => {
    if (!config.configured || !navigator.onLine) return;
    void coordinator.syncMatch(teamId).then(refresh);
  }, [config.configured, refresh, teamId]);
  const retry = useCallback(() => {
    if (!config.configured || !navigator.onLine) return;
    void coordinator.retryMatch(teamId).then(refresh);
  }, [config.configured, refresh, teamId]);

  useEffect(() => {
    setOnline(navigator.onLine);
    refresh();
    const unsubscribe = browserTeamRepository.subscribe(teamId, () => {
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
  }, [refresh, retry, sync, teamId]);

  return { summary, config, online, retry };
}
