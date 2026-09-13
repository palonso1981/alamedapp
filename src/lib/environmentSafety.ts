export const ALAMEDAPP_DEV_FIREBASE_PROJECT_ID = "cdalameda-dev" as const;
export const ALAMEDAPP_DEV_CLOUDINARY_CLOUD = "xc7h48kz" as const;
export const ALAMEDAPP_DEV_CLOUDINARY_PRESET = "alamedapp_players_dev" as const;

export type AppEnvironment = "dev" | "prod";
export type DataAction = "PREFLIGHT" | "BACKUP" | "VALIDATE" | "RESTORE" | "EXPORT_MATCH" | "IMPORT_MATCH";

export interface EnvironmentAssertion {
  environment: AppEnvironment;
  projectId: string;
  action: DataAction;
  apply?: boolean;
  expectedProjectId?: string;
  confirmationProjectId?: string;
}

export function normalizeAppEnvironment(value: string | undefined): AppEnvironment | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "dev" || normalized === "development") return "dev";
  if (normalized === "prod" || normalized === "production") return "prod";
  return null;
}

/** Guard central: valida entorno y proyecto sin consultar ni escribir remoto. */
export function assertExpectedEnvironment(input: EnvironmentAssertion): void {
  const projectId = input.projectId.trim();
  if (!projectId) throw new Error("Falta el Firebase projectId explícito.");
  if (input.environment === "dev" && projectId !== ALAMEDAPP_DEV_FIREBASE_PROJECT_ID) {
    throw new Error("DEV solo puede apuntar a " + ALAMEDAPP_DEV_FIREBASE_PROJECT_ID + ".");
  }
  if (input.environment === "prod" && projectId === ALAMEDAPP_DEV_FIREBASE_PROJECT_ID) {
    throw new Error("Una operación PROD no puede apuntar a cdalameda-dev.");
  }
  if (input.environment === "prod" && /^(prod|production|replace|todo|example)/i.test(projectId)) {
    throw new Error("El projectId PROD sigue siendo un placeholder.");
  }
  if (input.expectedProjectId && projectId !== input.expectedProjectId.trim()) {
    throw new Error("Proyecto inesperado: se esperaba " + input.expectedProjectId + ".");
  }
  if (input.apply) {
    if (!input.expectedProjectId) throw new Error("--apply exige expectedProjectId explícito.");
    if (input.confirmationProjectId !== projectId) {
      throw new Error("--apply exige confirmar literalmente el projectId de destino.");
    }
    if (!["RESTORE", "IMPORT_MATCH"].includes(input.action)) {
      throw new Error("La acción " + input.action + " nunca admite --apply.");
    }
  }
}

export interface EnvironmentPreflight {
  ok: boolean;
  environment: AppEnvironment | null;
  firebaseEnvironment: string | null;
  firebaseProjectId: string | null;
  cloudinaryCloud: string | null;
  cloudinaryPreset: string | null;
  useEmulator: boolean;
  firebasePublicConfigComplete: boolean;
  anonymousAuthEnabled: boolean;
  buildMode: string;
  issues: string[];
}

export function inspectApplicationEnvironment(env: Record<string, string | undefined>): EnvironmentPreflight {
  const environment = normalizeAppEnvironment(env.NEXT_PUBLIC_APP_ENV ?? env.NEXT_PUBLIC_FIREBASE_ENV);
  const firebaseEnvironment = env.NEXT_PUBLIC_FIREBASE_ENV?.trim() || null;
  const firebaseProjectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || null;
  const cloudinaryCloud = env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim() || null;
  const cloudinaryPreset = env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET?.trim() || null;
  const useEmulator = env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === "true" || env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === "1";
  const firebasePublicConfigComplete = useEmulator || Boolean(
    env.NEXT_PUBLIC_FIREBASE_API_KEY &&
    env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN &&
    env.NEXT_PUBLIC_FIREBASE_APP_ID,
  );
  const anonymousAuthEnabled = (env.NEXT_PUBLIC_FIREBASE_ANONYMOUS_AUTH ?? env.NEXT_PUBLIC_FIREBASE_DEV_ANONYMOUS_AUTH) === "true"
    || (env.NEXT_PUBLIC_FIREBASE_ANONYMOUS_AUTH ?? env.NEXT_PUBLIC_FIREBASE_DEV_ANONYMOUS_AUTH) === "1";
  const issues: string[] = [];
  if (!environment) issues.push("Falta NEXT_PUBLIC_APP_ENV=dev|prod.");
  if (!firebaseProjectId) issues.push("Falta NEXT_PUBLIC_FIREBASE_PROJECT_ID.");
  if (!firebasePublicConfigComplete) issues.push("Falta configuración pública Firebase completa.");
  if (!anonymousAuthEnabled) issues.push("Anonymous Auth no está declarado como activo.");
  if (!cloudinaryCloud) issues.push("Falta NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME.");
  if (!cloudinaryPreset) issues.push("Falta NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET.");
  if (environment === "dev") {
    if (firebaseEnvironment !== "dev") issues.push("DEV exige NEXT_PUBLIC_FIREBASE_ENV=dev.");
    if (firebaseProjectId !== ALAMEDAPP_DEV_FIREBASE_PROJECT_ID) issues.push("DEV exige projectId " + ALAMEDAPP_DEV_FIREBASE_PROJECT_ID + ".");
    if (cloudinaryCloud && cloudinaryCloud !== ALAMEDAPP_DEV_CLOUDINARY_CLOUD) issues.push("El cloud Cloudinary no coincide con DEV.");
    if (cloudinaryPreset && cloudinaryPreset !== ALAMEDAPP_DEV_CLOUDINARY_PRESET) issues.push("El preset Cloudinary no coincide con DEV.");
  }
  if (environment === "prod") {
    if (firebaseEnvironment !== "prod") issues.push("PROD exige NEXT_PUBLIC_FIREBASE_ENV=prod.");
    if (firebaseProjectId === ALAMEDAPP_DEV_FIREBASE_PROJECT_ID) issues.push("PROD no puede usar cdalameda-dev.");
    if (firebaseProjectId && /^(prod|production|replace|todo|example)/i.test(firebaseProjectId)) issues.push("El projectId PROD sigue siendo un placeholder.");
    if (cloudinaryCloud && /^(prod|production|replace|todo|example)/i.test(cloudinaryCloud)) issues.push("El cloud Cloudinary PROD sigue siendo un placeholder.");
    if (cloudinaryPreset && /^(prod|production|replace|todo|example)/i.test(cloudinaryPreset)) issues.push("El preset Cloudinary PROD sigue siendo un placeholder.");
    if (cloudinaryCloud === ALAMEDAPP_DEV_CLOUDINARY_CLOUD) issues.push("PROD no puede reutilizar el cloud DEV.");
    if (cloudinaryPreset === ALAMEDAPP_DEV_CLOUDINARY_PRESET) issues.push("PROD no puede reutilizar el preset DEV.");
  }
  return {
    ok: issues.length === 0,
    environment,
    firebaseEnvironment,
    firebaseProjectId,
    cloudinaryCloud,
    cloudinaryPreset,
    useEmulator,
    firebasePublicConfigComplete,
    anonymousAuthEnabled,
    buildMode: env.NODE_ENV ?? "unknown",
    issues,
  };
}
