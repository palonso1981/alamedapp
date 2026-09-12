import assert from "node:assert/strict";
import test from "node:test";
import { activeAdminCount, assertCanRetireAccess, canAccessTeam, canManageAccess, canMutateSports, canOpenRoute, generateAccessCode, hashAccessCode, newAccessCodeValidationError, normalizeAccessCode, normalizeAccessScope, normalizeNewAccessCode, utcUsageDay, visibleTeamIds, ActiveAccessGrant, ClubAccessProfile } from "./accessDomain";
import { ACCESS_STORAGE_KEY, AccessStorage, clearRememberedAccess, getOrCreateDeviceInstallId, loadRememberedAccess, pendingLocalOperations, saveRememberedAccess } from "./accessPersistence";
import { resetRuntimeAccessGrantForTests, setRuntimeAccessGrant } from "./accessRuntime";
import { listMatchCatalog } from "../matchCatalog";
import { LocalTeamRepository } from "../sync/localTeamRepository";
import { LocalMatchRepository } from "../sync/localMatchRepository";
import { emptyTeamWorkspace } from "../seasonDomain";
import { remoteMatchSession, remoteWorkspace } from "./accessRemoteHydration";
import { MATCH_REMOTE_SCHEMA_VERSION } from "../sync/syncTypes";

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
  assert.equal(normalizeAccessCode("abcd-efgh-ij$l"), null);
  const code = generateAccessCode(new Uint8Array(16).map((_, index) => index));
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
  assert.equal(newAccessCodeValidationError(code, "Acceso"), null);
  assert.equal((await hashAccessCode(code)).length, 64);
  assert.equal(await hashAccessCode(code.toLowerCase().replaceAll("-", " ")), await hashAccessCode(code));
});

test("código personalizado aplica una política simple y una identidad única", async () => {
  assert.equal(normalizeNewAccessCode("GRABA-ALAMEDA-27", "Graba partidos"), "GRAB-AALA-MEDA-27");
  assert.equal(await hashAccessCode("GRABA-ALAMEDA-27"), await hashAccessCode("graba alameda 27"));
  assert.match(newAccessCodeValidationError("CORTO-2", "Acceso") ?? "", /14/);
  assert.match(newAccessCodeValidationError("12345678901234", "Acceso") ?? "", /letra/);
  assert.match(newAccessCodeValidationError("SOLOLETRASLARGAS", "Acceso") ?? "", /número/);
  assert.match(newAccessCodeValidationError("A1-A1-A1-A1-A1-A1-A1", "Acceso") ?? "", /sencillo/);
  assert.match(newAccessCodeValidationError("GRABA-PARTIDOS-27", "Graba partidos 27") ?? "", /igual/);
  assert.equal(newAccessCodeValidationError("JUVENIL-PISTA-48", "Visor"), null);
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
  assert.equal(canAccessTeam(editor, "club-a", "c"), true);
  assert.equal(canAccessTeam(viewer, "club-a", "b"), false);
  assert.deepEqual(visibleTeamIds(editor, "club-a", ["a", "b", "c"]), ["a", "b", "c"]);
  assert.deepEqual(normalizeAccessScope("ADMIN", { type: "TEAMS", teamIds: ["a"] }), { type: "CLUB" });
  assert.deepEqual(normalizeAccessScope("EDITOR", { type: "TEAMS", teamIds: ["b", "a", "b"] }), { type: "CLUB" });
});

test("VIEWER no abre rutas de mutación ni Accesos y credencial desactivada no autoriza", () => {
  const viewer = grant("VIEWER");
  assert.equal(canOpenRoute(viewer, "/dashboard"), true);
  assert.equal(canOpenRoute(viewer, "/partidos/m1/revision"), true);
  assert.equal(canOpenRoute(viewer, "/partidos/nuevo"), false);
  assert.equal(canOpenRoute(viewer, "/partido/m1/directo"), false);
  assert.equal(canOpenRoute(viewer, "/accesos"), false);
  const editor = grant("EDITOR", { type: "TEAMS", teamIds: ["legacy"] });
  assert.equal(canOpenRoute(editor, "/configuracion"), true);
  assert.equal(canOpenRoute(editor, "/partidos/nuevo"), true);
  assert.equal(canOpenRoute(editor, "/partido/m1/prepartido"), true);
  assert.equal(canOpenRoute(editor, "/partido/m1/directo"), true);
  assert.equal(canOpenRoute(editor, "/partidos/m1/video"), true);
  assert.equal(canOpenRoute(editor, "/accesos"), false);
  assert.equal(canManageAccess(editor), false);
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

test("indicador sin pendientes y guard convergen ante veinte errores terminales legacy", () => {
  const storage = new MemoryStorage();
  const terminalLegacy = Array.from({ length: 20 }, (_, index) => ({
    id: `legacy-${index + 1}`,
    entityType: index % 2 ? "PLAYER" : "SEASON_PLAYER",
    entityId: `entity-${index + 1}`,
    namespace: "LEGACY_TEAMS",
    status: "ERROR",
    errorKind: "PERMISSION",
    nextAttemptAt: Number.MAX_SAFE_INTEGER,
  }));
  storage.setItem(
    "alamedapp:team:v1:cd-alameda",
    JSON.stringify({ sync: { outbox: terminalLegacy, lastSyncedAt: 123 } }),
  );

  assert.equal(pendingLocalOperations(storage).length, 0);
  assert.equal(
    JSON.parse(storage.getItem("alamedapp:team:v1:cd-alameda")!).sync.outbox.length,
    20,
  );
});

test("guard conserva el bloqueo para trabajo enviable y excluye conflictos o ACK", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    "alamedapp:match:v1:m1",
    JSON.stringify({
      sync: {
        outbox: [
          { id: "pending", status: "PENDING" },
          { id: "recover-after-close", status: "SYNCING" },
          { id: "offline", status: "ERROR", errorKind: "OFFLINE", nextAttemptAt: 100 },
          { id: "conflict", status: "CONFLICT" },
          { id: "ack", status: "SYNCED" },
          { id: "fatal", status: "ERROR", errorKind: "FATAL", nextAttemptAt: Number.MAX_SAFE_INTEGER },
        ],
      },
    }),
  );

  assert.deepEqual(
    pendingLocalOperations(storage).map((operation) => operation.operationId),
    ["pending", "recover-after-close", "offline"],
  );
});

