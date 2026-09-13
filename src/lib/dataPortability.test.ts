import assert from "node:assert/strict";
import test from "node:test";

import {
  BackupBundle,
  LogicalDataset,
  applyLogicalRestore,
  backupDocuments,
  createLogicalBackup,
  createSelectiveMatchBundle,
  matchBundleDocuments,
  planLogicalRestore,
  validateBackupBundle,
  validateLogicalDataset,
} from "./dataPortability";
import { assertExpectedEnvironment, inspectApplicationEnvironment } from "./environmentSafety";

function dataset(): LogicalDataset {
  const clubId = "cd-alameda";
  const teamId = "senior-a";
  const seasonId = "2026-27";
  const matchId = "chelva-real";
  return {
    schemaVersion: 1,
    kind: "ALAMEDAPP_LOGICAL_DATASET",
    environment: "dev",
    projectId: "cdalameda-dev",
    documents: [
      { path: "clubs/" + clubId, payload: { clubId, name: "Club Deportivo Alameda", updatedAt: 1 } },
      { path: "clubs/" + clubId + "/teams/" + teamId, payload: { clubId, teamId, name: "Senior A", updatedAt: 1 } },
      { path: "clubs/" + clubId + "/teams/" + teamId + "/seasons/" + seasonId, payload: { clubId, teamId, seasonId, label: "2026-27", updatedAt: 1 } },
      { path: "clubs/" + clubId + "/players/p1", payload: { clubId, playerId: "p1", displayName: "Uno", updatedAt: 1, managedPhoto: { provider: "CLOUDINARY", publicId: "players/p1", secureUrl: "https://res.cloudinary.com/x/image/upload/p1.webp", version: 4 } } },
      { path: "clubs/" + clubId + "/players/p2", payload: { clubId, playerId: "p2", displayName: "Dos", updatedAt: 1 } },
      { path: "clubs/" + clubId + "/players/not-used", payload: { clubId, playerId: "not-used", displayName: "No convocado", updatedAt: 1 } },
      { path: "clubs/" + clubId + "/staff/s1", payload: { clubId, staffId: "s1", displayName: "Entrenador", updatedAt: 1 } },
      { path: "clubs/" + clubId + "/teams/" + teamId + "/seasons/" + seasonId + "/players/p1", payload: { clubId, teamId, seasonId, playerId: "p1", number: 1, updatedAt: 1 } },
      { path: "clubs/" + clubId + "/teams/" + teamId + "/seasons/" + seasonId + "/players/p2", payload: { clubId, teamId, seasonId, playerId: "p2", number: 8, updatedAt: 1 } },
      { path: "clubs/" + clubId + "/teams/" + teamId + "/seasons/" + seasonId + "/staff/s1", payload: { clubId, teamId, seasonId, staffId: "s1", role: "HEAD_COACH", updatedAt: 1 } },
      { path: "matches/" + matchId, payload: { matchId, preparation: { clubId, teamId, seasonId }, players: [{ id: "p1" }, { id: "p2" }], staff: [{ id: "s1" }], videoSegments: [{ id: "v1", videoId: "youtube" }], videoEventOverrides: [{ eventId: "e1", segmentId: "v1", second: 11 }], updatedAt: 2 } },
      { path: "matches/" + matchId + "/events/e1", payload: { id: "e1", type: "threat_recorded", period: 1, minute: 4, order: 1, playerId: "p1", assist: { status: "PLAYER", playerId: "p2" }, origin: { x: 0.3, y: 0.4 } } },
      { path: "matches/" + matchId + "/events/e2", payload: { id: "e2", type: "card_recorded", period: 1, minute: 6, order: 1, staffId: "s1" } },
      { path: "clubs/" + clubId + "/accesses/admin", payload: { accessId: "admin", clubId, role: "ADMIN", codeHash: "hash-only", code: "MUST-NOT-LEAK", updatedAt: 1 } },
      { path: "accessCodes/hash-only", payload: { codeHash: "hash-only", clubId, accessId: "admin", status: "ACTIVE" } },
      { path: "matchCaptureLeases/" + matchId, payload: { matchId, captureSessionId: "capture" } },
      { path: "outbox/op-1", payload: { operationId: "op-1" } },
    ],
  };
}

