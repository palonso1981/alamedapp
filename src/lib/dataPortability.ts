import { AppEnvironment, assertExpectedEnvironment } from "./environmentSafety";

export const LOGICAL_DATASET_SCHEMA_VERSION = 1 as const;
export const BACKUP_BUNDLE_SCHEMA_VERSION = 1 as const;
export const MATCH_BUNDLE_SCHEMA_VERSION = 1 as const;

export interface LogicalDocument {
  path: string;
  payload: Record<string, unknown>;
}

export interface LogicalDataset {
  schemaVersion: typeof LOGICAL_DATASET_SCHEMA_VERSION;
  kind: "ALAMEDAPP_LOGICAL_DATASET";
  environment: AppEnvironment;
  projectId: string;
  documents: LogicalDocument[];
}

export interface CloudinaryReference {
  ownerPath: string;
  provider: "CLOUDINARY";
  publicId: string;
  secureUrl?: string;
  version?: number;
}

export interface BackupBundle {
  schemaVersion: typeof BACKUP_BUNDLE_SCHEMA_VERSION;
  kind: "ALAMEDAPP_LOGICAL_BACKUP";
  exportedAt: number;
  sourceEnvironment: AppEnvironment;
  sourceProjectId: string;
  appSchema: { match: 1; teamSync: 3 };
  documents: LogicalDocument[];
  accessMetadata: LogicalDocument[];
  cloudinaryReferences: CloudinaryReference[];
}

export interface MatchBundle {
  schemaVersion: typeof MATCH_BUNDLE_SCHEMA_VERSION;
  kind: "ALAMEDAPP_MATCH_EXPORT";
  exportedAt: number;
  sourceEnvironment: AppEnvironment;
  sourceProjectId: string;
  matchId: string;
  club: LogicalDocument;
  team: LogicalDocument;
  season: LogicalDocument | null;
  match: LogicalDocument;
  events: LogicalDocument[];
  referencedPlayers: LogicalDocument[];
  relevantMemberships: LogicalDocument[];
  relevantStaff: LogicalDocument[];
  relevantStaffMemberships: LogicalDocument[];
  videoMetadata: {
    segments: unknown[];
    eventOverrides: unknown[];
  };
  integrity: {
    eventIds: string[];
    playerIds: string[];
    staffIds: string[];
    warnings: string[];
  };
}

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  documentCount: number;
}

export type RestoreDisposition = "CREATE" | "UNCHANGED" | "UPDATE_SAFE" | "CONFLICT";
export interface RestoreItem {
  path: string;
  disposition: RestoreDisposition;
  reason: string;
}
export interface RestorePlan {
  dryRun: boolean;
  targetEnvironment: AppEnvironment;
  targetProjectId: string;
  items: RestoreItem[];
  counts: Record<RestoreDisposition, number>;
}

const operationalPath = /^(matchCaptureLeases\/|local\/|outbox\/|conflicts\/|usageAnalytics\/)/;
const accessPath = /(^accessCodes\/|\/accesses\/|\/accessSessions\/)/;
const forbiddenSecretKey = /^(code|accessCode|plaintext|rawCode|apiSecret|apiKey)$/i;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonical(nested)]));
  }
  return value;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !forbiddenSecretKey.test(key))
      .map(([key, nested]) => [key, sanitize(nested)]));
  }
  return value;
}

function normalizedDocuments(documents: readonly LogicalDocument[]): LogicalDocument[] {
  return documents.map((document) => ({
    path: document.path.replace(/^\/+|\/+$/g, ""),
    payload: sanitize(document.payload) as Record<string, unknown>,
  })).sort((left, right) => left.path.localeCompare(right.path));
}

function documentMap(documents: readonly LogicalDocument[]): Map<string, LogicalDocument> {
  return new Map(documents.map((document) => [document.path, document]));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function preparation(payload: Record<string, unknown>): Record<string, unknown> {
  return payload.preparation && typeof payload.preparation === "object"
    ? payload.preparation as Record<string, unknown>
    : {};
}

function collectIds(value: unknown, keyPattern: RegExp, target = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const nested of value) collectIds(nested, keyPattern, target);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (keyPattern.test(key) && typeof nested === "string" && nested && nested !== "__INFERIORITY__") target.add(nested);
      collectIds(nested, keyPattern, target);
    }
  }
  return target;
}

