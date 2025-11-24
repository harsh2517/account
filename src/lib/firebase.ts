
import { initializeApp, getApps, getApp, type FirebaseOptions } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, serverTimestamp, type FieldValue } from "firebase/firestore";

// Check if the essential API key environment variable is present
if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
  console.error(
    "CRITICAL_ERROR: Firebase API Key (NEXT_PUBLIC_FIREBASE_API_KEY) is missing from your environment variables. " +
    "Please ensure this variable is correctly set in your .env.local file (for local development) " +
    "or in your hosting provider's environment variable settings (for deployment). " +
    "After adding/updating it in .env.local, you MUST restart your Next.js development server."
  );
  // Throw a specific error to halt execution if the key is missing
  throw new Error(
    "Firebase configuration error: NEXT_PUBLIC_FIREBASE_API_KEY is not defined in environment variables. " +
    "Please check your .env.local file or deployment settings and restart your server."
  );
}

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  databaseURL: `https://console.firebase.google.com/project/${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}/firestore/data/~2F`
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db, serverTimestamp };
export type { FieldValue };