test("RC3 environment safety rechaza destinos cruzados y exige confirmación literal", () => {
  assert.throws(() => assertExpectedEnvironment({ environment: "prod", projectId: "cdalameda-dev", action: "RESTORE" }), /PROD no puede/);
  assert.throws(() => assertExpectedEnvironment({ environment: "dev", projectId: "otro-dev", action: "BACKUP" }), /cdalameda-dev/);
  assert.throws(() => assertExpectedEnvironment({ environment: "prod", projectId: "alam-prod-real", expectedProjectId: "alam-prod-real", confirmationProjectId: "otro", action: "RESTORE", apply: true }), /confirmar literalmente/);
  assert.doesNotThrow(() => assertExpectedEnvironment({ environment: "prod", projectId: "alam-prod-real", expectedProjectId: "alam-prod-real", confirmationProjectId: "alam-prod-real", action: "RESTORE", apply: true }));
  const bad = inspectApplicationEnvironment({ NEXT_PUBLIC_APP_ENV: "prod", NEXT_PUBLIC_FIREBASE_ENV: "prod", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "cdalameda-dev", NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: "xc7h48kz", NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET: "alamedapp_players_dev" });
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.length >= 3);
  const good = inspectApplicationEnvironment({ NEXT_PUBLIC_APP_ENV: "dev", NEXT_PUBLIC_FIREBASE_ENV: "dev", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "cdalameda-dev", NEXT_PUBLIC_FIREBASE_API_KEY: "public", NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "cdalameda-dev.firebaseapp.com", NEXT_PUBLIC_FIREBASE_APP_ID: "public", NEXT_PUBLIC_FIREBASE_ANONYMOUS_AUTH: "true", NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: "xc7h48kz", NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET: "alamedapp_players_dev" });
  assert.equal(good.ok, true);
});

test("RC3 backup lógico valida referencias, separa Access y conserva Cloudinary sin plaintext", () => {
  const source = dataset();
  const validation = validateLogicalDataset(source);
  assert.equal(validation.ok, true);
  assert.match(validation.warnings.join(" "), /operativo/);
  const backup = createLogicalBackup(source, 100);
  assert.equal(backup.schemaVersion, 1);
  assert.equal(backup.sourceProjectId, "cdalameda-dev");
  assert.equal(backup.accessMetadata.length, 2);
  assert.equal(backup.cloudinaryReferences[0].publicId, "players/p1");
  assert.equal(backup.documents.some((document) => document.path.startsWith("matchCaptureLeases/")), false);
  assert.equal(backup.documents.some((document) => document.path.startsWith("outbox/")), false);
  assert.doesNotMatch(JSON.stringify(backup), /MUST-NOT-LEAK/);
  assert.equal(validateBackupBundle(backup).ok, true);
  assert.ok(backupDocuments(backup).some((document) => document.path === "accessCodes/hash-only"));
});

test("RC3 validation rechaza schema desconocido, duplicados y referencias rotas", () => {
  const unknown = { ...createLogicalBackup(dataset()), schemaVersion: 99 } as unknown as BackupBundle;
  assert.equal(validateBackupBundle(unknown).ok, false);
  const broken = dataset();
  broken.documents = broken.documents.filter((document) => document.path !== "clubs/cd-alameda/players/p1");
  assert.equal(validateLogicalDataset(broken).ok, false);
  const duplicate = dataset();
  duplicate.documents.push(duplicate.documents[0]);
  assert.match(validateLogicalDataset(duplicate).errors.join(" "), /duplicado/);
});

