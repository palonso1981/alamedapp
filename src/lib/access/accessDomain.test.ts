import assert from "node:assert/strict";
import test from "node:test";
import { canAccessTeam, canManageAccess, canMutateSports, canOpenRoute, generateAccessCode, hashAccessCode, normalizeAccessCode, normalizeAccessScope, utcUsageDay, visibleTeamIds, ActiveAccessGrant, ClubAccessProfile } from "./accessDomain";
import { ACCESS_STORAGE_KEY, AccessStorage, clearRememberedAccess, getOrCreateDeviceInstallId, loadRememberedAccess, pendingLocalOperations, saveRememberedAccess } from "./accessPersistence";
import { resetRuntimeAccessGrantForTests, setRuntimeAccessGrant } from "./accessRuntime";
import { listMatchCatalog } from "../matchCatalog";
import { LocalTeamRepository } from "../sync/localTeamRepository";
import { emptyTeamWorkspace } from "../seasonDomain";

class MemoryStorage implements AccessStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
}

function profile(role: ClubAccessProfile["role"], scope: ClubAccessProfile["scope"] = { type: "CLUB" }): ClubAccessProfile {
  return { accessId: `a-${role}`, clubId: "club-a", label: role, role, scope, status: "ACTIVE", credentialVersion: 1, createdAt: 1, updatedAt: 1 };
}

function grant(role: ClubAccessProfile["role"], scope?: ClubAccessProfile["scope"]): ActiveAccessGrant {
  return { uid: "uid", deviceInstallId: "device", profile: profile(role, scope), credentialVersion: 1, lastValidatedAt: 2, offline: false };
}

test("código normaliza mayúsculas espacios y guiones y rechaza ambiguos", async () => {
  assert.equal(normalizeAccessCode("abcd efgh-jkmn"), "ABCD-EFGH-JKMN");
  assert.equal(normalizeAccessCode("abcd-efgh-ijkl"), null);
  const code = generateAccessCode(new Uint8Array(12).map((_, index) => index));
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/);
  assert.equal((await hashAccessCode(code)).length, 64);
  assert.equal(await hashAccessCode(code.toLowerCase().replaceAll("-", " ")), await hashAccessCode(code));
});

test("ADMIN EDITOR y VIEWER aplican rol y scope club uno o varios equipos", () => {
  const admin = grant("ADMIN", { type: "TEAMS", teamIds: ["ignored"] });
  const editor = grant("EDITOR", { type: "TEAMS", teamIds: ["a", "b"] });
  const viewer = grant("VIEWER", { type: "TEAMS", teamIds: ["a"] });
  assert.equal(canManageAccess(admin), true);
  assert.equal(canMutateSports(editor), true);
  assert.equal(canMutateSports(viewer), false);
  assert.equal(canAccessTeam(admin, "club-a", "z"), true);
  assert.equal(canAccessTeam(editor, "club-a", "a"), true);
  assert.equal(canAccessTeam(editor, "club-a", "c"), false);
  assert.equal(canAccessTeam(viewer, "club-a", "b"), false);
  assert.deepEqual(visibleTeamIds(editor, "club-a", ["a", "b", "c"]), ["a", "b"]);
  assert.deepEqual(normalizeAccessScope("ADMIN", { type: "TEAMS", teamIds: ["a"] }), { type: "CLUB" });
  assert.deepEqual(normalizeAccessScope("EDITOR", { type: "TEAMS", teamIds: ["b", "a", "b"] }), { type: "TEAMS", teamIds: ["a", "b"] });
});

test("VIEWER no abre rutas de mutación ni Accesos y credencial desactivada no autoriza", () => {
  const viewer = grant("VIEWER");
  assert.equal(canOpenRoute(viewer, "/dashboard"), true);
  assert.equal(canOpenRoute(viewer, "/partidos/m1/revision"), true);
  assert.equal(canOpenRoute(viewer, "/partidos/nuevo"), false);
  assert.equal(canOpenRoute(viewer, "/partido/m1/directo"), false);
  assert.equal(canOpenRoute(viewer, "/accesos"), false);
  assert.equal(canOpenRoute(grant("EDITOR"), "/configuracion"), false);
  assert.equal(canOpenRoute(grant("ADMIN"), "/configuracion"), true);
  const disabled = { ...viewer, profile: { ...viewer.profile, status: "DISABLED" as const } };
  assert.equal(canOpenRoute(disabled, "/dashboard"), false);
  const revokedVersion = { ...viewer, credentialVersion: 0 };
  assert.equal(canOpenRoute(revokedVersion, "/dashboard"), false);
});

