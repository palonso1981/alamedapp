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

export function firebaseConfigStatus(): FirebaseConfigStatus {
  const preflight = inspectApplicationEnvironment(process.env);
  const useEmulator = firebaseEnvFlag(
    process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR,
  );
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
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
    (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
      !process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||
      !process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN)
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
