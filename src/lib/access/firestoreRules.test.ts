import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rules = readFileSync("firestore.rules", "utf8");

test("Rules: el código solo permite get exacto y nunca list", () => {
  const block = rules.match(/match \/accessCodes\/\{codeHash\} \{([\s\S]*?)\n    \}/)?.[1] ?? "";
  assert.match(block, /allow get: if signedIn\(\) && codeHash\.size\(\) == 64/);
  assert.match(block, /allow list: if false/);
  assert.doesNotMatch(block, /allow (read|write):/);
});

test("Rules: el perfil no es legible antes de sesión válida", () => {
  assert.match(rules, /match \/clubs\/\{clubId\}\/accesses\/\{accessId\}[\s\S]*?allow get: if validAccess\(clubId\) && session\(clubId\)\.accessId == accessId/);
});

test("canje: crea la sesión técnica antes de leer el perfil Access", () => {
  const implementation = readFileSync("src/lib/access/accessFirestore.ts", "utf8");
  const mappingRead = implementation.indexOf('getDoc(doc(db, "accessCodes", codeHash))');
  const sessionCreate = implementation.indexOf('setDoc(doc(db, "clubs", mapping.clubId, "accessSessions", user.uid)');
  const profileRead = implementation.indexOf('getDoc(doc(db, "clubs", mapping.clubId, "accesses", mapping.accessId))');
  assert.ok(mappingRead >= 0);
  assert.ok(sessionCreate > mappingRead);
  assert.ok(profileRead > sessionCreate);
});

test("Rules: la sesión técnica valida internamente mapping y Access", () => {
  const block = rules.match(/match \/clubs\/\{clubId\}\/accessSessions\/\{uid\} \{([\s\S]*?)\n    \}/)?.[1] ?? "";
  assert.match(block, /request\.auth\.uid == uid/);
  assert.match(block, /validSessionCandidate\(request\.resource\.data, clubId, uid\)/);
  assert.match(rules, /exists\(codePath\(data\.codeHash\)\)/);
  assert.match(rules, /get\(accessPath\(clubId, data\.accessId\)\)\.data\.status == 'ACTIVE'/);
  assert.match(rules, /data\.credentialVersion/);
});

test("Rules: roles, scope y revocación protegen deporte", () => {
  assert.match(rules, /access\(clubId\)\.status == 'ACTIVE'/);
  assert.match(rules, /access\(clubId\)\.credentialVersion == session\(clubId\)\.credentialVersion/);
  assert.match(rules, /teamId in access\(clubId\)\.scope\.teamIds/);
  assert.match(rules, /access\(clubId\)\.role != 'VIEWER'/);
  assert.match(rules, /match \/matches\/\{matchId\}[\s\S]*?canWriteTeam/);
});

test("Rules: EDITOR hereda club deportivo pero no Club institucional ni Access", () => {
  assert.match(rules, /access\(clubId\)\.role in \['ADMIN', 'EDITOR'\]/);
  assert.match(rules, /match \/clubs\/\{clubId\} \{[\s\S]*?allow create, update: if isAdmin\(clubId\)/);
  assert.match(rules, /match \/clubs\/\{clubId\}\/accesses\/\{accessId\} \{[\s\S]*?allow create, update: if isAdmin\(clubId\)/);
  assert.match(rules, /match \/teams\/\{teamId\} \{[\s\S]*?allow create, update: if canWriteTeam\(clubId, teamId\)[\s\S]*?request\.resource\.data\.payload\.clubId == clubId/);
});

test("creación comprueba colisión y no persiste plaintext; regeneración no se expone", () => {
  const implementation = readFileSync("src/lib/access/accessFirestore.ts", "utf8");
  const ui = readFileSync("src/app/accesos/page.tsx", "utf8");
  const collisionRead = implementation.indexOf('getDoc(doc(db, "accessCodes", codeHash))');
  const batchCommit = implementation.indexOf("await batch.commit()", collisionRead);
  assert.ok(collisionRead >= 0 && batchCommit > collisionRead);
  assert.match(implementation, /Este código ya está en uso/);
  assert.doesNotMatch(implementation, /regenerateClubAccess|reactivateClubAccess/);
  assert.doesNotMatch(ui, /NUEVO CÓDIGO|regenerateClubAccess|reactivateClubAccess/);
  assert.match(ui, /GENERAR OTRO/);
  assert.match(ui, /value=\{code\} onChange=\{\(event\) => setCode\(event\.target\.value\)\}/);
  assert.match(ui, /role === "VIEWER" && <fieldset/);
  assert.match(ui, /createClubAccess\(\{ clubId, label, role, scope, code \}\)/);
  assert.doesNotMatch(implementation, /plaintext|plainText|rawCode/);
});

test("Rules: matches permite query solo evaluando club y equipo autorizado", () => {
  const block = rules.match(/match \/matches\/\{matchId\} \{([\s\S]*?)\n      match \/events/)?.[1] ?? "";
  assert.match(block, /allow list: if teamAllowed\(matchClub\(resource\.data\), matchTeam\(resource\.data\)\)/);
  assert.match(block, /Firestore no filtra resultados/);
});

test("Rules: una sesión CLOSED solo se reemplaza por candidato completo del mismo UID", () => {
  const block = rules.match(/match \/clubs\/\{clubId\}\/accessSessions\/\{uid\} \{([\s\S]*?)\n    \}/)?.[1] ?? "";
  assert.match(block, /resource\.data\.status == "CLOSED"/);
  assert.match(block, /validSessionCandidate\(request\.resource\.data, clubId, uid\)/);
  assert.match(rules, /data\.activeCodeHash == data\.codeHash/);
  assert.match(rules, /request\.auth\.uid == uid/);
});

test("Rules: accessCodes solo admite ACTIVE a REVOKED sin cambiar identidad", () => {
  const block = rules.match(/match \/accessCodes\/\{codeHash\} \{([\s\S]*?)\n    \}/)?.[1] ?? "";
  assert.match(block, /resource\.data\.status == "ACTIVE"/);
  assert.match(block, /request\.resource\.data\.status == "REVOKED"/);
  assert.match(block, /affectedKeys\(\)\.hasOnly\(\["status", "replacedAt", "serverUpdatedAt"\]\)/);
});

test("Rules: DELETED es soft delete y el ADMIN de la sesión no puede retirarse", () => {
  assert.match(rules, /data\.status in \['ACTIVE', 'DISABLED', 'DELETED'\]/);
  assert.match(rules, /data\.status != 'DELETED' \|\| data\.deletedAt is int/);
  assert.match(rules, /accessId != session\(clubId\)\.accessId/);
  assert.match(rules, /request\.resource\.data\.role == "ADMIN" && request\.resource\.data\.status == "ACTIVE"/);
});

test("Rules: no existe borrado físico autorizado", () => {
  assert.doesNotMatch(rules, /allow[^;]*delete[^;]*if\s+(?!false)/);
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false/);
});
