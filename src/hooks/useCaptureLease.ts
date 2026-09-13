"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAccess } from "../components/access/AccessProvider";
import { beginLocalCaptureSession, CAPTURE_HEARTBEAT_MS, CaptureAcquireResult, LocalCaptureSession, MatchCaptureLease, captureOperationCanSync, setRuntimeCaptureContext, updateLocalCaptureMode } from "../lib/captureLease";
import { heartbeatLocalCaptureSession, releaseLocalCaptureSession, verifyLocalCaptureSession } from "../lib/captureLeaseClient";
import { firebaseDevConfigStatus } from "../lib/firebaseConfig";
import { isRemoteSyncEligibleMatch, browserMatchRepository } from "../lib/sync/localMatchRepository";
import { blocksAccessChange } from "../lib/sync/syncTypes";
import { MatchSession } from "../types";
import { syncMatchNow } from "./useMatchSync";

export type CaptureControlStatus =
  | "CHECKING" | "OWNED" | "LOCAL_ONLY" | "OFFLINE_PREVIOUS" | "OFFLINE_CONFIRM"
  | "OFFLINE_UNVERIFIED" | "OCCUPIED" | "LOST" | "ACCESS_REVOKED" | "ERROR" | "RELEASED";

export interface CaptureControlView {
  status: CaptureControlStatus;
  canCapture: boolean;
  occupiedBy?: MatchCaptureLease;
  message?: string;
  beginOfflineRisk(): void;
  retry(): void;
  takeover(): Promise<void>;
  prepareToLeave(): Promise<void>;
}

function permissionError(error: unknown): boolean {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  return code.includes("permission-denied") || code.includes("unauthenticated");
}