function collectCloudinary(documents: readonly LogicalDocument[]): CloudinaryReference[] {
  const found = new Map<string, CloudinaryReference>();
  const visit = (value: unknown, ownerPath: string) => {
    if (Array.isArray(value)) return value.forEach((nested) => visit(nested, ownerPath));
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    if (item.provider === "CLOUDINARY" && typeof item.publicId === "string") {
      const reference: CloudinaryReference = {
        ownerPath,
        provider: "CLOUDINARY",
        publicId: item.publicId,
      };
      if (typeof item.secureUrl === "string") reference.secureUrl = item.secureUrl;
      if (typeof item.version === "number") reference.version = item.version;
      found.set(ownerPath + ":" + item.publicId, reference);
    }
    Object.values(item).forEach((nested) => visit(nested, ownerPath));
  };
  documents.forEach((document) => visit(document.payload, document.path));
  return Array.from(found.values()).sort((left, right) => (left.ownerPath + left.publicId).localeCompare(right.ownerPath + right.publicId));
}

export function validateLogicalDataset(dataset: LogicalDataset): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (dataset.schemaVersion !== LOGICAL_DATASET_SCHEMA_VERSION || dataset.kind !== "ALAMEDAPP_LOGICAL_DATASET") {
    errors.push("Schema de dataset no soportado.");
  }
  try {
    assertExpectedEnvironment({ environment: dataset.environment, projectId: dataset.projectId, action: "VALIDATE" });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Entorno de dataset inválido.");
  }
  const paths = new Set<string>();
  for (const document of dataset.documents) {
    if (!document.path.trim()) errors.push("Existe un documento sin path.");
    if (paths.has(document.path)) errors.push("Path duplicado: " + document.path);
    paths.add(document.path);
    if (!document.payload || typeof document.payload !== "object" || Array.isArray(document.payload)) errors.push("Payload inválido: " + document.path);
  }
  const docs = documentMap(dataset.documents);
  for (const document of dataset.documents) {
    const eventMatch = document.path.match(/^matches\/([^/]+)\/events\/([^/]+)$/);
    if (eventMatch) {
      if (!docs.has("matches/" + eventMatch[1])) errors.push("Evento sin match: " + document.path);
      const payloadId = stringValue(document.payload.id) ?? stringValue(document.payload.eventId);
      if (payloadId && payloadId !== eventMatch[2]) errors.push("eventId no coincide con path: " + document.path);
    }
    const matchId = document.path.match(/^matches\/([^/]+)$/)?.[1];
    if (matchId) {
      const prep = preparation(document.payload);
      const clubId = stringValue(prep.clubId);
      const teamId = stringValue(prep.teamId);
      const seasonId = stringValue(prep.seasonId);
      if (!clubId || !teamId) errors.push("Match sin clubId/teamId: " + matchId);
      else {
        if (!docs.has("clubs/" + clubId)) errors.push("Match referencia club ausente: " + matchId);
        if (!docs.has("clubs/" + clubId + "/teams/" + teamId)) errors.push("Match referencia team ausente: " + matchId);
        if (seasonId && !docs.has("clubs/" + clubId + "/teams/" + teamId + "/seasons/" + seasonId)) {
          errors.push("Match referencia season ausente: " + matchId);
        }
      }
    }
    const membership = document.path.match(/^clubs\/([^/]+)\/teams\/([^/]+)\/seasons\/([^/]+)\/(players|staff)\/([^/]+)$/);
    if (membership) {
      const masterCollection = membership[4] === "players" ? "players" : "staff";
      if (!docs.has("clubs/" + membership[1] + "/" + masterCollection + "/" + membership[5])) {
        errors.push("Membership sin identidad maestra: " + document.path);
      }
    }
  }
  if (dataset.documents.some((document) => operationalPath.test(document.path))) warnings.push("El dataset contiene estado operativo; el backup lo excluirá.");
  return { ok: errors.length === 0, errors, warnings, documentCount: dataset.documents.length };
}

export function createLogicalBackup(dataset: LogicalDataset, now = Date.now()): BackupBundle {
  const validation = validateLogicalDataset(dataset);
  if (!validation.ok) throw new Error("Dataset inválido: " + validation.errors.join(" | "));
  assertExpectedEnvironment({ environment: dataset.environment, projectId: dataset.projectId, action: "BACKUP" });
  const safe = normalizedDocuments(dataset.documents.filter((document) => !operationalPath.test(document.path)));
  const accessMetadata = safe.filter((document) => accessPath.test(document.path));
  const documents = safe.filter((document) => !accessPath.test(document.path));
  return {
    schemaVersion: BACKUP_BUNDLE_SCHEMA_VERSION,
    kind: "ALAMEDAPP_LOGICAL_BACKUP",
    exportedAt: now,
    sourceEnvironment: dataset.environment,
    sourceProjectId: dataset.projectId,
    appSchema: { match: 1, teamSync: 3 },
    documents,
    accessMetadata,
    cloudinaryReferences: collectCloudinary(documents),
  };
}

