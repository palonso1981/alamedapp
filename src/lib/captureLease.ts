import { ActiveAccessGrant, canAccessTeam, canMutateSports } from "./access/accessDomain";
import { AccessStorage, browserAccessStorage } from "./access/accessPersistence";

export const CAPTURE_HEARTBEAT_MS = 60_000;
export const CAPTURE_LEASE_TTL_MS = 180_000;
export const CAPTURE_LOCAL_SCHEMA_VERSION = 1 as const;
const CAPTURE_STORAGE_PREFIX = "alamedapp:capture:rc2:v1";

export type CaptureLeaseStatus = "ACTIVE" | "RELEASED";
export type LocalCaptureMode = "VERIFIED" | "UNVERIFIED" | "LOST" | "RELEASED";

export interface MatchCaptureLease {
  entityType: "CAPTURE_LEASE";
  matchId: string;
  clubId: string;
  teamId: string;
  captureSessionId: string;
  accessId: string;
  deviceInstallId: string;
  status: CaptureLeaseStatus;
  acquiredAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revision: number;
}

export interface LocalCaptureSession {
  schemaVersion: typeof CAPTURE_LOCAL_SCHEMA_VERSION;
  matchId: string;
  clubId: string;
  teamId: string;
  captureSessionId: string;
  accessId: string;
  deviceInstallId: string;
  acquiredAt: number;
  lastSeenAt: number;
  mode: LocalCaptureMode;
}

export interface CaptureLeaseRequest {
  matchId: string;
  clubId: string;
  teamId: string;
  captureSessionId: string;
  accessId: string;
  deviceInstallId: string;
  role: ActiveAccessGrant["profile"]["role"];
}

export type CaptureAcquireResult =
  | { status: "ACQUIRED" | "RESUMED" | "TAKEN_OVER"; lease: MatchCaptureLease }
  | { status: "OCCUPIED"; lease: MatchCaptureLease }
  | { status: "DENIED"; reason: string };

export interface CaptureLeaseRepository {
  acquire(request: CaptureLeaseRequest, options?: { takeover?: boolean }): Promise<CaptureAcquireResult>;
  heartbeat(request: CaptureLeaseRequest): Promise<{ status: "ACTIVE" | "LOST"; lease?: MatchCaptureLease }>;
  release(request: CaptureLeaseRequest): Promise<{ status: "RELEASED" | "LOST"; lease?: MatchCaptureLease }>;
  read(matchId: string): Promise<MatchCaptureLease | null>;
}

export function captureStorageKey(matchId: string): string {
  return `${CAPTURE_STORAGE_PREFIX}:${matchId}`;
}

function validLocalCapture(value: unknown, matchId: string): value is LocalCaptureSession {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LocalCaptureSession>;
  return item.schemaVersion === CAPTURE_LOCAL_SCHEMA_VERSION && item.matchId === matchId &&
    typeof item.clubId === "string" && typeof item.teamId === "string" &&
    typeof item.captureSessionId === "string" && typeof item.accessId === "string" &&
    typeof item.deviceInstallId === "string" && typeof item.acquiredAt === "number" &&
    typeof item.lastSeenAt === "number" && ["VERIFIED", "UNVERIFIED", "LOST", "RELEASED"].includes(String(item.mode));
}

export function loadLocalCaptureSession(matchId: string, storage: AccessStorage | null = browserAccessStorage()): LocalCaptureSession | null {
  if (!storage) return null;
  try {
    const value: unknown = JSON.parse(storage.getItem(captureStorageKey(matchId)) ?? "null");
    return validLocalCapture(value, matchId) ? value : null;
  } catch { return null; }
}

export function saveLocalCaptureSession(session: LocalCaptureSession, storage: AccessStorage | null = browserAccessStorage()): void {
  storage?.setItem(captureStorageKey(session.matchId), JSON.stringify(session));
}

export function listLocalCaptureSessions(storage: AccessStorage | null = browserAccessStorage()): LocalCaptureSession[] {
  if (!storage?.key || typeof storage.length !== "number") return [];
  const result: LocalCaptureSession[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(`${CAPTURE_STORAGE_PREFIX}:`)) continue;
    const matchId = key.slice(CAPTURE_STORAGE_PREFIX.length + 1);
    const session = loadLocalCaptureSession(matchId, storage);
    if (session) result.push(session);
  }
  return result;
}

export function beginLocalCaptureSession(input: {
  matchId: string;
  clubId: string;
  teamId: string;
  grant: ActiveAccessGrant;
  now?: number;
  idFactory?: () => string;
  storage?: AccessStorage | null;
}): LocalCaptureSession {
  if (!canMutateSports(input.grant) || !canAccessTeam(input.grant, input.clubId, input.teamId)) {
    throw new Error("Este acceso no puede controlar la captura de este partido.");
  }
  const storage = input.storage === undefined ? browserAccessStorage() : input.storage;
  const existing = loadLocalCaptureSession(input.matchId, storage);
  if (existing && existing.mode !== "LOST" && existing.mode !== "RELEASED" &&
      existing.accessId === input.grant.profile.accessId && existing.deviceInstallId === input.grant.deviceInstallId &&
      existing.clubId === input.clubId && existing.teamId === input.teamId) return existing;
  const now = input.now ?? Date.now();
  const session: LocalCaptureSession = {
    schemaVersion: CAPTURE_LOCAL_SCHEMA_VERSION,
    matchId: input.matchId,
    clubId: input.clubId,
    teamId: input.teamId,
    captureSessionId: (input.idFactory ?? (() => globalThis.crypto.randomUUID()))(),
    accessId: input.grant.profile.accessId,
    deviceInstallId: input.grant.deviceInstallId,
    acquiredAt: now,
    lastSeenAt: now,
    mode: "UNVERIFIED",
  };
  saveLocalCaptureSession(session, storage);
  return session;
}