export function useCaptureLease(matchId: string, match: MatchSession | undefined): CaptureControlView {
  const { grant } = useAccess();
  const config = useMemo(() => firebaseDevConfigStatus(), []);
  const eligible = isRemoteSyncEligibleMatch(matchId);
  const localRef = useRef<LocalCaptureSession | null>(null);
  const mountedRef = useRef(true);
  const [status, setStatus] = useState<CaptureControlStatus>(eligible ? "CHECKING" : "LOCAL_ONLY");
  const [occupiedBy, setOccupiedBy] = useState<MatchCaptureLease | undefined>();
  const [message, setMessage] = useState<string>();

  const applyResult = useCallback((result: CaptureAcquireResult) => {
    if (!mountedRef.current) return;
    if (result.status === "OCCUPIED") { setOccupiedBy(result.lease); setStatus("OCCUPIED"); setMessage(undefined); return; }
    if (result.status === "DENIED") { setStatus("ERROR"); setMessage(result.reason); return; }
    setOccupiedBy(undefined); setStatus("OWNED"); setMessage(undefined);
  }, []);

  const acquire = useCallback(async (takeover = false) => {
    const local = localRef.current;
    if (!local) return;
    setRuntimeCaptureContext(matchId, { captureSessionId: local.captureSessionId, accessId: local.accessId, deviceInstallId: local.deviceInstallId, syncAllowed: false, mode: local.mode });
    if (!navigator.onLine || grant.offline || !config.configured) {
      if (local.mode === "VERIFIED") setStatus("OFFLINE_PREVIOUS");
      else setStatus("OFFLINE_CONFIRM");
      return;
    }
    setStatus("CHECKING");
    try {
      await syncMatchNow(matchId);
      const result = await verifyLocalCaptureSession(local, grant, takeover);
      applyResult(result);
      if (result.status === "ACQUIRED" || result.status === "RESUMED" || result.status === "TAKEN_OVER") {
        await syncMatchNow(matchId);
      }
    } catch (error) {
      if (!mountedRef.current) return;
      if (permissionError(error)) setStatus("ACCESS_REVOKED");
      else { setStatus("ERROR"); setMessage(error instanceof Error ? error.message : "No se pudo comprobar el control del partido."); }
    }
  }, [applyResult, config.configured, grant, matchId]);

  useEffect(() => {
    mountedRef.current = true;
    if (!match?.preparation?.clubId || !match.preparation.teamId) return;
    if (!eligible) { setStatus("LOCAL_ONLY"); return; }
    try {
      const local = beginLocalCaptureSession({ matchId, clubId: match.preparation.clubId, teamId: match.preparation.teamId, grant });
      localRef.current = local;
      void acquire(false);
    } catch (error) {
      setStatus("ERROR"); setMessage(error instanceof Error ? error.message : "No se pudo preparar la captura.");
    }
    return () => { mountedRef.current = false; };
  }, [acquire, eligible, grant, match?.preparation?.clubId, match?.preparation?.teamId, matchId]);

  useEffect(() => {
    if (!eligible) return;
    const online = () => void acquire(false);
    const offline = () => {
      const local = localRef.current;
      if (!local) return;
      setRuntimeCaptureContext(matchId, { captureSessionId: local.captureSessionId, accessId: local.accessId, deviceInstallId: local.deviceInstallId, syncAllowed: false, mode: local.mode });
      setStatus(local.mode === "VERIFIED" ? "OFFLINE_PREVIOUS" : "OFFLINE_CONFIRM");
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, [acquire, eligible, matchId]);

  useEffect(() => {
    if (status !== "OWNED" || !localRef.current) return;
    const heartbeat = async () => {
      const local = localRef.current;
      if (!local || !navigator.onLine) return;
      try {
        const next = await heartbeatLocalCaptureSession(local, grant);
        if (next === "LOST") { setStatus("LOST"); setMessage("Otro dispositivo controla ahora este partido."); }
      } catch (error) {
        if (permissionError(error)) setStatus("ACCESS_REVOKED");
        else if (!navigator.onLine) setStatus("OFFLINE_PREVIOUS");
        else setMessage(error instanceof Error ? error.message : "No se pudo renovar el control.");
      }
    };
    const interval = window.setInterval(() => void heartbeat(), CAPTURE_HEARTBEAT_MS);
    const visible = () => { if (document.visibilityState === "visible") void heartbeat(); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [grant, status]);

  useEffect(() => {
    if (!match?.matchFinished || status !== "OWNED") return;
    const releaseWhenClean = () => {
      const state = browserMatchRepository.getSyncState(matchId);
      if (state.outbox.some(blocksAccessChange)) return;
      const local = localRef.current;
      if (local && navigator.onLine) void releaseLocalCaptureSession(local, grant).then(() => setStatus("RELEASED"));
    };
    releaseWhenClean();
    return browserMatchRepository.subscribe(matchId, releaseWhenClean);
  }, [grant, match?.matchFinished, matchId, status]);

  const canCapture = ["OWNED", "LOCAL_ONLY", "OFFLINE_PREVIOUS", "OFFLINE_UNVERIFIED"].includes(status);
  return {
    status, canCapture, occupiedBy, message,
    beginOfflineRisk() {
      const local = localRef.current;
      if (!local) return;
      const next = updateLocalCaptureMode(local, "UNVERIFIED"); localRef.current = next;
      setRuntimeCaptureContext(matchId, { captureSessionId: next.captureSessionId, accessId: next.accessId, deviceInstallId: next.deviceInstallId, syncAllowed: false, mode: "UNVERIFIED" });
      setStatus("OFFLINE_UNVERIFIED");
    },
    retry() { void acquire(false); },
    async takeover() { await acquire(true); },
    async prepareToLeave() {
      const local = localRef.current;
      if (!local || status !== "OWNED" || !navigator.onLine) return;
      await syncMatchNow(matchId);
      if (browserMatchRepository.getSyncState(matchId).outbox.some(blocksAccessChange)) return;
      await releaseLocalCaptureSession(local, grant); setStatus("RELEASED");
    },
  };
}

export function captureSyncReady(matchId: string, captureSessionId?: string): boolean {
  return captureOperationCanSync(matchId, captureSessionId);
}
