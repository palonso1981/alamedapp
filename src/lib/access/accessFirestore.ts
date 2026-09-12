import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { getFirebaseDevServices } from "../firebase";
import { AccessCodeMapping, AccessRole, AccessScope, AccessStatus, AccessTechnicalSession, AccessUsageDay, ActiveAccessGrant, ClubAccessProfile, assertCanRetireAccess, generateAccessCode, hashAccessCode, normalizeAccessScope, regenerateAccessProfile, utcUsageDay } from "./accessDomain";
import { getOrCreateDeviceInstallId } from "./accessPersistence";

export type AccessFailure = "INVALID_CODE" | "DISABLED" | "OFFLINE" | "UNAUTHORIZED";

export class AccessError extends Error {
  constructor(public readonly kind: AccessFailure, message: string) { super(message); }
}

function firebaseAccessError(error: unknown, fallback: string): AccessError {
  if (error instanceof AccessError) return error;
  if (error instanceof FirebaseError && ["unavailable", "auth/network-request-failed", "firestore/unavailable"].some((code) => error.code.endsWith(code))) {
    return new AccessError("OFFLINE", "No hay conexión para validar este código.");
  }
  return new AccessError("UNAUTHORIZED", fallback);
}

function validProfile(value: unknown): value is ClubAccessProfile {
  const profile = value as Partial<ClubAccessProfile> | null;
  return Boolean(profile && typeof profile.accessId === "string" && typeof profile.clubId === "string" && typeof profile.label === "string" && ["ADMIN", "EDITOR", "VIEWER"].includes(profile.role ?? "") && ["ACTIVE", "DISABLED", "DELETED"].includes(profile.status ?? "") && typeof profile.credentialVersion === "number");
}

function validMapping(value: unknown, codeHash: string): value is AccessCodeMapping {
  const mapping = value as (Partial<AccessCodeMapping> & { entityType?: string }) | null;
  return Boolean(mapping && mapping.entityType === "ACCESS_CODE" && mapping.codeHash === codeHash && typeof mapping.clubId === "string" && typeof mapping.accessId === "string" && typeof mapping.credentialVersion === "number" && ["ACTIVE", "REVOKED", "DISABLED"].includes(mapping.status ?? ""));
}

function accessOperationError(error: unknown, action: string): Error {
  if (error instanceof AccessError) return error;
  if (error instanceof FirebaseError) {
    const code = error.code.replace(/^firestore\//, "");
    return new Error(
      process.env.NODE_ENV === "development"
        ? `${action} [${code}]. ${error.message}`
        : action,
    );
  }
  return error instanceof Error ? error : new Error(action);
}

async function servicesWithUser() {
  try {
    const services = await getFirebaseDevServices();
    if (!services.auth.currentUser) await signInAnonymously(services.auth);
    const user = services.auth.currentUser;
    if (!user) throw new Error("No se pudo iniciar la identidad técnica.");
    return { ...services, user };
  } catch (error) {
    throw firebaseAccessError(error, "No se pudo iniciar la identidad técnica.");
  }
}

export async function redeemAccessCode(code: string, now = Date.now()): Promise<ActiveAccessGrant> {
  const codeHash = await hashAccessCode(code).catch(() => { throw new AccessError("INVALID_CODE", "Código incorrecto."); });
  const { db, user } = await servicesWithUser();
  try {
    const codeSnapshot = await getDoc(doc(db, "accessCodes", codeHash));
    if (!codeSnapshot.exists()) throw new AccessError("INVALID_CODE", "Código incorrecto.");
    const rawMapping = codeSnapshot.data();
    if (!validMapping(rawMapping, codeHash)) throw new AccessError("INVALID_CODE", "Código incorrecto.");
    const mapping = rawMapping;
    if (mapping.status !== "ACTIVE") throw new AccessError("DISABLED", "Este acceso está desactivado.");
    const technicalSession: AccessTechnicalSession & { entityType: "ACCESS_SESSION"; status: "ACTIVE"; codeHash: string; serverUpdatedAt: unknown } = {
      entityType: "ACCESS_SESSION", status: "ACTIVE", uid: user.uid, clubId: mapping.clubId, accessId: mapping.accessId,
      credentialVersion: mapping.credentialVersion, codeHash, createdAt: now, lastValidatedAt: now, serverUpdatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, "clubs", mapping.clubId, "accessSessions", user.uid), technicalSession);
    // Solo después de que Rules hayan validado y creado la sesión puede leerse el perfil.
    const profileSnapshot = await getDoc(doc(db, "clubs", mapping.clubId, "accesses", mapping.accessId));
    const rawProfile = profileSnapshot.data();
    if (!profileSnapshot.exists() || !validProfile(rawProfile)) throw new AccessError("INVALID_CODE", "Código incorrecto.");
    const profile = rawProfile;
    if (profile.status !== "ACTIVE" || profile.credentialVersion !== mapping.credentialVersion) throw new AccessError("DISABLED", "Este acceso está desactivado.");
    return { uid: user.uid, deviceInstallId: getOrCreateDeviceInstallId(), profile, credentialVersion: profile.credentialVersion, lastValidatedAt: now, offline: false };
  } catch (error) {
    throw firebaseAccessError(error, "No se pudo validar este acceso.");
  }
}

