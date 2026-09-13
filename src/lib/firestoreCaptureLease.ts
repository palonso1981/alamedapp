import { doc, runTransaction, Timestamp } from "firebase/firestore";

import { getFirebaseDevServices } from "./firebase";
import {
  CAPTURE_LEASE_TTL_MS,
  CaptureAcquireResult,
  CaptureLeaseRepository,
  CaptureLeaseRequest,
  MatchCaptureLease,
  isLeaseStale,
} from "./captureLease";

function numberFromTimestamp(value: unknown): number {
  return value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function"
    ? value.toMillis()
    : typeof value === "number" ? value : 0;
}

function parseLease(value: Record<string, unknown> | undefined): MatchCaptureLease | null {
  if (!value || value.entityType !== "CAPTURE_LEASE" || typeof value.matchId !== "string" ||
      typeof value.clubId !== "string" || typeof value.teamId !== "string" ||
      typeof value.captureSessionId !== "string" || typeof value.accessId !== "string" ||
      typeof value.deviceInstallId !== "string" || !["ACTIVE", "RELEASED"].includes(String(value.status))) return null;
  return {
    entityType: "CAPTURE_LEASE", matchId: value.matchId, clubId: value.clubId, teamId: value.teamId,
    captureSessionId: value.captureSessionId, accessId: value.accessId, deviceInstallId: value.deviceInstallId,
    status: value.status as MatchCaptureLease["status"], acquiredAt: numberFromTimestamp(value.acquiredAt),
    lastSeenAt: numberFromTimestamp(value.lastSeenAt), expiresAt: numberFromTimestamp(value.expiresAt),
    revision: typeof value.revision === "number" ? value.revision : 0,
  };
}

function firestoreLease(lease: MatchCaptureLease): Record<string, unknown> {
  return {
    ...lease,
    acquiredAt: Timestamp.fromMillis(lease.acquiredAt),
    lastSeenAt: Timestamp.fromMillis(lease.lastSeenAt),
    expiresAt: Timestamp.fromMillis(lease.expiresAt),
  };
}

function assertMatchScope(match: Record<string, unknown> | undefined, request: CaptureLeaseRequest): void {
  const payload = match?.payload as { preparation?: { clubId?: string; teamId?: string } } | undefined;
  if (payload?.preparation?.clubId !== request.clubId || payload.preparation.teamId !== request.teamId) {
    throw Object.assign(new Error("El lease no coincide con el club/equipo del partido."), { code: "invalid-argument" });
  }
}

export class FirestoreCaptureLeaseRepository implements CaptureLeaseRepository {
  async acquire(request: CaptureLeaseRequest, options: { takeover?: boolean } = {}): Promise<CaptureAcquireResult> {
    if (request.role === "VIEWER") return { status: "DENIED", reason: "VIEWER no puede controlar un partido." };
    const { db } = await getFirebaseDevServices();
    const leaseRef = doc(db, "matchCaptureLeases", request.matchId);
    const matchRef = doc(db, "matches", request.matchId);
    return runTransaction(db, async (transaction) => {
      const [matchSnapshot, leaseSnapshot] = await Promise.all([transaction.get(matchRef), transaction.get(leaseRef)]);
      if (!matchSnapshot.exists()) throw Object.assign(new Error("El partido todavía no existe en Firebase DEV."), { code: "failed-precondition" });
      assertMatchScope(matchSnapshot.data(), request);
      const current = leaseSnapshot.exists() ? parseLease(leaseSnapshot.data()) : null;
      const now = Date.now();
      const same = current?.status === "ACTIVE" && current.captureSessionId === request.captureSessionId && current.deviceInstallId === request.deviceInstallId;
      if (current && !isLeaseStale(current, now) && !same && !options.takeover) return { status: "OCCUPIED", lease: current };
      const lease: MatchCaptureLease = {
        entityType: "CAPTURE_LEASE", matchId: request.matchId, clubId: request.clubId, teamId: request.teamId,
        captureSessionId: request.captureSessionId, accessId: request.accessId, deviceInstallId: request.deviceInstallId,
        status: "ACTIVE", acquiredAt: same ? current.acquiredAt : now, lastSeenAt: now,
        expiresAt: now + CAPTURE_LEASE_TTL_MS, revision: (current?.revision ?? 0) + 1,
      };
      transaction.set(leaseRef, firestoreLease(lease));
      return { status: same ? "RESUMED" : current && !isLeaseStale(current, now) ? "TAKEN_OVER" : "ACQUIRED", lease };
    });
  }

  async heartbeat(request: CaptureLeaseRequest): Promise<{ status: "ACTIVE" | "LOST"; lease?: MatchCaptureLease }> {
    const { db } = await getFirebaseDevServices();
    const reference = doc(db, "matchCaptureLeases", request.matchId);
    return runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists() ? parseLease(snapshot.data()) : null;
      if (!current || current.status !== "ACTIVE" || current.captureSessionId !== request.captureSessionId || current.deviceInstallId !== request.deviceInstallId) {
        return { status: "LOST", lease: current ?? undefined };
      }
      const now = Date.now();
      const next = { ...current, lastSeenAt: now, expiresAt: now + CAPTURE_LEASE_TTL_MS, revision: current.revision + 1 };
      transaction.set(reference, firestoreLease(next));
      return { status: "ACTIVE", lease: next };
    });
  }

  async release(request: CaptureLeaseRequest): Promise<{ status: "RELEASED" | "LOST"; lease?: MatchCaptureLease }> {
    const { db } = await getFirebaseDevServices();
    const reference = doc(db, "matchCaptureLeases", request.matchId);
    return runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists() ? parseLease(snapshot.data()) : null;
      if (!current || current.status !== "ACTIVE" || current.captureSessionId !== request.captureSessionId || current.deviceInstallId !== request.deviceInstallId) {
        return { status: "LOST", lease: current ?? undefined };
      }
      const now = Date.now();
      const next = { ...current, status: "RELEASED" as const, lastSeenAt: now, expiresAt: now, revision: current.revision + 1 };
      transaction.set(reference, firestoreLease(next));
      return { status: "RELEASED", lease: next };
    });
  }

  async read(matchId: string): Promise<MatchCaptureLease | null> {
    const { getDoc } = await import("firebase/firestore");
    const { db } = await getFirebaseDevServices();
    const snapshot = await getDoc(doc(db, "matchCaptureLeases", matchId));
    return snapshot.exists() ? parseLease(snapshot.data()) : null;
  }
}
