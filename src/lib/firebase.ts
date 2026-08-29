import { FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  Firestore,
  getFirestore,
} from "firebase/firestore";
import {
  Auth,
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
} from "firebase/auth";

export interface FirebaseDevConfigStatus {
  configured: boolean;
  reason?: string;
  useEmulator: boolean;
  projectId?: string;
}

export interface FirebaseDevServices {
  app: FirebaseApp;
  db: Firestore;
  auth: Auth;
  useEmulator: boolean;
}

let servicesPromise: Promise<FirebaseDevServices> | null = null;
let emulatorsConnected = false;

function envFlag(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export function firebaseDevConfigStatus(): FirebaseDevConfigStatus {
  const environment = process.env.NEXT_PUBLIC_FIREBASE_ENV;
  const useEmulator = envFlag(process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR);
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

async function initializeFirebaseDev(): Promise<FirebaseDevServices> {
  const status = firebaseDevConfigStatus();
  if (!status.configured || !status.projectId) {
    throw new Error(status.reason ?? "Firebase DEV no está configurado.");
  }
  const config = {
    apiKey:
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "firebase-emulator-only",
    authDomain:
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
      `${status.projectId}.firebaseapp.com`,
    projectId: status.projectId,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "firebase-emulator-only",
  };
  const app = getApps().length > 0 ? getApp() : initializeApp(config);
  const db = getFirestore(app);
  const auth = getAuth(app);
  if (status.useEmulator && !emulatorsConnected) {
    const host = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST ?? "127.0.0.1";
    const firestorePort = Number(
      process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_FIRESTORE_PORT ?? "8080",
    );
    const authPort = Number(
      process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_AUTH_PORT ?? "9099",
    );
    connectFirestoreEmulator(db, host, firestorePort);
    connectAuthEmulator(auth, `http://${host}:${authPort}`, {
      disableWarnings: true,
    });
    emulatorsConnected = true;
  }
  if (envFlag(process.env.NEXT_PUBLIC_FIREBASE_DEV_ANONYMOUS_AUTH)) {
    if (!auth.currentUser) await signInAnonymously(auth);
  }
  return { app, db, auth, useEmulator: status.useEmulator };
}

export function getFirebaseDevServices(): Promise<FirebaseDevServices> {
  servicesPromise ??= initializeFirebaseDev();
  return servicesPromise;
}