export function validateBackupBundle(bundle: BackupBundle): ValidationReport {
  if (bundle.schemaVersion !== BACKUP_BUNDLE_SCHEMA_VERSION || bundle.kind !== "ALAMEDAPP_LOGICAL_BACKUP") {
    return { ok: false, errors: ["Schema de backup no soportado."], warnings: [], documentCount: 0 };
  }
  const dataset: LogicalDataset = {
    schemaVersion: 1,
    kind: "ALAMEDAPP_LOGICAL_DATASET",
    environment: bundle.sourceEnvironment,
    projectId: bundle.sourceProjectId,
    documents: [...bundle.documents, ...bundle.accessMetadata],
  };
  const report = validateLogicalDataset(dataset);
  if ([...bundle.documents, ...bundle.accessMetadata].some((document) => operationalPath.test(document.path))) {
    report.errors.push("Un backup no puede contener leases, outbox, conflictos ni analytics operativos.");
  }
  const serialized = JSON.stringify(bundle);
  if (/"(code|accessCode|plaintext|rawCode|apiSecret|apiKey)"\s*:/i.test(serialized)) {
    report.errors.push("El backup contiene una clave secreta no permitida.");
  }
  report.ok = report.errors.length === 0;
  return report;
}

export function backupDocuments(bundle: BackupBundle): LogicalDocument[] {
  const report = validateBackupBundle(bundle);
  if (!report.ok) throw new Error("Backup inválido: " + report.errors.join(" | "));
  return normalizedDocuments([...bundle.documents, ...bundle.accessMetadata]);
}

export function createSelectiveMatchBundle(dataset: LogicalDataset, matchId: string, now = Date.now()): MatchBundle {
  const validation = validateLogicalDataset(dataset);
  if (!validation.ok) throw new Error("Dataset inválido: " + validation.errors.join(" | "));
  assertExpectedEnvironment({ environment: dataset.environment, projectId: dataset.projectId, action: "EXPORT_MATCH" });
  const docs = documentMap(dataset.documents);
  const match = docs.get("matches/" + matchId);
  if (!match) throw new Error("No existe el matchId solicitado: " + matchId);
  const prep = preparation(match.payload);
  const clubId = stringValue(prep.clubId);
  const teamId = stringValue(prep.teamId);
  const seasonId = stringValue(prep.seasonId);
  if (!clubId || !teamId) throw new Error("El partido no tiene club/team exportables.");
  const club = docs.get("clubs/" + clubId);
  const team = docs.get("clubs/" + clubId + "/teams/" + teamId);
  const season = seasonId ? docs.get("clubs/" + clubId + "/teams/" + teamId + "/seasons/" + seasonId) ?? null : null;
  if (!club || !team || (seasonId && !season)) throw new Error("Faltan padres del partido.");
  const events = dataset.documents.filter((document) => document.path.startsWith("matches/" + matchId + "/events/"));
  const playerIds = collectIds([match.payload.players, events.map((item) => item.payload)], /(^|Player)playerId$|playerId|playerOutId|playerInId/i);
  const staffIds = collectIds([match.payload.staff, events.map((item) => item.payload)], /staffId/i);
  const referencedPlayers = Array.from(playerIds).map((id) => docs.get("clubs/" + clubId + "/players/" + id)).filter((item): item is LogicalDocument => Boolean(item));
  const relevantStaff = Array.from(staffIds).map((id) => docs.get("clubs/" + clubId + "/staff/" + id)).filter((item): item is LogicalDocument => Boolean(item));
  const seasonPrefix = seasonId ? "clubs/" + clubId + "/teams/" + teamId + "/seasons/" + seasonId : "";
  const relevantMemberships = seasonPrefix ? Array.from(playerIds).map((id) => docs.get(seasonPrefix + "/players/" + id)).filter((item): item is LogicalDocument => Boolean(item)) : [];
  const relevantStaffMemberships = seasonPrefix ? Array.from(staffIds).map((id) => docs.get(seasonPrefix + "/staff/" + id)).filter((item): item is LogicalDocument => Boolean(item)) : [];
  const warnings: string[] = [];
  if (referencedPlayers.length !== playerIds.size) warnings.push("Faltan identidades maestras de algún jugador referenciado.");
  if (relevantStaff.length !== staffIds.size) warnings.push("Faltan identidades maestras de algún staff referenciado.");
  warnings.push("Coordenadas legacy: se conservan raw, sin flip ni heurística.");
  return clone({
    schemaVersion: MATCH_BUNDLE_SCHEMA_VERSION,
    kind: "ALAMEDAPP_MATCH_EXPORT",
    exportedAt: now,
    sourceEnvironment: dataset.environment,
    sourceProjectId: dataset.projectId,
    matchId,
    club,
    team,
    season,
    match,
    events: normalizedDocuments(events),
    referencedPlayers: normalizedDocuments(referencedPlayers),
    relevantMemberships: normalizedDocuments(relevantMemberships),
    relevantStaff: normalizedDocuments(relevantStaff),
    relevantStaffMemberships: normalizedDocuments(relevantStaffMemberships),
    videoMetadata: {
      segments: Array.isArray(match.payload.videoSegments) ? match.payload.videoSegments : [],
      eventOverrides: Array.isArray(match.payload.videoEventOverrides) ? match.payload.videoEventOverrides : [],
    },
    integrity: {
      eventIds: events.map((item) => item.path.split("/").at(-1) as string).sort(),
      playerIds: Array.from(playerIds).sort(),
      staffIds: Array.from(staffIds).sort(),
      warnings,
    },
  });
}