export async function validateRememberedGrant(grant: ActiveAccessGrant, now = Date.now()): Promise<ActiveAccessGrant> {
  const { db, user } = await servicesWithUser();
  if (user.uid !== grant.uid) throw new AccessError("UNAUTHORIZED", "La identidad técnica de este dispositivo ha cambiado.");
  try {
    const [sessionSnapshot, profileSnapshot] = await Promise.all([
      getDoc(doc(db, "clubs", grant.profile.clubId, "accessSessions", user.uid)),
      getDoc(doc(db, "clubs", grant.profile.clubId, "accesses", grant.profile.accessId)),
    ]);
    const session = sessionSnapshot.data() as (AccessTechnicalSession & { status?: string }) | undefined;
    if (!sessionSnapshot.exists() || session?.status !== "ACTIVE") throw new AccessError("UNAUTHORIZED", "Este dispositivo ya no tiene un acceso válido.");
    const rawProfile = profileSnapshot.data();
    if (!profileSnapshot.exists() || !validProfile(rawProfile)) throw new AccessError("UNAUTHORIZED", "Este acceso ya no existe.");
    const profile = rawProfile;
    if (profile.status !== "ACTIVE" || session.credentialVersion !== profile.credentialVersion || session.accessId !== profile.accessId) throw new AccessError("DISABLED", "Este acceso está desactivado o su código fue regenerado.");
    return { ...grant, uid: user.uid, profile, credentialVersion: profile.credentialVersion, lastValidatedAt: now, offline: false };
  } catch (error) {
    throw firebaseAccessError(error, "No se pudo volver a validar el acceso.");
  }
}

export async function closeTechnicalSession(grant: ActiveAccessGrant, now = Date.now()): Promise<void> {
  const { db, user } = await servicesWithUser();
  if (user.uid !== grant.uid) throw new AccessError("UNAUTHORIZED", "No se puede cerrar un acceso de otra identidad técnica.");
  await setDoc(doc(db, "clubs", grant.profile.clubId, "accessSessions", user.uid), { status: "CLOSED", lastValidatedAt: now, serverUpdatedAt: serverTimestamp() }, { merge: true });
}

