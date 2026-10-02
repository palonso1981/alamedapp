import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";

const CLUB = "cd-alameda";
const TEAM = "team-a";
const SEASON = "season-a";

function accessDocuments(uid, accessId, codeHash, role, scope = { type: "CLUB" }) {
  return {
    mapping: {
      entityType: "ACCESS_CODE",
      codeHash,
      clubId: CLUB,
      accessId,
      credentialVersion: 1,
      status: "ACTIVE",
    },
    profile: {
      entityType: "ACCESS_PROFILE",
      clubId: CLUB,
      accessId,
      credentialVersion: 1,
      status: "ACTIVE",
      role,
      scope,
      activeCodeHash: codeHash,
    },
    session: {
      entityType: "ACCESS_SESSION",
      uid,
      clubId: CLUB,
      accessId,
      credentialVersion: 1,
      status: "ACTIVE",
      codeHash,
    },
  };
}

function playerDocument(playerId, operationId = `op-${playerId}`) {
  return {
    schemaVersion: 3,
    clubId: CLUB,
    teamId: CLUB,
    entityType: "PLAYER",
    entityId: playerId,
    revision: 1,
    lastOperationId: operationId,
    clientUpdatedAt: 1,
    serverUpdatedAt: 1,
    active: true,
    authorizationTeamId: TEAM,
    authorizationSeasonId: SEASON,
    payload: {
      playerId,
      clubId: CLUB,
      fullName: "Alonso",
      displayName: "Alonso",
      number: 3,
      role: "FIELD",
      active: true,
      createdAt: 1,
      updatedAt: 1,
    },
  };
}

function membershipDocument(playerId, operationId = `op-${playerId}`) {
  return {
    schemaVersion: 3,
    clubId: CLUB,
    teamId: CLUB,
    entityType: "SEASON_PLAYER",
    entityId: playerId,
    revision: 1,
    lastOperationId: operationId,
    clientUpdatedAt: 1,
    serverUpdatedAt: 1,
    active: true,
    authorizationTeamId: TEAM,
    authorizationSeasonId: SEASON,
    payload: {
      clubId: CLUB,
      teamId: TEAM,
      seasonId: SEASON,
      playerId,
      number: 3,
      active: true,
      createdAt: 1,
      updatedAt: 1,
    },
  };
}

function staffDocument(staffId, operationId = `op-${staffId}`) {
  return {
    schemaVersion: 3,
    clubId: CLUB,
    teamId: CLUB,
    entityType: "STAFF",
    entityId: staffId,
    revision: 1,
    lastOperationId: operationId,
    clientUpdatedAt: 1,
    serverUpdatedAt: 1,
    active: true,
    authorizationTeamId: TEAM,
    authorizationSeasonId: SEASON,
    payload: {
      staffId,
      clubId: CLUB,
      fullName: "Delegado",
      displayName: "Delegado",
      role: "DELEGATE",
      active: true,
      createdAt: 1,
      updatedAt: 1,
    },
  };
}

function staffMembershipDocument(staffId, operationId = `op-${staffId}`) {
  return {
    schemaVersion: 3,
    clubId: CLUB,
    teamId: CLUB,
    entityType: "SEASON_STAFF",
    entityId: staffId,
    revision: 1,
    lastOperationId: operationId,
    clientUpdatedAt: 1,
    serverUpdatedAt: 1,
    active: true,
    authorizationTeamId: TEAM,
    authorizationSeasonId: SEASON,
    payload: {
      clubId: CLUB,
      teamId: TEAM,
      seasonId: SEASON,
      staffId,
      role: "DELEGATE",
      active: true,
      createdAt: 1,
      updatedAt: 1,
    },
  };
}

function videoCollectionDocument(collectionId, revision = 1) {
  return {
    schemaVersion: 1,
    clubId: CLUB,
    entityType: "VIDEO_COLLECTION",
    entityId: collectionId,
    revision,
    lastOperationId: `op-${collectionId}-${revision}`,
    clientUpdatedAt: revision,
    serverUpdatedAt: revision,
    active: true,
    payload: {
      schemaVersion: 1,
      collectionId,
      clubId: CLUB,
      kind: "COLLECTION",
      name: "ABP",
      visibility: "CLUB",
      items: [],
      active: true,
      deletedAt: null,
      createdAt: 1,
      updatedAt: revision,
    },
  };
}

async function seedAccess(environment, uid, role, scope) {
  const accessId = `${role.toLowerCase()}-${uid}`;
  const codeHash = `hash-${uid}`;
  const values = accessDocuments(uid, accessId, codeHash, role, scope);
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "accessCodes", codeHash), values.mapping);
    await setDoc(doc(db, "clubs", CLUB, "accesses", accessId), values.profile);
    await setDoc(doc(db, "clubs", CLUB, "accessSessions", uid), values.session);
  });
}