test("RC3 restore es dry-run, clasifica colisión y aplica de forma idempotente con IDs estables", () => {
  const source = dataset();
  const backup = createLogicalBackup(source);
  const docs = backupDocuments(backup);
  const empty: LogicalDataset = { schemaVersion: 1, kind: "ALAMEDAPP_LOGICAL_DATASET", environment: "prod", projectId: "alam-prod-real", documents: [] };
  const dry = planLogicalRestore({ documents: docs, target: empty, targetEnvironment: "prod", targetProjectId: "alam-prod-real" });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.counts.CREATE, docs.length);
  assert.throws(() => applyLogicalRestore(docs, empty, dry), /dry-run/);
  const apply = planLogicalRestore({ documents: docs, target: empty, targetEnvironment: "prod", targetProjectId: "alam-prod-real", expectedProjectId: "alam-prod-real", confirmationProjectId: "alam-prod-real", apply: true });
  const restored = applyLogicalRestore(docs, empty, apply);
  const second = planLogicalRestore({ documents: docs, target: restored, targetEnvironment: "prod", targetProjectId: "alam-prod-real" });
  assert.equal(second.counts.UNCHANGED, docs.length);
  assert.equal(second.counts.CREATE, 0);
  assert.deepEqual(restored.documents.map((document) => document.path).sort(), docs.map((document) => document.path).sort());
  const collisionTarget = { ...empty, documents: [{ path: docs[0].path, payload: { incompatible: true } }] };
  const collision = planLogicalRestore({ documents: [docs[0]], target: collisionTarget, targetEnvironment: "prod", targetProjectId: "alam-prod-real" });
  assert.equal(collision.counts.CONFLICT, 1);
});

test("RC3 round-trip conserva cronología, referencias, vídeo y no duplica documentos", () => {
  const backup = createLogicalBackup(dataset());
  const docs = backupDocuments(backup);
  const target: LogicalDataset = { schemaVersion: 1, kind: "ALAMEDAPP_LOGICAL_DATASET", environment: "prod", projectId: "alam-prod-real", documents: [] };
  const plan = planLogicalRestore({ documents: docs, target, targetEnvironment: "prod", targetProjectId: "alam-prod-real", expectedProjectId: "alam-prod-real", confirmationProjectId: "alam-prod-real", apply: true });
  const restored = applyLogicalRestore(docs, target, plan);
  const eventPaths = restored.documents.filter((document) => /\/events\//.test(document.path)).map((document) => document.path);
  assert.deepEqual(eventPaths, ["matches/chelva-real/events/e1", "matches/chelva-real/events/e2"]);
  const match = restored.documents.find((document) => document.path === "matches/chelva-real");
  assert.deepEqual(match?.payload.videoSegments, [{ id: "v1", videoId: "youtube" }]);
  assert.equal(new Set(restored.documents.map((document) => document.path)).size, restored.documents.length);
});

test("RC3 bundle selectivo conserva IDs y excluye otros jugadores, Access y estado operativo", () => {
  const bundle = createSelectiveMatchBundle(dataset(), "chelva-real", 200);
  assert.equal(bundle.matchId, "chelva-real");
  assert.deepEqual(bundle.integrity.eventIds, ["e1", "e2"]);
  assert.deepEqual(bundle.integrity.playerIds, ["p1", "p2"]);
  assert.deepEqual(bundle.integrity.staffIds, ["s1"]);
  assert.equal(bundle.referencedPlayers.some((document) => document.path.endsWith("/not-used")), false);
  assert.equal(bundle.relevantMemberships.length, 2);
  assert.equal(bundle.relevantStaffMemberships.length, 1);
  assert.deepEqual(bundle.videoMetadata.eventOverrides, [{ eventId: "e1", segmentId: "v1", second: 11 }]);
  const documents = matchBundleDocuments(bundle);
  assert.equal(documents.some((document) => /accessCodes|accesses|matchCaptureLeases|outbox/.test(document.path)), false);
  assert.match(bundle.integrity.warnings.join(" "), /raw/);
});