test("último ADMIN activo no puede degradarse, desactivarse ni eliminarse", () => {
  const admin = grant("ADMIN").profile;
  assert.equal(activeAdminCount([admin]), 1);
  assert.throws(
    () => assertCanRetireAccess(admin.accessId, admin, [admin], { role: "EDITOR", status: "ACTIVE" }),
    /último ADMIN/,
  );
  assert.throws(
    () => assertCanRetireAccess(admin.accessId, admin, [admin], { role: "ADMIN", status: "DELETED" }),
    /último ADMIN/,
  );
});

test("un ADMIN puede retirar otro ADMIN cuando quedan dos", () => {
  const first = grant("ADMIN").profile;
  const second = { ...first, accessId: "admin-2", label: "Segundo ADMIN" };
  assert.equal(activeAdminCount([first, second]), 2);
  assert.doesNotThrow(() =>
    assertCanRetireAccess(first.accessId, second, [first, second], {
      role: "VIEWER",
      status: "ACTIVE",
    }),
  );
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

test("EDITOR legacy obtiene club deportivo completo pero no puede mutar el Club", () => {
  const storage = new MemoryStorage();
  const repository = new LocalTeamRepository({ storage, now: () => 1, idFactory: () => "op" });
  const workspace = emptyTeamWorkspace("club-a", 1);
  workspace.teams = [{ ...workspace.team, clubId: "club-a", teamId: "b", name: "Equipo B" }];
  setRuntimeAccessGrant(grant("EDITOR", { type: "TEAMS", teamIds: ["a"] }));
  try {
    assert.equal(repository.save(workspace), true);
    assert.equal(repository.getSyncState("club-a").outbox.some((item) => item.entityType === "TEAM_UNIT"), true);
    const changedClub = { ...repository.load("club-a"), club: { ...repository.load("club-a").club, name: "Club ajeno" } };
    assert.equal(repository.save(changedClub), false);
  } finally { resetRuntimeAccessGrantForTests(); }
});

test("hidratación remota reconstruye ADMIN limpio sin crear outbox", () => {
  const storage = new MemoryStorage();
  const teamRepository = new LocalTeamRepository({ storage, now: () => 10 });
  const matchRepository = new LocalMatchRepository({ storage, now: () => 10 });
  const base = emptyTeamWorkspace("club-a", 1);
  const team = { ...base.team, teamId: "team-a", clubId: "club-a", name: "Senior A" };
  const workspace = remoteWorkspace({ club: base.club, teams: [team], players: [], staff: [], seasons: [], seasonPlayers: [], seasonStaff: [] });
  assert.equal(teamRepository.hydrateRemote("club-a", workspace, { "clubs:team_unit:team-a": 3 }), true);
  assert.equal(teamRepository.getSyncState("club-a").outbox.length, 0);
  assert.equal(teamRepository.load("club-a").teams[0].name, "Senior A");

  const session = remoteMatchSession({
    schemaVersion: MATCH_REMOTE_SCHEMA_VERSION, matchId: "m-remote", players: [], staff: [],
    activePeriod: 1, minute: 0, periodMinutes: { 1: 0, 2: 0 }, closedPeriods: [],
    periodCloseSnapshots: {}, matchFinished: false,
  }, []);
  assert.equal(matchRepository.hydrateRemote(session, { "match:m-remote": 2 }), true);
  assert.equal(matchRepository.getSyncState("m-remote").outbox.length, 0);
  assert.equal(matchRepository.load("m-remote")?.matchId, "m-remote");
});

test("hidratación remota no pisa cambios locales ni su outbox", () => {
  const storage = new MemoryStorage();
  const repository = new LocalTeamRepository({ storage, now: () => 10, idFactory: () => "local-op" });
  const local = emptyTeamWorkspace("club-a", 1);
  local.club = { ...local.club, name: "Cambio local" };
  assert.equal(repository.save(local), true);
  const pendingBefore = repository.getSyncState("club-a").outbox.length;
  const remote = { ...local, club: { ...local.club, name: "Nombre remoto" } };
  assert.equal(repository.hydrateRemote("club-a", remote, {}), true);
  assert.equal(repository.load("club-a").club.name, "Cambio local");
  assert.equal(repository.getSyncState("club-a").outbox.length, pendingBefore);
});
