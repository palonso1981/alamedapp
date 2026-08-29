export interface FirebaseDevConfigStatus {
  configured: boolean;
  reason?: string;
  useEmulator: boolean;
  projectId?: string;
}

export function firebaseEnvFlag(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export function firebaseDevConfigStatus(): FirebaseDevConfigStatus {
  const environment = process.env.NEXT_PUBLIC_FIREBASE_ENV;
  const useEmulator = firebaseEnvFlag(
    process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR,
  );
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (environment !== "dev") {
    return {
      configured: false,
      reason: "NEXT_PUBLIC_FIREBASE_ENV debe ser dev.",
      useEmulator,
      projectId,
    };
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
  return { configured: true, useEmulator, projectId };
}
