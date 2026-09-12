export type AccessRole = "ADMIN" | "EDITOR" | "VIEWER";
export type AccessStatus = "ACTIVE" | "DISABLED" | "DELETED";
export type AccessCodeStatus = "ACTIVE" | "REVOKED" | "DISABLED";
export type AccessScope =
  | { type: "CLUB" }
  | { type: "TEAMS"; teamIds: string[] };

export interface ClubAccessProfile {
  accessId: string;
  clubId: string;
  label: string;
  role: AccessRole;
  scope: AccessScope;
  status: AccessStatus;
  credentialVersion: number;
  activeCodeHash?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  lastUsedAt?: number;
}

export interface AccessCodeMapping {
  codeHash: string;
  clubId: string;
  accessId: string;
  credentialVersion: number;
  status: AccessCodeStatus;
  createdAt: number;
  replacedAt?: number;
}

export function activeAdminCount(
  profiles: readonly ClubAccessProfile[],
): number {
  return profiles.filter(
    (profile) => profile.role === "ADMIN" && profile.status === "ACTIVE",
  ).length;
}

export function assertCanRetireAccess(
  actorAccessId: string,
  target: ClubAccessProfile,
  profiles: readonly ClubAccessProfile[],
  next: Pick<ClubAccessProfile, "role" | "status">,
): void {
  const retiresAdmin =
    target.role === "ADMIN" &&
    target.status === "ACTIVE" &&
    (next.role !== "ADMIN" || next.status !== "ACTIVE");
  if (!retiresAdmin) return;
  if (target.accessId === actorAccessId || activeAdminCount(profiles) <= 1) {
    throw new Error("No puedes retirar el último ADMIN activo del club.");
  }
}

export interface AccessTechnicalSession {
  uid: string;
  clubId: string;
  accessId: string;
  credentialVersion: number;
  createdAt: number;
  lastValidatedAt: number;
}

export interface ActiveAccessGrant {
  uid: string;
  deviceInstallId: string;
  profile: ClubAccessProfile;
  credentialVersion: number;
  lastValidatedAt: number;
  offline: boolean;
}

export interface AccessUsageDay {
  usageId: string;
  clubId: string;
  accessId: string;
  deviceInstallId: string;
  day: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

const ACCESS_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LEGACY_CODE_LENGTH = 12;
const GENERATED_CODE_LENGTH = 16;
const MAX_CODE_LENGTH = 64;

function compactAccessCode(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/[\s-]+/g, "");
  return /^[A-Z0-9]+$/.test(compact) ? compact : null;
}

export function normalizeAccessCode(value: string): string | null {
  const compact = compactAccessCode(value);
  if (!compact || (compact.length !== LEGACY_CODE_LENGTH && (compact.length < 14 || compact.length > MAX_CODE_LENGTH))) return null;
  return compact.match(/.{1,4}/g)?.join("-") ?? null;
}

export function generateAccessCode(randomBytes?: Uint8Array): string {
  const bytes = randomBytes ?? globalThis.crypto.getRandomValues(new Uint8Array(GENERATED_CODE_LENGTH));
  if (bytes.length < GENERATED_CODE_LENGTH) throw new Error("Se necesitan 16 bytes aleatorios.");
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const compact = letters[bytes[0] % letters.length] + digits[bytes[1] % digits.length] +
    Array.from(bytes.slice(2, GENERATED_CODE_LENGTH), (byte) => ACCESS_ALPHABET[byte & 31]).join("");
  return normalizeAccessCode(compact)!;
}

export function newAccessCodeValidationError(value: string, label: string): string | null {
  const compact = compactAccessCode(value);
  if (!compact) return "Usa únicamente letras, números, espacios o guiones.";
  if (compact.length < 14) return "Usa al menos 14 letras o números.";
  if (compact.length > MAX_CODE_LENGTH) return "El código no puede superar 64 letras o números.";
  if (!/[A-Z]/.test(compact)) return "Incluye al menos una letra.";
  if (!/[0-9]/.test(compact)) return "Incluye al menos un número.";
  if (/^(.{1,4})\1{3,}$/.test(compact)) return "Este código es demasiado sencillo.";
  const compactLabel = label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (compactLabel && compact === compactLabel) return "El código no puede ser igual al nombre del acceso.";
  return null;
}

export function normalizeNewAccessCode(value: string, label: string): string {
  const error = newAccessCodeValidationError(value, label);
  if (error) throw new Error(error);
  return normalizeAccessCode(value)!;
}

export async function hashAccessCode(value: string): Promise<string> {
  const normalized = normalizeAccessCode(value);
  if (!normalized) throw new Error("Código de acceso no válido.");
  const bytes = new TextEncoder().encode(normalized.replaceAll("-", ""));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeAccessScope(role: AccessRole, scope: AccessScope): AccessScope {
  if (role !== "VIEWER" || scope.type === "CLUB") return { type: "CLUB" };
  const teamIds = Array.from(new Set(scope.teamIds.map((teamId) => teamId.trim()).filter(Boolean))).sort();
  if (teamIds.length === 0) throw new Error("Elige al menos un equipo.");
  return { type: "TEAMS", teamIds };
}

export function isActiveGrant(grant: ActiveAccessGrant | null): grant is ActiveAccessGrant {
  return Boolean(grant && grant.profile.status === "ACTIVE" && grant.credentialVersion === grant.profile.credentialVersion);
}

export function canManageAccess(grant: ActiveAccessGrant | null): boolean {
  return isActiveGrant(grant) && grant.profile.role === "ADMIN";
}

export function canMutateSports(grant: ActiveAccessGrant | null): boolean {
  return isActiveGrant(grant) && grant.profile.role !== "VIEWER";
}

export function canAccessClub(grant: ActiveAccessGrant | null, clubId: string): boolean {
  return isActiveGrant(grant) && grant.profile.clubId === clubId;
}

export function canAccessTeam(grant: ActiveAccessGrant | null, clubId: string, teamId?: string | null): boolean {
  if (!isActiveGrant(grant) || grant.profile.clubId !== clubId) return false;
  if (grant.profile.role !== "VIEWER" || grant.profile.scope.type === "CLUB") return true;
  return Boolean(teamId && grant.profile.scope.teamIds.includes(teamId));
}

export function visibleTeamIds(grant: ActiveAccessGrant | null, clubId: string, teamIds: readonly string[]): string[] {
  return teamIds.filter((teamId) => canAccessTeam(grant, clubId, teamId));
}

export function roleLabel(role: AccessRole): string {
  return role === "VIEWER" ? "VISOR" : role;
}

export function scopeLabel(scope: AccessScope): string {
  return scope.type === "CLUB" ? "Todo el club" : `${scope.teamIds.length} equipo${scope.teamIds.length === 1 ? "" : "s"}`;
}

export function accessRouteRequiresWrite(pathname: string): boolean {
  return pathname === "/configuracion"
    || pathname === "/partidos/nuevo"
    || /\/partidos\/[^/]+\/(editar|video)$/.test(pathname)
    || /\/partido\/[^/]+\/(directo|prepartido)$/.test(pathname);
}

export function canOpenRoute(grant: ActiveAccessGrant | null, pathname: string): boolean {
  if (!isActiveGrant(grant)) return false;
  if (pathname === "/accesos") return canManageAccess(grant);
  if (pathname === "/configuracion") return canMutateSports(grant);
  if (accessRouteRequiresWrite(pathname)) return canMutateSports(grant);
  return true;
}

export function utcUsageDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}
