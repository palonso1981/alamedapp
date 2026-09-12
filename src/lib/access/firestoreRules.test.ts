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
  assert.match(block, /exists\(codePath\(request\.resource\.data\.codeHash\)\)/);
  assert.match(block, /get\(accessPath\(clubId, request\.resource\.data\.accessId\)\)\.data\.status == "ACTIVE"/);
  assert.match(block, /credentialVersion/);
});

test("Rules: roles, scope y revocación protegen deporte", () => {
  assert.match(rules, /access\(clubId\)\.status == 'ACTIVE'/);
  assert.match(rules, /access\(clubId\)\.credentialVersion == session\(clubId\)\.credentialVersion/);
  assert.match(rules, /teamId in access\(clubId\)\.scope\.teamIds/);
  assert.match(rules, /access\(clubId\)\.role != 'VIEWER'/);
  assert.match(rules, /match \/matches\/\{matchId\}[\s\S]*?canWriteTeam/);
});

test("Rules: no existe borrado físico autorizado", () => {
  assert.doesNotMatch(rules, /allow[^;]*delete[^;]*if\s+(?!false)/);
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false/);
});