test("Rules reales: creación coherente de PLAYER/STAFF y memberships", async () => {
  const environment = await initializeTestEnvironment({
    projectId: "alamedapp-rules-test",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });

  try {
    await seedAccess(environment, "admin", "ADMIN");
    await seedAccess(environment, "editor", "EDITOR", { type: "TEAMS", teamIds: [TEAM] });
    await seedAccess(environment, "viewer", "VIEWER", { type: "TEAMS", teamIds: [TEAM] });

    const admin = environment.authenticatedContext("admin").firestore();
    const editor = environment.authenticatedContext("editor").firestore();
    const viewer = environment.authenticatedContext("viewer").firestore();

    await assertSucceeds(
      setDoc(doc(admin, "clubs", CLUB, "players", "player-solo"), playerDocument("player-solo")),
    );

    const batch = writeBatch(admin);
    batch.set(
      doc(admin, "clubs", CLUB, "players", "player-batch"),
      playerDocument("player-batch", "batch-player"),
    );
    batch.set(
      doc(admin, "clubs", CLUB, "teams", TEAM, "seasons", SEASON, "players", "player-batch"),
      membershipDocument("player-batch", "batch-player"),
    );
    await assertSucceeds(batch.commit());
    assert.equal((await getDoc(doc(admin, "clubs", CLUB, "players", "player-batch"))).exists(), true);
    assert.equal(
      (await getDoc(doc(admin, "clubs", CLUB, "teams", TEAM, "seasons", SEASON, "players", "player-batch"))).exists(),
      true,
    );

    await assertFails(
      setDoc(
        doc(admin, "clubs", CLUB, "teams", TEAM, "seasons", SEASON, "players", "orphan"),
        membershipDocument("orphan"),
      ),
    );

    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "clubs", CLUB, "players", "existing-player"),
        playerDocument("existing-player", "seed"),
      );
    });
    await assertSucceeds(
      setDoc(
        doc(editor, "clubs", CLUB, "teams", TEAM, "seasons", SEASON, "players", "existing-player"),
        membershipDocument("existing-player", "editor-membership"),
      ),
    );

    await assertFails(
      setDoc(doc(viewer, "clubs", CLUB, "players", "viewer-player"), playerDocument("viewer-player")),
    );

    const wrongScope = playerDocument("wrong-scope");
    wrongScope.payload.clubId = "other-club";
    await assertFails(setDoc(doc(admin, "clubs", CLUB, "players", "wrong-scope"), wrongScope));

    const wrongIdentity = playerDocument("payload-id");
    await assertFails(setDoc(doc(admin, "clubs", CLUB, "players", "path-id"), wrongIdentity));

    const staffBatch = writeBatch(admin);
    staffBatch.set(doc(admin, "clubs", CLUB, "staff", "staff-batch"), staffDocument("staff-batch", "batch-staff"));
    staffBatch.set(
      doc(admin, "clubs", CLUB, "teams", TEAM, "seasons", SEASON, "staff", "staff-batch"),
      staffMembershipDocument("staff-batch", "batch-staff"),
    );
    await assertSucceeds(staffBatch.commit());
    await assertFails(
      setDoc(
        doc(admin, "clubs", CLUB, "teams", TEAM, "seasons", SEASON, "staff", "orphan-staff"),
        staffMembershipDocument("orphan-staff"),
      ),
    );
  } finally {
    await environment.cleanup();
  }
});

test("Rules reales: colecciones son legibles con sesión y solo ADMIN/EDITOR escriben", async () => {
  const environment = await initializeTestEnvironment({ projectId: "alamedapp-rules-test", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  try {
    await seedAccess(environment, "admin-video", "ADMIN");
    await seedAccess(environment, "editor-video", "EDITOR");
    await seedAccess(environment, "viewer-video", "VIEWER", { type: "CLUB" });
    const admin = environment.authenticatedContext("admin-video").firestore();
    const editor = environment.authenticatedContext("editor-video").firestore();
    const viewer = environment.authenticatedContext("viewer-video").firestore();
    const anonymous = environment.unauthenticatedContext().firestore();
    const reference = doc(admin, "clubs", CLUB, "videoCollections", "collection-1");
    await assertSucceeds(setDoc(reference, videoCollectionDocument("collection-1")));
    await assertSucceeds(getDoc(doc(viewer, "clubs", CLUB, "videoCollections", "collection-1")));
    await assertSucceeds(getDocs(collection(viewer, "clubs", CLUB, "videoCollections")));
    await assertFails(getDoc(doc(anonymous, "clubs", CLUB, "videoCollections", "collection-1")));
    await assertFails(setDoc(doc(viewer, "clubs", CLUB, "videoCollections", "viewer-write"), videoCollectionDocument("viewer-write")));
    await assertSucceeds(setDoc(doc(editor, "clubs", CLUB, "videoCollections", "editor-write"), videoCollectionDocument("editor-write")));
    await assertSucceeds(setDoc(doc(admin, "clubs", CLUB, "videoCollections", "collection-1"), videoCollectionDocument("collection-1", 2)));
    await assertFails(deleteDoc(reference));
  } finally { await environment.cleanup(); }
});
