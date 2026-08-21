import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Sustituye este bloque por el tuyo real de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBNjdUUbZDQ7u_MWJ-_GZfKSvkHl4vWb5w",
  authDomain: "cdalameda-app.firebaseapp.com",
  projectId: "cdalameda-app",
  storageBucket: "cdalameda-app.firebasestorage.app",
  messagingSenderId: "858608925144",
  appId: "1:858608925144:web:52e63009f755374ae81aad"
};

// Arrancamos la conexión con la nube
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);