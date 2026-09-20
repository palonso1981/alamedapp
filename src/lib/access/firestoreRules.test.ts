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
  assert.match(rules, /access\(clubId\)\.role in \['ADMIN', 'EDITOR'\]/);
  assert.match(rules, /match \/matches\/\{matchId\}[\s\S]*?canWriteTeam/);
});

test("Rules: EDITOR hereda club deportivo pero no Club institucional ni Access", () => {
  assert.match(rules, /access\(clubId\)\.role in \['ADMIN', 'EDITOR'\]/);
  assert.match(rules, /match \/clubs\/\{clubId\} \{[\s\S]*?allow create: if isAdmin\(clubId\)/);
  assert.match(rules, /match \/clubs\/\{clubId\} \{[\s\S]*?allow update: if isAdmin\(clubId\)/);
  assert.match(rules, /match \/clubs\/\{clubId\}\/accesses\/\{accessId\} \{[\s\S]*?allow create, update: if isAdmin\(clubId\)/);
  assert.match(rules, /match \/teams\/\{teamId\} \{[\s\S]*?allow create: if canWriteTeam\(clubId, teamId\)[\s\S]*?request\.resource\.data\.payload\.clubId == clubId/);
  assert.match(rules, /match \/teams\/\{teamId\} \{[\s\S]*?allow update: if canWriteTeam\(clubId, teamId\)[\s\S]*?nextRevision\(\)/);
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

test("Rules: MATCH nuevo autoriza ADMIN/EDITOR por Access y nunca sobreescribe revision 1", () => {
  const block = rules.match(/match \/matches\/\{matchId\} \{([\s\S]*?)\n      match \/events/)?.[1] ?? "";
  assert.match(block, /allow create: if canWriteTeam\(matchClub\(request\.resource\.data\), matchTeam\(request\.resource\.data\)\)/);
  assert.match(block, /request\.resource\.data\.entityId == matchId/);
  assert.match(block, /request\.resource\.data\.revision == 1/);
  assert.match(block, /resource\.data\.revision is int/);
  assert.match(block, /allow update:[\s\S]*?request\.resource\.data\.revision == resource\.data\.revision \+ 1/);
  assert.match(rules, /access\(clubId\)\.role in \['ADMIN', 'EDITOR'\]/);
  assert.match(rules, /access\(clubId\)\.role in \['ADMIN', 'EDITOR'\]/);
});

test("transporte: MATCH base 0 crea sin leer un documento inexistente", () => {
  const implementation = readFileSync("src/lib/sync/firestoreMatchRepository.ts", "utf8");
  const guardedCreate = implementation.indexOf('operation.entityType === "MATCH" && operation.baseRevision === 0');
  const directCreate = implementation.indexOf("await setDoc(reference, firestoreDocument(operation, 1))", guardedCreate);
  const revisionedTransaction = implementation.indexOf("return runTransaction", guardedCreate);
  assert.ok(guardedCreate >= 0);
  assert.ok(directCreate > guardedCreate);
  assert.ok(revisionedTransaction > directCreate);
});

test("Rules: altas de plantilla son revision 1 y updates avanzan exactamente una revisión", () => {
  assert.match(rules, /function initialRevision\(\) \{ return request\.resource\.data\.revision == 1; \}/);
  assert.match(rules, /function nextRevision\(\) \{ return resource\.data\.revision is int && request\.resource\.data\.revision == resource\.data\.revision \+ 1; \}/);
  const canonicalPlayers = rules.match(/match \/clubs\/\{clubId\}[\s\S]*?match \/players\/\{playerId\} \{([\s\S]*?)\n      \}/)?.[1] ?? "";
  assert.match(canonicalPlayers, /allow create:[\s\S]*?initialRevision\(\)/);
  assert.match(canonicalPlayers, /allow update:[\s\S]*?nextRevision\(\)/);
  assert.match(canonicalPlayers, /allow delete: if false/);
  const canonicalSports = rules.match(/match \/clubs\/\{clubId\} \{([\s\S]*?)\n    \/\/ Única lectura previa/)?.[1] ?? rules;
  for (const entityType of ["CLUB", "TEAM_UNIT", "PLAYER", "STAFF", "SEASON", "SEASON_PLAYER", "SEASON_STAFF"]) {
    assert.match(canonicalSports, new RegExp(`entityType == "${entityType}"`));
  }
});

test("Rules: escritura deportiva no recompone helpers de lectura hasta agotar expresiones", () => {
  assert.match(
    rules,
    /function canWriteClub\(clubId\) \{ return validAccess\(clubId\) && access\(clubId\)\.role in \['ADMIN', 'EDITOR'\]; \}/,
  );
  assert.match(
    rules,
    /function canWriteTeam\(clubId, teamId\) \{ return validAccess\(clubId\) && access\(clubId\)\.role in \['ADMIN', 'EDITOR'\]; \}/,
  );
  assert.doesNotMatch(rules, /function canWriteTeam\(clubId, teamId\) \{ return teamAllowed\(/);
});

test("transporte: toda entidad de plantilla base 0 usa creación directa protegida", () => {
  const implementation = readFileSync("src/lib/sync/firestoreTeamRepository.ts", "utf8");
  const guardedCreate = implementation.indexOf("operation.baseRevision === 0");
  const directCreate = implementation.indexOf("await setDoc(reference, firestoreDocument(operation, 1))", guardedCreate);
  const revisionedTransaction = implementation.indexOf("return runTransaction", guardedCreate);
  assert.ok(guardedCreate >= 0);
  assert.ok(directCreate > guardedCreate);
  assert.ok(revisionedTransaction > directCreate);
  assert.match(implementation, /sameFirestorePayload\(current\.payload, payload\)/);
});

test("Rules: membership activa exige maestro y admite alta conjunta mediante estado final", () => {
  assert.match(rules, /function canonicalPlayerExistsAfter\(clubId, playerId\)/);
  assert.match(rules, /existsAfter\(\/databases\/\$\(database\)\/documents\/clubs\/\$\(clubId\)\/players\/\$\(playerId\)\)/);
  assert.match(rules, /getAfter\(\/databases\/\$\(database\)\/documents\/clubs\/\$\(clubId\)\/players\/\$\(playerId\)\)\.data\.payload\.playerId == playerId/);
  assert.match(rules, /function canonicalStaffExistsAfter\(clubId, staffId\)/);
  assert.match(rules, /getAfter\(\/databases\/\$\(database\)\/documents\/clubs\/\$\(clubId\)\/staff\/\$\(staffId\)\)\.data\.payload\.staffId == staffId/);
  assert.ok((rules.match(/canonicalPlayerExistsAfter\(clubId, playerId\)/g) ?? []).length >= 3);
  assert.ok((rules.match(/canonicalStaffExistsAfter\(clubId, staffId\)/g) ?? []).length >= 3);
  assert.match(rules, /canonicalPlayerExistsAfter\(clubId, playerId\)[\s\S]*?payload\.active == false && request\.resource\.data\.payload\.deletedAt is int/);
  assert.match(rules, /canonicalStaffExistsAfter\(clubId, staffId\)[\s\S]*?payload\.active == false && request\.resource\.data\.payload\.deletedAt is int/);
});

test("transporte: PLAYER o STAFF con membership inicial usa un único writeBatch", () => {
  const implementation = readFileSync("src/lib/sync/firestoreTeamRepository.ts", "utf8");
  const companionGuard = implementation.indexOf("operation.atomicCompanions?.length");
  const batchCreation = implementation.indexOf("const batch = writeBatch(db)", companionGuard);
  const primaryWrite = implementation.indexOf("batch.set(reference", batchCreation);
  const companionWrite = implementation.indexOf("companionReference(db, operation, companion)", primaryWrite);
  const batchCommit = implementation.indexOf("await batch.commit()", companionWrite);
  assert.ok(companionGuard >= 0);
  assert.ok(batchCreation > companionGuard);
  assert.ok(primaryWrite > batchCreation);
  assert.ok(companionWrite > primaryWrite);
  assert.ok(batchCommit > companionWrite);
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

test("Rules RC2: lease exacto por partido, sin list ni delete", () => {
  const block = rules.match(/match \/matchCaptureLeases\/\{matchId\} \{([\s\S]*?)\n    \}/)?.[1] ?? "";
  assert.match(block, /allow get: if teamAllowed\(parentClub\(\), parentTeam\(\)\)/);
  assert.match(block, /allow list: if false/);
  assert.match(block, /allow delete: if false/);
  assert.match(block, /data\.entityType == "CAPTURE_LEASE"/);
  assert.match(block, /data\.accessId == session\(data\.clubId\)\.accessId/);
  assert.match(block, /request\.resource\.data\.revision == resource\.data\.revision \+ 1/);
});

test("Rules RC2: solo un escritor autorizado puede crear o actualizar el lease", () => {
  const block = rules.match(/match \/matchCaptureLeases\/\{matchId\} \{([\s\S]*?)\n    \}/)?.[1] ?? "";
  assert.match(block, /allow create: if canWriteTeam\(parentClub\(\), parentTeam\(\)\)/);
  assert.match(block, /allow update: if canWriteTeam\(parentClub\(\), parentTeam\(\)\)/);
  assert.match(block, /request\.resource\.data\.captureSessionId == resource\.data\.captureSessionId/);
  assert.match(block, /request\.resource\.data\.status == "ACTIVE"/);
});
