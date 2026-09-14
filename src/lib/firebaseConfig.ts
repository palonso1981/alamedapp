import { AppEnvironment, inspectApplicationEnvironment } from "./environmentSafety";

export interface FirebaseConfigStatus {
  configured: boolean;
  reason?: string;
  useEmulator: boolean;
  projectId?: string;
  environment?: AppEnvironment;
}

export type FirebaseDevConfigStatus = FirebaseConfigStatus;

export function firebaseEnvFlag(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

/**
 * Next.js solo sustituye variables NEXT_PUBLIC cuando el acceso es estático.
 * No pasar `process.env` completo desde código cliente: en el navegador queda
 * vacío y produciría un falso error de configuración antes de inicializar Auth.
 */
export function compiledPublicEnvironment(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_FIREBASE_ENV: process.env.NEXT_PUBLIC_FIREBASE_ENV,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    NEXT_PUBLIC_FIREBASE_ANONYMOUS_AUTH: process.env.NEXT_PUBLIC_FIREBASE_ANONYMOUS_AUTH,
    NEXT_PUBLIC_FIREBASE_DEV_ANONYMOUS_AUTH: process.env.NEXT_PUBLIC_FIREBASE_DEV_ANONYMOUS_AUTH,
    NEXT_PUBLIC_FIREBASE_USE_EMULATOR: process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR,
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET: process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET,
    NODE_ENV: process.env.NODE_ENV,
  };
}

export function firebaseConfigStatus(
  environment: Record<string, string | undefined> = compiledPublicEnvironment(),
): FirebaseConfigStatus {
  const preflight = inspectApplicationEnvironment(environment);
  const useEmulator = firebaseEnvFlag(
    environment.NEXT_PUBLIC_FIREBASE_USE_EMULATOR,
  );
  const projectId = environment.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!preflight.environment) {
    return {
      configured: false,
      reason: preflight.issues[0] ?? "NEXT_PUBLIC_APP_ENV debe ser dev o prod.",
      useEmulator,
      projectId,
    };
  }
  if (!preflight.ok) {
    return {
      configured: false,
      reason: preflight.issues[0] ?? "La configuración lógica DEV no coincide con Firebase DEV.",
      useEmulator,
      projectId,
      environment: preflight.environment,
    };
  }
  if (preflight.environment === "prod" && useEmulator) {
    return { configured: false, reason: "PROD no puede iniciar con emuladores.", useEmulator, projectId, environment: "prod" };
  }
  if (!projectId) {
    return {
      configured: false,
      reason: "Falta NEXT_PUBLIC_FIREBASE_PROJECT_ID.",
      useEmulator,
    };
  }
  if (
    !useEmulator &&
    (!environment.NEXT_PUBLIC_FIREBASE_API_KEY ||
      !environment.NEXT_PUBLIC_FIREBASE_APP_ID ||
      !environment.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN)
  ) {
    return {
      configured: false,
      reason: "Faltan credenciales públicas del proyecto Firebase DEV.",
      useEmulator,
      projectId,
    };
  }
  return { configured: true, useEmulator, projectId, environment: preflight.environment };
}

/** Alias compatible mientras los repositorios conservan su nombre histórico DEV. */
export function firebaseDevConfigStatus(): FirebaseDevConfigStatus {
  return firebaseConfigStatus();
}
