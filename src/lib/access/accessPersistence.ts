import { ActiveAccessGrant } from "./accessDomain";
import { blocksAccessChange } from "../sync/syncTypes";

export interface AccessStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key?(index: number): string | null;
  readonly length?: number;
}

export const ACCESS_STORAGE_KEY = "alamedapp:access:rc1:v1";
export const INSTALL_STORAGE_KEY = "alamedapp:access:device:v1";

export function browserAccessStorage(): AccessStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function loadRememberedAccess(storage: AccessStorage | null = browserAccessStorage()): ActiveAccessGrant | null {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(ACCESS_STORAGE_KEY) ?? "null") as ActiveAccessGrant | null;
    if (!parsed || typeof parsed.profile?.accessId !== "string" || typeof parsed.uid !== "string" || typeof parsed.deviceInstallId !== "string") return null;
    if (!parsed.profile || typeof parsed.profile.clubId !== "string" || !["ADMIN", "EDITOR", "VIEWER"].includes(parsed.profile.role)) return null;
    return parsed;
  } catch { return null; }
}

export function saveRememberedAccess(grant: ActiveAccessGrant, storage: AccessStorage | null = browserAccessStorage()): void {
  storage?.setItem(ACCESS_STORAGE_KEY, JSON.stringify(grant));
}

export function clearRememberedAccess(storage: AccessStorage | null = browserAccessStorage()): void {
  storage?.removeItem(ACCESS_STORAGE_KEY);
}

export function getOrCreateDeviceInstallId(storage: AccessStorage | null = browserAccessStorage(), idFactory: () => string = () => globalThis.crypto.randomUUID()): string {
  if (!storage) return idFactory();
  const current = storage.getItem(INSTALL_STORAGE_KEY);
  if (current) return current;
  const created = idFactory();
  storage.setItem(INSTALL_STORAGE_KEY, created);
  return created;
}

export interface PendingLocalOperation {
  storageKey: string;
  operationId: string;
  status: string;
  entityType?: string;
  entityId?: string;
  namespace?: string;
  errorKind?: string;
}

export function pendingLocalOperations(storage: AccessStorage | null = browserAccessStorage()): PendingLocalOperation[] {
  if (!storage?.key || typeof storage.length !== "number") return [];
  const pending: PendingLocalOperation[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || (!key.startsWith("alamedapp:match:") && !key.startsWith("alamedapp:team:"))) continue;
    try {
      const parsed = JSON.parse(storage.getItem(key) ?? "null") as {
        sync?: {
          outbox?: Array<{
            id?: string;
            status?: string;
            entityType?: string;
            entityId?: string;
            namespace?: string;
            errorKind?: string;
            nextAttemptAt?: number;
          }>;
        };
      } | null;
      for (const operation of parsed?.sync?.outbox ?? []) {
        if (typeof operation.id !== "string" || !blocksAccessChange(operation)) continue;
        pending.push({
          storageKey: key,
          operationId: operation.id,
          status: operation.status ?? "PENDING",
          entityType: operation.entityType,
          entityId: operation.entityId,
          namespace: operation.namespace,
          errorKind: operation.errorKind,
        });
      }
    } catch { /* Una entrada corrupta no se borra ni se reasigna. */ }
  }
  return pending;
}
