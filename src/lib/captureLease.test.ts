import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ActiveAccessGrant, ClubAccessProfile } from "./access/accessDomain";
import { AccessStorage } from "./access/accessPersistence";
import {
  CAPTURE_LEASE_TTL_MS,
  InMemoryCaptureLeaseRepository,
  beginLocalCaptureSession,
  captureOperationCanSync,
  captureRequest,
  leaseAllowsCaptureOperation,
  loadLocalCaptureSession,
  resetRuntimeCaptureContextsForTests,
  setRuntimeCaptureContext,
  updateLocalCaptureMode,
} from "./captureLease";
import { saveMatchRecord } from "./matchPersistence";
import { createMatchRecoveryBundle } from "./recoveryBundle";
import { emptyMatchSyncState } from "./sync/syncTypes";
import { createSession } from "../store/useMatchStore";

class MemoryStorage implements AccessStorage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
}

function grant(role: ClubAccessProfile["role"], accessId: string, deviceInstallId: string): ActiveAccessGrant {
  return {
    uid: `uid-${accessId}`,
    deviceInstallId,
    credentialVersion: 1,
    lastValidatedAt: 1,
    offline: false,
    profile: {
      accessId,
      clubId: "club-a",
      label: accessId,
      role,
      scope: { type: "CLUB" },
      status: "ACTIVE",
      credentialVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  };
}

function request(matchId: string, access: ActiveAccessGrant, captureSessionId: string) {
  return {
    matchId,
    clubId: "club-a",
    teamId: "team-a",
    captureSessionId,
    accessId: access.profile.accessId,
    deviceInstallId: access.deviceInstallId,
    role: access.profile.role,
  } as const;
}

test("RC2: un partido admite un único escritor pero partidos distintos son independientes", async () => {
  let now = 1_000;
  const repository = new InMemoryCaptureLeaseRepository(() => now);
  const adminA = grant("ADMIN", "access-a", "device-a");
  const editorB = grant("EDITOR", "access-b", "device-b");

  assert.equal((await repository.acquire(request("match-1", adminA, "capture-a"))).status, "ACQUIRED");
  assert.equal((await repository.acquire(request("match-1", adminA, "capture-a"))).status, "RESUMED");
  assert.equal((await repository.acquire(request("match-1", editorB, "capture-b"))).status, "OCCUPIED");
  assert.equal((await repository.acquire(request("match-2", editorB, "capture-c"))).status, "ACQUIRED");
  assert.equal((await repository.read("match-1"))?.captureSessionId, "capture-a");
  assert.equal((await repository.read("match-2"))?.captureSessionId, "capture-c");

  now += CAPTURE_LEASE_TTL_MS + 1;
  assert.equal((await repository.acquire(request("match-1", editorB, "capture-b"))).status, "ACQUIRED");
});

test("RC2: el relevo explícito conserva identidad técnica y el anterior pierde control", async () => {
  const repository = new InMemoryCaptureLeaseRepository(() => 2_000);
  const first = grant("EDITOR", "access-a", "device-a");
  const second = grant("EDITOR", "access-b", "device-b");
  await repository.acquire(request("match-1", first, "capture-a"));
  const takeover = await repository.acquire(request("match-1", second, "capture-b"), { takeover: true });
  assert.equal(takeover.status, "TAKEN_OVER");
  assert.equal(takeover.lease.captureSessionId, "capture-b");
  assert.equal((await repository.heartbeat(request("match-1", first, "capture-a"))).status, "LOST");
  assert.equal((await repository.release(request("match-1", second, "capture-b"))).status, "RELEASED");
});

test("RC2: VIEWER nunca adquiere control", async () => {
  const repository = new InMemoryCaptureLeaseRepository();
  const viewer = grant("VIEWER", "viewer", "device-viewer");
  assert.equal((await repository.acquire(request("match-1", viewer, "capture-v"))).status, "DENIED");
});

test("RC2: una carrera simultánea concede un solo control", async () => {
  const repository = new InMemoryCaptureLeaseRepository(() => 3_000);
  const sharedA = grant("EDITOR", "shared", "device-a");
  const sharedB = grant("EDITOR", "shared", "device-b");
  const results = await Promise.all([
    repository.acquire(request("match-race", sharedA, "capture-a")),
    repository.acquire(request("match-race", sharedB, "capture-b")),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["ACQUIRED", "OCCUPIED"]);
});

test("RC2: consultar un partido no altera ni adquiere su lease", async () => {
  const repository = new InMemoryCaptureLeaseRepository(() => 4_000);
  const editor = grant("EDITOR", "editor", "device-a");
  await repository.acquire(request("match-read", editor, "capture-a"));
  const before = await repository.read("match-read");
  const viewerRead = await repository.read("match-read");
  assert.deepEqual(viewerRead, before);
  assert.equal(repository.leases.size, 1);
  assert.equal(viewerRead?.revision, 1);
});

test("RC2: sesión local sobrevive cierre offline y no sincroniza hasta verificarse", () => {
  const storage = new MemoryStorage();
  const admin = grant("ADMIN", "access-a", "device-a");
  const created = beginLocalCaptureSession({
    matchId: "match-offline", clubId: "club-a", teamId: "team-a", grant: admin,
    storage, now: 100, idFactory: () => "capture-stable",
  });
  const verified = updateLocalCaptureMode(created, "VERIFIED", 110, storage);
  const reopened = loadLocalCaptureSession("match-offline", storage);
  assert.deepEqual(reopened, verified);

  resetRuntimeCaptureContextsForTests();
  setRuntimeCaptureContext("match-offline", {
    captureSessionId: "capture-stable", accessId: "access-a", deviceInstallId: "device-a",
    mode: "VERIFIED", syncAllowed: false,
  });
  assert.equal(captureOperationCanSync("match-offline", "capture-stable"), false);
  setRuntimeCaptureContext("match-offline", {
    captureSessionId: "capture-stable", accessId: "access-a", deviceInstallId: "device-a",
    mode: "VERIFIED", syncAllowed: true,
  });
  assert.equal(captureOperationCanSync("match-offline", "capture-stable"), true);
  assert.equal(captureOperationCanSync("match-offline", "otra-sesion"), false);
  resetRuntimeCaptureContextsForTests();
});

test("RC2: el lease decide por matchId y captureSessionId, nunca por el eventId deportivo", async () => {
  const repository = new InMemoryCaptureLeaseRepository(() => 5_000);
  const admin = grant("ADMIN", "access-a", "device-a");
  const local = beginLocalCaptureSession({
    matchId: "match-1", clubId: "club-a", teamId: "team-a", grant: admin,
    storage: new MemoryStorage(), now: 5_000, idFactory: () => "capture-a",
  });
  await repository.acquire(captureRequest(local, admin));
  const lease = await repository.read("match-1");
  assert.equal(leaseAllowsCaptureOperation({ matchId: "match-1", captureSessionId: "capture-a" }, lease), true);
  assert.equal(leaseAllowsCaptureOperation({ matchId: "match-1", captureSessionId: "capture-b" }, lease), false);
  assert.equal(leaseAllowsCaptureOperation({ matchId: "match-1" }, lease), true);
});

test("RC2: el bundle de recuperación conserva eventos, outbox, revisiones y captura sin mutar", () => {
  const storage = new MemoryStorage();
  const session = createSession("recovery-match");
  const admin = grant("ADMIN", "access-a", "device-a");
  const capture = beginLocalCaptureSession({
    matchId: session.matchId, clubId: "club-a", teamId: "team-a", grant: admin,
    storage, now: 20, idFactory: () => "capture-recovery",
  });
  const sync = emptyMatchSyncState();
  sync.knownRemoteRevisions = { match: 3, [`event:${session.events[0].id}`]: 2 };
  sync.outbox.push({
    id: "operation-stable", matchId: session.matchId, entityType: "EVENT", entityId: session.events[0].id,
    kind: "UPSERT", payload: session.events[0], baseRevision: 2, clientUpdatedAt: 21,
    attempts: 1, status: "ERROR", nextAttemptAt: Number.MAX_SAFE_INTEGER,
    errorKind: "PERMISSION", lastError: "revocado", captureSessionId: capture.captureSessionId,
    captureAccessId: capture.accessId, captureDeviceInstallId: capture.deviceInstallId,
  });
  sync.conflicts.push({
    operationId: "operation-stable",
    entityKey: `event:${session.events[0].id}`,
    detectedAt: 22,
    localPayload: session.events[0],
    remoteRevision: 3,
    remotePayload: { id: session.events[0].id, remote: true },
  });
  assert.equal(saveMatchRecord(session, sync, storage, 22).ok, true);
  const before = storage.getItem(`alamedapp:match:v1:${encodeURIComponent(session.matchId)}`);
  const bundle = createMatchRecoveryBundle(session.matchId, storage, 23);
  assert.equal(bundle.matchId, session.matchId);
  assert.equal(bundle.session.matchId, session.matchId);
  assert.equal(bundle.session.events[0].id, session.events[0].id);
  assert.equal(bundle.sync.outbox[0].id, "operation-stable");
  assert.equal(bundle.sync.outbox[0].captureSessionId, "capture-recovery");
  assert.equal(bundle.sync.knownRemoteRevisions.match, 3);
  assert.equal(bundle.sync.conflicts[0].operationId, "operation-stable");
  assert.equal(bundle.sync.conflicts[0].entityKey, `event:${session.events[0].id}`);
  assert.equal(bundle.sync.conflicts[0].remoteRevision, 3);
  assert.equal(bundle.captureSession?.captureSessionId, "capture-recovery");
  const serialized = JSON.stringify(bundle);
  assert.doesNotMatch(serialized, /accessCode|codeHash|plaintext/i);
  assert.equal(storage.getItem(`alamedapp:match:v1:${encodeURIComponent(session.matchId)}`), before);
});

test("RC2 UX: OCCUPIED mantiene salidas explícitas sin depender del botón Atrás", () => {
  const component = readFileSync("src/components/match/CaptureControlStatus.tsx", "utf8");
  assert.match(component, /Navegación disponible con Directo bloqueado/);
  assert.match(component, /href="\/partidos"/);
  assert.match(component, /href="\/dashboard"/);
  assert.match(component, /href="\/plantilla"/);
  assert.match(component, /`\/partido\/\$\{matchId\}\/revision`/);
  assert.match(component, /`\/partidos\/\$\{matchId\}\/video`/);
  assert.match(component, /TOMAR CONTROL DEL PARTIDO/);
});
