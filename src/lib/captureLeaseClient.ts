import { ActiveAccessGrant } from "./access/accessDomain";
import { CaptureAcquireResult, CaptureLeaseRepository, LocalCaptureSession, captureRequest, listLocalCaptureSessions, setRuntimeCaptureContext, updateLocalCaptureMode } from "./captureLease";
import { browserMatchRepository } from "./sync/localMatchRepository";

let remoteRepository: CaptureLeaseRepository | null = null;

async function remote(): Promise<CaptureLeaseRepository> {
  if (!remoteRepository) {
    const { FirestoreCaptureLeaseRepository } = await import("./firestoreCaptureLease");
    remoteRepository = new FirestoreCaptureLeaseRepository();
  }
  return remoteRepository;
}

function verifiedContext(session: LocalCaptureSession) {
  return { captureSessionId: session.captureSessionId, accessId: session.accessId, deviceInstallId: session.deviceInstallId, syncAllowed: true, mode: "VERIFIED" as const };
}

export async function verifyLocalCaptureSession(session: LocalCaptureSession, grant: ActiveAccessGrant, takeover = false): Promise<CaptureAcquireResult> {
  setRuntimeCaptureContext(session.matchId, { ...verifiedContext(session), syncAllowed: false, mode: session.mode });
  const result = await (await remote()).acquire(captureRequest(session, grant), { takeover });
  if (result.status === "ACQUIRED" || result.status === "RESUMED" || result.status === "TAKEN_OVER") {
    const verified = updateLocalCaptureMode(session, "VERIFIED");
    setRuntimeCaptureContext(session.matchId, verifiedContext(verified));
  } else {
    const lost = updateLocalCaptureMode(session, result.status === "OCCUPIED" ? "LOST" : session.mode);
    setRuntimeCaptureContext(session.matchId, { captureSessionId: lost.captureSessionId, accessId: lost.accessId, deviceInstallId: lost.deviceInstallId, syncAllowed: false, mode: lost.mode });
    if (result.status === "OCCUPIED") browserMatchRepository.markCaptureSessionLost(session.matchId, session.captureSessionId, result.lease);
  }
  return result;
}

export async function heartbeatLocalCaptureSession(session: LocalCaptureSession, grant: ActiveAccessGrant): Promise<"ACTIVE" | "LOST"> {
  const result = await (await remote()).heartbeat(captureRequest(session, grant));
  if (result.status === "ACTIVE") {
    const verified = updateLocalCaptureMode(session, "VERIFIED");
    setRuntimeCaptureContext(session.matchId, verifiedContext(verified));
  } else {
    const lost = updateLocalCaptureMode(session, "LOST");
    setRuntimeCaptureContext(session.matchId, { captureSessionId: lost.captureSessionId, accessId: lost.accessId, deviceInstallId: lost.deviceInstallId, syncAllowed: false, mode: "LOST" });
    browserMatchRepository.markCaptureSessionLost(session.matchId, session.captureSessionId, result.lease);
  }
  return result.status;
}

export async function releaseLocalCaptureSession(session: LocalCaptureSession, grant: ActiveAccessGrant): Promise<"RELEASED" | "LOST"> {
  const result = await (await remote()).release(captureRequest(session, grant));
  const mode = result.status === "RELEASED" ? "RELEASED" : "LOST";
  updateLocalCaptureMode(session, mode);
  setRuntimeCaptureContext(session.matchId, null);
  return result.status;
}

export async function releaseOwnedCaptureLeases(grant: ActiveAccessGrant): Promise<void> {
  const sessions = listLocalCaptureSessions().filter((session) =>
    session.mode === "VERIFIED" && session.accessId === grant.profile.accessId && session.deviceInstallId === grant.deviceInstallId,
  );
  if (sessions.length === 0) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("Conéctate para liberar el control de los partidos antes de cambiar de acceso.");
  for (const session of sessions) await releaseLocalCaptureSession(session, grant);
}

export function setCaptureRemoteForTests(repository: CaptureLeaseRepository | null): void {
  remoteRepository = repository;
}
