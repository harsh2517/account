
// import { initializeApp, getApp, getApps } from 'firebase-admin/app';
// import { getFirestore, FieldValue } from 'firebase-admin/firestore';
// import { getAuth } from 'firebase-admin/auth';

// const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

// if (!projectId) {
//   console.error(
//     "CRITICAL_ERROR: Firebase Project ID (NEXT_PUBLIC_FIREBASE_PROJECT_ID) is missing from your environment variables. " +
//     "This is required for server-side operations. " +
//     "Please ensure this variable is correctly set in your .env file or hosting provider's environment variables. " +
//     "After adding/updating it, you MUST restart your server for the changes to take effect."
//   );
//   throw new Error(
//     "Firebase Admin SDK configuration error: NEXT_PUBLIC_FIREBASE_PROJECT_ID is not defined in environment variables. " +
//     "Check your .env file and restart the server."
//   );
// }

// // Ensure this file is only run once and the app is initialized once.
// if (getApps().length === 0) {
//   initializeApp({
//     projectId: projectId,
//   });
// }

// const adminApp = getApp();
// const adminDb = getFirestore(adminApp);
// const adminAuth = getAuth(adminApp);

// export { adminDb, adminAuth, FieldValue };


import { initializeApp, getApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Service account configuration
const serviceAccount = {
  type: "service_account",
  project_id: "accountooze-live-jnl5g",
  private_key_id: "e86577b025a1665212d1eec1af141eaee7edbfa1",
  private_key: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n') || "",
  client_email: "firebase-adminsdk-fbsvc@accountooze-live-jnl5g.iam.gserviceaccount.com",
  client_id: "114075822948678186838",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40accountooze-live-jnl5g.iam.gserviceaccount.com"
};

if (!serviceAccount.private_key) {
  throw new Error(
    "Firebase Admin SDK configuration error: FIREBASE_ADMIN_PRIVATE_KEY is not defined in environment variables."
  );
}

// Initialize Firebase Admin SDK
if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
  });
}

const adminApp = getApp();
const adminDb = getFirestore(adminApp);
const adminAuth = getAuth(adminApp);

export { adminDb, adminAuth, FieldValue };