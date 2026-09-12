import { createHash, randomBytes, randomUUID } from "node:crypto";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const clubId = process.argv[2]?.trim();
const label = process.argv.slice(3).join(" ").trim() || "Administrador inicial";
if (!clubId) {
  console.error("Uso: npm run access:bootstrap -- <clubId> [nombre del acceso]");
  process.exitCode = 1;
} else {
  const compact = Array.from(randomBytes(12), (byte) => alphabet[byte & 31]).join("");
  const code = compact.match(/.{4}/g).join("-");
  const codeHash = createHash("sha256").update(compact).digest("hex");
  const accessId = randomUUID();
  const now = Date.now();
  const profile = { entityType: "ACCESS_PROFILE", accessId, clubId, label, role: "ADMIN", scope: { type: "CLUB" }, status: "ACTIVE", credentialVersion: 1, activeCodeHash: codeHash, createdAt: now, updatedAt: now };
  const mapping = { entityType: "ACCESS_CODE", codeHash, clubId, accessId, credentialVersion: 1, status: "ACTIVE", createdAt: now };
  console.log(JSON.stringify({ warning: "Secreto mostrado una sola vez. No lo guardes en Git.", code, documents: [{ path: `clubs/${clubId}/accesses/${accessId}`, data: profile }, { path: `accessCodes/${codeHash}`, data: mapping }] }, null, 2));
}