export function matchBundleDocuments(bundle: MatchBundle): LogicalDocument[] {
  if (bundle.schemaVersion !== MATCH_BUNDLE_SCHEMA_VERSION || bundle.kind !== "ALAMEDAPP_MATCH_EXPORT") {
    throw new Error("Schema de bundle de partido no soportado.");
  }
  if (!bundle.matchId || bundle.match.path !== "matches/" + bundle.matchId) throw new Error("Identidad de partido incoherente.");
  const documents = normalizedDocuments([
    bundle.club,
    bundle.team,
    ...(bundle.season ? [bundle.season] : []),
    ...bundle.referencedPlayers,
    ...bundle.relevantMemberships,
    ...bundle.relevantStaff,
    ...bundle.relevantStaffMemberships,
    bundle.match,
    ...bundle.events,
  ]);
  if (documents.some((document) => operationalPath.test(document.path) || accessPath.test(document.path))) {
    throw new Error("El bundle selectivo contiene estado operativo o Access.");
  }
  const paths = new Set(documents.map((document) => document.path));
  if (paths.size !== documents.length) throw new Error("El bundle selectivo contiene IDs duplicados.");
  return documents;
}

function updatedAt(payload: Record<string, unknown>): number | null {
  return typeof payload.updatedAt === "number" ? payload.updatedAt : null;
}

export function planLogicalRestore(input: {
  documents: readonly LogicalDocument[];
  target: LogicalDataset;
  targetEnvironment: AppEnvironment;
  targetProjectId: string;
  expectedProjectId?: string;
  apply?: boolean;
  confirmationProjectId?: string;
}): RestorePlan {
  assertExpectedEnvironment({
    environment: input.targetEnvironment,
    projectId: input.targetProjectId,
    action: "RESTORE",
    expectedProjectId: input.expectedProjectId,
    apply: input.apply,
    confirmationProjectId: input.confirmationProjectId,
  });
  if (input.target.environment !== input.targetEnvironment || input.target.projectId !== input.targetProjectId) {
    throw new Error("El dataset destino no coincide con entorno/projectId declarados.");
  }
  const target = documentMap(input.target.documents);
  const items = normalizedDocuments(input.documents).map((source): RestoreItem => {
    const current = target.get(source.path);
    if (!current) return { path: source.path, disposition: "CREATE", reason: "ID ausente en destino." };
    if (same(current.payload, source.payload)) return { path: source.path, disposition: "UNCHANGED", reason: "Contenido idéntico." };
    if (current.payload.deletedAt && !source.payload.deletedAt) {
      return { path: source.path, disposition: "CONFLICT", reason: "El restore no resucita un tombstone." };
    }
    const sourceUpdatedAt = updatedAt(source.payload);
    const targetUpdatedAt = updatedAt(current.payload);
    if (sourceUpdatedAt !== null && targetUpdatedAt !== null && sourceUpdatedAt >= targetUpdatedAt) {
      return { path: source.path, disposition: "UPDATE_SAFE", reason: "Misma identidad y versión fuente no anterior." };
    }
    return { path: source.path, disposition: "CONFLICT", reason: "Mismo ID con contenido incompatible." };
  });
  const counts: Record<RestoreDisposition, number> = { CREATE: 0, UNCHANGED: 0, UPDATE_SAFE: 0, CONFLICT: 0 };
  items.forEach((item) => { counts[item.disposition] += 1; });
  return { dryRun: !input.apply, targetEnvironment: input.targetEnvironment, targetProjectId: input.targetProjectId, items, counts };
}

export function applyLogicalRestore(documents: readonly LogicalDocument[], target: LogicalDataset, plan: RestorePlan): LogicalDataset {
  if (plan.dryRun) throw new Error("Un plan dry-run nunca puede escribir.");
  if (plan.counts.CONFLICT > 0) throw new Error("No se aplica un restore con conflictos.");
  const next = documentMap(normalizedDocuments(target.documents));
  const source = documentMap(normalizedDocuments(documents));
  for (const item of plan.items) {
    if (item.disposition === "CREATE" || item.disposition === "UPDATE_SAFE") {
      const document = source.get(item.path);
      if (document) next.set(item.path, clone(document));
    }
  }
  return { ...target, documents: Array.from(next.values()).sort((left, right) => left.path.localeCompare(right.path)) };
}