test("acceso recordado se restaura y el deviceInstallId permanece estable", () => {
  const storage = new MemoryStorage();
  const current = grant("EDITOR");
  saveRememberedAccess(current, storage);
  assert.deepEqual(loadRememberedAccess(storage), current);
  assert.equal(getOrCreateDeviceInstallId(storage, () => "device-1"), "device-1");
  assert.equal(getOrCreateDeviceInstallId(storage, () => "device-2"), "device-1");
  clearRememberedAccess(storage);
  assert.equal(storage.getItem(ACCESS_STORAGE_KEY), null);
});

test("cambiar acceso detecta outbox pendiente sin borrarlo ni reasignarlo", () => {
  const storage = new MemoryStorage();
  storage.setItem("alamedapp:match:v1:m1", JSON.stringify({ sync: { outbox: [{ id: "op-match", status: "PENDING" }] } }));
  storage.setItem("alamedapp:team:v1:club-a", JSON.stringify({ sync: { outbox: [{ id: "op-team", status: "ERROR" }] } }));
  const pending = pendingLocalOperations(storage);
  assert.deepEqual(pending.map((item) => item.operationId), ["op-match", "op-team"]);
  assert.equal(storage.getItem("alamedapp:match:v1:m1")?.includes("op-match"), true);
});

test("heartbeat agrupa por día UTC sin contar navegaciones", () => {
  assert.equal(utcUsageDay(Date.UTC(2026, 8, 12, 23, 59)), "2026-09-12");
});

test("catálogo local oculta partidos cacheados fuera de scope sin borrarlos", () => {
  const storage = new MemoryStorage();
  storage.setItem("alamedapp:matches:index:v1", JSON.stringify([
    { matchId: "m-a", clubId: "club-a", teamId: "a", opponent: "A", venue: "HOME", date: "2026-01-01", status: "FINISHED", updatedAt: 1 },
    { matchId: "m-b", clubId: "club-a", teamId: "b", opponent: "B", venue: "HOME", date: "2026-01-02", status: "FINISHED", updatedAt: 1 },
  ]));
  setRuntimeAccessGrant(grant("VIEWER", { type: "TEAMS", teamIds: ["a"] }));
  try {
    assert.deepEqual(listMatchCatalog(storage).map((item) => item.matchId), ["m-a"]);
    assert.match(storage.getItem("alamedapp:matches:index:v1") ?? "", /m-b/);
  } finally { resetRuntimeAccessGrantForTests(); }
});

test("repositorio local rechaza mutación de plantilla por VISOR", () => {
  const storage = new MemoryStorage();
  const repository = new LocalTeamRepository({ storage, now: () => 1, idFactory: () => "op" });
  setRuntimeAccessGrant(grant("VIEWER"));
  try {
    assert.equal(repository.save(emptyTeamWorkspace("club-a", 1)), false);
    assert.equal(storage.length, 0);
  } finally { resetRuntimeAccessGrantForTests(); }
});

test("repositorio local rechaza a EDITOR un equipo fuera de su scope", () => {
  const storage = new MemoryStorage();
  const repository = new LocalTeamRepository({ storage, now: () => 1, idFactory: () => "op" });
  const workspace = emptyTeamWorkspace("club-a", 1);
  workspace.teams = [{ ...workspace.team, clubId: "club-a", teamId: "b", name: "Equipo B" }];
  setRuntimeAccessGrant(grant("EDITOR", { type: "TEAMS", teamIds: ["a"] }));
  try {
    assert.equal(repository.save(workspace), false);
    assert.equal(storage.length, 0);
  } finally { resetRuntimeAccessGrantForTests(); }
});