export async function recordDailyUsage(grant: ActiveAccessGrant, now = Date.now()): Promise<void> {
  const storageKey = `alamedapp:access:usage:${grant.profile.accessId}:${utcUsageDay(now)}`;
  if (typeof window !== "undefined" && window.localStorage.getItem(storageKey)) return;
  const { db } = await servicesWithUser();
  const day = utcUsageDay(now);
  const usageId = `${day}_${grant.deviceInstallId}`;
  const value: AccessUsageDay & { entityType: "ACCESS_USAGE"; serverUpdatedAt: unknown } = {
    entityType: "ACCESS_USAGE", usageId, clubId: grant.profile.clubId, accessId: grant.profile.accessId,
    deviceInstallId: grant.deviceInstallId, day, firstSeenAt: now, lastSeenAt: now, serverUpdatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, "clubs", grant.profile.clubId, "accessUsage", grant.profile.accessId, "days", usageId), value, { merge: true });
  if (typeof window !== "undefined") window.localStorage.setItem(storageKey, String(now));
}

export interface AccessUsageSummary { lastUsedAt: number | null; approximateDevices30d: number; activeDays30d: number }

export async function listClubAccesses(clubId: string, now = Date.now()): Promise<Array<{ profile: ClubAccessProfile; usage: AccessUsageSummary }>> {
  const { db } = await servicesWithUser();
  const profiles = (await getDocs(collection(db, "clubs", clubId, "accesses"))).docs.map((item) => item.data()).filter(validProfile);
  const threshold = utcUsageDay(now - 30 * 24 * 60 * 60 * 1000);
  return Promise.all(profiles.map(async (profile) => {
    const days = (await getDocs(collection(db, "clubs", clubId, "accessUsage", profile.accessId, "days"))).docs.map((item) => item.data() as AccessUsageDay).filter((item) => item.day >= threshold);
    return { profile, usage: { lastUsedAt: days.reduce<number | null>((latest, item) => latest === null || item.lastSeenAt > latest ? item.lastSeenAt : latest, null), approximateDevices30d: new Set(days.map((item) => item.deviceInstallId)).size, activeDays30d: new Set(days.map((item) => item.day)).size } };
  }));
}

async function listAccessProfiles(clubId: string): Promise<ClubAccessProfile[]> {
  const { db } = await servicesWithUser();
  return (await getDocs(collection(db, "clubs", clubId, "accesses"))).docs
    .map((item) => item.data())
    .filter(validProfile);
}

export async function createClubAccess(input: { clubId: string; label: string; role: AccessRole; scope: AccessScope }, now = Date.now()): Promise<{ profile: ClubAccessProfile; code: string }> {
  const { db } = await servicesWithUser();
  const code = generateAccessCode();
  const codeHash = await hashAccessCode(code);
  const accessId = globalThis.crypto.randomUUID();
  const role = input.role;
  const profile: ClubAccessProfile & { entityType: "ACCESS_PROFILE"; serverUpdatedAt: unknown } = {
    entityType: "ACCESS_PROFILE", accessId, clubId: input.clubId, label: input.label.trim(), role,
    scope: normalizeAccessScope(role, input.scope), status: "ACTIVE", credentialVersion: 1, activeCodeHash: codeHash,
    createdAt: now, updatedAt: now, serverUpdatedAt: serverTimestamp(),
  };
  if (!profile.label) throw new Error("Escribe un nombre para el acceso.");
  const mapping: AccessCodeMapping & { entityType: "ACCESS_CODE"; serverUpdatedAt: unknown } = {
    entityType: "ACCESS_CODE", codeHash, clubId: input.clubId, accessId, credentialVersion: 1, status: "ACTIVE", createdAt: now, serverUpdatedAt: serverTimestamp(),
  };
  const batch = writeBatch(db);
  batch.set(doc(db, "clubs", input.clubId, "accesses", accessId), profile);
  batch.set(doc(db, "accessCodes", codeHash), mapping);
  try {
    await batch.commit();
  } catch (error) {
    throw accessOperationError(error, "No se pudo confirmar conjuntamente el perfil y su código.");
  }
  return { profile, code };
}

