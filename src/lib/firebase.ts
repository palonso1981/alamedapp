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
import {
  firebaseDevConfigStatus,
  firebaseEnvFlag,
} from "./firebaseConfig";

export interface FirebaseDevServices {
  app: FirebaseApp;
  db: Firestore;
  auth: Auth;
  useEmulator: boolean;
}

let servicesPromise: Promise<FirebaseDevServices> | null = null;
let emulatorsConnected = false;

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
  if (firebaseEnvFlag(process.env.NEXT_PUBLIC_FIREBASE_DEV_ANONYMOUS_AUTH)) {
    if (!auth.currentUser) await signInAnonymously(auth);
  }
  return { app, db, auth, useEmulator: status.useEmulator };
}

export function getFirebaseDevServices(): Promise<FirebaseDevServices> {
  servicesPromise ??= initializeFirebaseDev();
  return servicesPromise;
}
