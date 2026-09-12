export type AccessRole = "ADMIN" | "EDITOR" | "VIEWER";
export type AccessStatus = "ACTIVE" | "DISABLED";
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
  lastUsedAt?: number;
}

export interface AccessCodeMapping {
  codeHash: string;
  clubId: string;
  accessId: string;
  credentialVersion: number;
  status: AccessStatus;
  createdAt: number;
  replacedAt?: number;
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
const CODE_LENGTH = 12;

export function normalizeAccessCode(value: string): string | null {
  const compact = value.toUpperCase().replace(/[\s-]+/g, "");
  if (compact.length !== CODE_LENGTH) return null;
  if (compact.split("").some((character) => !ACCESS_ALPHABET.includes(character))) return null;
  return compact.match(/.{1,4}/g)?.join("-") ?? null;
}

export function generateAccessCode(randomBytes?: Uint8Array): string {
  const bytes = randomBytes ?? globalThis.crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  if (bytes.length < CODE_LENGTH) throw new Error("Se necesitan 12 bytes aleatorios.");
  const compact = Array.from(bytes.slice(0, CODE_LENGTH), (byte) => ACCESS_ALPHABET[byte & 31]).join("");
  return normalizeAccessCode(compact)!;
}

export async function hashAccessCode(value: string): Promise<string> {
  const normalized = normalizeAccessCode(value);
  if (!normalized) throw new Error("Código de acceso no válido.");
  const bytes = new TextEncoder().encode(normalized.replaceAll("-", ""));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeAccessScope(role: AccessRole, scope: AccessScope): AccessScope {
  if (role === "ADMIN" || scope.type === "CLUB") return { type: "CLUB" };
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
  if (grant.profile.role === "ADMIN" || grant.profile.scope.type === "CLUB") return true;
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
  if (pathname === "/accesos" || pathname === "/configuracion") return canManageAccess(grant);
  if (accessRouteRequiresWrite(pathname)) return canMutateSports(grant);
  return true;
}

export function utcUsageDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}