export async function updateClubAccess(profile: ClubAccessProfile, input: { label: string; role: AccessRole; scope: AccessScope; status?: AccessStatus }, now = Date.now(), actorAccessId?: string): Promise<ClubAccessProfile> {
  const { db } = await servicesWithUser();
  const profiles = await listAccessProfiles(profile.clubId);
  const nextStatus = input.status ?? profile.status;
  const next: ClubAccessProfile & { entityType: "ACCESS_PROFILE"; serverUpdatedAt: unknown } = {
    ...profile, entityType: "ACCESS_PROFILE", label: input.label.trim(), role: input.role,
    scope: normalizeAccessScope(input.role, input.scope), status: nextStatus,
    ...(nextStatus === "DELETED" ? { deletedAt: profile.deletedAt ?? now } : {}),
    updatedAt: now, serverUpdatedAt: serverTimestamp(),
  };
  if (!next.label) throw new Error("Escribe un nombre para el acceso.");
  assertCanRetireAccess(actorAccessId ?? "", profile, profiles, next);
  const activeMappingRef = next.activeCodeHash ? doc(db, "accessCodes", next.activeCodeHash) : null;
  const activeMapping = activeMappingRef && next.status !== "ACTIVE"
    ? await getDoc(activeMappingRef)
    : null;
  const batch = writeBatch(db);
  batch.set(doc(db, "clubs", profile.clubId, "accesses", profile.accessId), next);
  if (activeMappingRef && activeMapping?.data()?.status === "ACTIVE") {
    batch.set(activeMappingRef, { status: "REVOKED", replacedAt: now, serverUpdatedAt: serverTimestamp() }, { merge: true });
  }
  try {
    await batch.commit();
  } catch (error) {
    throw accessOperationError(error, "No se pudo actualizar el acceso.");
  }
  return next;
}

export async function regenerateClubAccess(profile: ClubAccessProfile, now = Date.now()): Promise<{ profile: ClubAccessProfile; code: string }> {
  const code = generateAccessCode();
  const codeHash = await hashAccessCode(code);
  const { db } = await servicesWithUser();
  const profileRef = doc(db, "clubs", profile.clubId, "accesses", profile.accessId);
  const next = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(profileRef);
    const rawProfile = snapshot.data();
    if (!snapshot.exists() || !validProfile(rawProfile)) throw new Error("El acceso ya no existe.");
    const current = rawProfile;
    if (current.status === "DELETED") throw new Error("Un acceso eliminado no puede regenerarse.");
    const updated = regenerateAccessProfile(current, codeHash, now);
    const previousMappingRef = current.activeCodeHash ? doc(db, "accessCodes", current.activeCodeHash) : null;
    const previousMapping = previousMappingRef ? await transaction.get(previousMappingRef) : null;
    if (previousMappingRef && previousMapping?.data()?.status === "ACTIVE") {
      transaction.set(previousMappingRef, { status: "REVOKED", replacedAt: now, serverUpdatedAt: serverTimestamp() }, { merge: true });
    }
    transaction.set(doc(db, "accessCodes", codeHash), { entityType: "ACCESS_CODE", codeHash, clubId: current.clubId, accessId: current.accessId, credentialVersion: updated.credentialVersion, status: "ACTIVE", createdAt: now, serverUpdatedAt: serverTimestamp() });
    transaction.set(profileRef, { ...updated, entityType: "ACCESS_PROFILE", serverUpdatedAt: serverTimestamp() });
    return updated;
  }).catch((error) => { throw accessOperationError(error, "No se pudo regenerar el código."); });
  return { profile: next, code };
}

export async function deleteClubAccess(
  profile: ClubAccessProfile,
  actorAccessId: string,
  now = Date.now(),
): Promise<ClubAccessProfile> {
  return updateClubAccess(
    profile,
    { label: profile.label, role: profile.role, scope: profile.scope, status: "DELETED" },
    now,
    actorAccessId,
  );
}

export async function reactivateClubAccess(
  profile: ClubAccessProfile,
  now = Date.now(),
): Promise<{ profile: ClubAccessProfile; code: string }> {
  if (profile.status !== "DISABLED") throw new Error("Solo puede reactivarse un acceso desactivado.");
  return regenerateClubAccess(profile, now);
}