export function updateLocalCaptureMode(session: LocalCaptureSession, mode: LocalCaptureMode, now = Date.now(), storage: AccessStorage | null = browserAccessStorage()): LocalCaptureSession {
  const next = { ...session, mode, lastSeenAt: now };
  saveLocalCaptureSession(next, storage);
  return next;
}

export function captureRequest(session: LocalCaptureSession, grant: ActiveAccessGrant): CaptureLeaseRequest {
  return {
    matchId: session.matchId, clubId: session.clubId, teamId: session.teamId,
    captureSessionId: session.captureSessionId, accessId: grant.profile.accessId,
    deviceInstallId: session.deviceInstallId, role: grant.profile.role,
  };
}

export function isLeaseStale(lease: MatchCaptureLease, now = Date.now()): boolean {
  return lease.status !== "ACTIVE" || lease.expiresAt <= now;
}

export interface RuntimeCaptureContext {
  captureSessionId: string;
  accessId: string;
  deviceInstallId: string;
  syncAllowed: boolean;
  mode: LocalCaptureMode;
}

const runtimeCapture = new Map<string, RuntimeCaptureContext>();

export function setRuntimeCaptureContext(matchId: string, context: RuntimeCaptureContext | null): void {
  if (context) runtimeCapture.set(matchId, context);
  else runtimeCapture.delete(matchId);
}

export function getRuntimeCaptureContext(matchId: string): RuntimeCaptureContext | null {
  return runtimeCapture.get(matchId) ?? null;
}

export function captureOperationCanSync(matchId: string, captureSessionId?: string): boolean {
  if (!captureSessionId) return true;
  const context = runtimeCapture.get(matchId);
  return Boolean(context?.syncAllowed && context.captureSessionId === captureSessionId && context.mode === "VERIFIED");
}

export function resetRuntimeCaptureContextsForTests(): void {
  runtimeCapture.clear();
}

export function leaseAllowsCaptureOperation(operation: { matchId: string; captureSessionId?: string }, lease: MatchCaptureLease | null): boolean {
  if (!operation.captureSessionId) return true;
  return Boolean(lease && lease.matchId === operation.matchId && lease.status === "ACTIVE" && lease.captureSessionId === operation.captureSessionId);
}

export class InMemoryCaptureLeaseRepository implements CaptureLeaseRepository {
  readonly leases = new Map<string, MatchCaptureLease>();
  constructor(private readonly now: () => number = Date.now) {}

  async acquire(request: CaptureLeaseRequest, options: { takeover?: boolean } = {}): Promise<CaptureAcquireResult> {
    if (request.role === "VIEWER") return { status: "DENIED", reason: "VIEWER no puede controlar un partido." };
    const now = this.now();
    const current = this.leases.get(request.matchId);
    const same = current?.status === "ACTIVE" && current.captureSessionId === request.captureSessionId && current.deviceInstallId === request.deviceInstallId;
    if (current && !isLeaseStale(current, now) && !same && !options.takeover) return { status: "OCCUPIED", lease: structuredClone(current) };
    const lease: MatchCaptureLease = {
      entityType: "CAPTURE_LEASE", matchId: request.matchId, clubId: request.clubId, teamId: request.teamId,
      captureSessionId: request.captureSessionId, accessId: request.accessId, deviceInstallId: request.deviceInstallId,
      status: "ACTIVE", acquiredAt: same ? current.acquiredAt : now, lastSeenAt: now,
      expiresAt: now + CAPTURE_LEASE_TTL_MS, revision: (current?.revision ?? 0) + 1,
    };
    this.leases.set(request.matchId, lease);
    return { status: same ? "RESUMED" : current && !isLeaseStale(current, now) ? "TAKEN_OVER" : "ACQUIRED", lease: structuredClone(lease) };
  }

  async heartbeat(request: CaptureLeaseRequest): Promise<{ status: "ACTIVE" | "LOST"; lease?: MatchCaptureLease }> {
    const current = this.leases.get(request.matchId);
    if (!current || current.status !== "ACTIVE" || current.captureSessionId !== request.captureSessionId || current.deviceInstallId !== request.deviceInstallId) {
      return { status: "LOST", lease: current ? structuredClone(current) : undefined };
    }
    const now = this.now();
    const next = { ...current, lastSeenAt: now, expiresAt: now + CAPTURE_LEASE_TTL_MS, revision: current.revision + 1 };
    this.leases.set(request.matchId, next);
    return { status: "ACTIVE", lease: structuredClone(next) };
  }

  async release(request: CaptureLeaseRequest): Promise<{ status: "RELEASED" | "LOST"; lease?: MatchCaptureLease }> {
    const current = this.leases.get(request.matchId);
    if (!current || current.status !== "ACTIVE" || current.captureSessionId !== request.captureSessionId || current.deviceInstallId !== request.deviceInstallId) {
      return { status: "LOST", lease: current ? structuredClone(current) : undefined };
    }
    const now = this.now();
    const next = { ...current, status: "RELEASED" as const, lastSeenAt: now, expiresAt: now, revision: current.revision + 1 };
    this.leases.set(request.matchId, next);
    return { status: "RELEASED", lease: structuredClone(next) };
  }

  async read(matchId: string): Promise<MatchCaptureLease | null> {
    const lease = this.leases.get(matchId);
    return lease ? structuredClone(lease) : null;
  }
}
