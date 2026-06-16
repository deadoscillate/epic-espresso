// -----------------------------------------------------------------------------
// Firebase configuration
// -----------------------------------------------------------------------------
// Firebase *web* config values are NOT secret — they are designed to ship in
// client-side code, and access is controlled by your Realtime Database security
// rules, not by hiding these values. They live in this separate file so you can
// swap in your own project without touching app logic (and so you can keep this
// file out of source control later if you prefer).
//
// ENABLE CROSS-DEVICE SYNC (recommended for real use):
//   1. Create a project at https://console.firebase.google.com
//   2. Build → Realtime Database → Create Database (start in test mode, then
//      lock it down with the rules shown in the README).
//   3. Project settings → General → "Your apps" → add a Web app and copy its
//      `firebaseConfig` object.
//   4. Paste your values below, replacing the empty placeholders.
//
// Until real values are present here, the app automatically runs in DEMO MODE:
// state is stored in this browser's localStorage only (single device, syncs
// between tabs on the same machine). Great for trying it out; not suitable for
// driving a separate warehouse display.
// -----------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  databaseURL: "", // e.g. "https://your-project-default-rtdb.firebaseio.com"
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

// The app treats Firebase as "configured" only when the two fields that
// Realtime Database actually needs are present.
export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL);
}
