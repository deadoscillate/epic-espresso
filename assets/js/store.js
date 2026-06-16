// -----------------------------------------------------------------------------
// Coffee store — the storage abstraction layer
// -----------------------------------------------------------------------------
// Both pages talk only to this interface, never to Firebase or localStorage
// directly:
//
//   const store = createCoffeeStore();
//   store.onChange(state => { ... });        // { status, message, updatedAt }
//   store.onConnection(conn => { ... });     // { online, mode, label }
//   await store.setStatus({ status, message });
//   await store.init();
//
// Backend selection is automatic:
//   • Firebase Realtime Database when assets/js/config.js is filled in.
//   • Otherwise a localStorage "demo mode" (single device, syncs across tabs).
//
// To add Supabase (or any other backend) later, implement an `initX()` that
// wires up the same `setState` / `setConnection` callbacks and assigns
// `applyWrite`. Nothing in the UI needs to change.
// -----------------------------------------------------------------------------

import { firebaseConfig, isFirebaseConfigured } from "./config.js";
import { STATUSES, DEFAULT_STATUS_ID } from "./statuses.js";

const DEMO_KEY = "bsmeb:state";
const MESSAGE_MAX = 280;

// Pinned Firebase SDK version for the CDN ES module imports.
const FIREBASE_VERSION = "10.12.2";

const DEFAULT_STATE = { status: DEFAULT_STATUS_ID, message: "", updatedAt: null };

// Defensive normalisation so the UI can trust whatever comes back from storage.
function sanitize(raw) {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_STATE };
  return {
    status: STATUSES[raw.status] ? raw.status : DEFAULT_STATUS_ID,
    message: typeof raw.message === "string" ? raw.message.slice(0, MESSAGE_MAX) : "",
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : null,
  };
}

export function createCoffeeStore() {
  const changeHandlers = new Set();
  const connHandlers = new Set();

  let state = { ...DEFAULT_STATE };
  let hasData = false;
  let connection = {
    online: false,
    mode: isFirebaseConfigured() ? "firebase" : "demo",
    label: "Connecting…",
  };

  // Replaced by the active backend during init().
  let applyWrite = async () => {
    throw new Error("Store not initialised yet.");
  };

  const emitChange = () => changeHandlers.forEach((h) => h(state));
  const emitConn = () => connHandlers.forEach((h) => h(connection));

  function setConnection(patch) {
    connection = { ...connection, ...patch };
    emitConn();
  }

  function setState(next) {
    state = sanitize(next);
    hasData = true;
    emitChange();
  }

  // --- Backend: Firebase Realtime Database --------------------------------
  async function initFirebase() {
    const [{ initializeApp }, db] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-database.js`),
    ]);
    const { getDatabase, ref, onValue, set, serverTimestamp } = db;

    const app = initializeApp(firebaseConfig);
    const database = getDatabase(app);
    const stateRef = ref(database, "coffee"); // { status, message, updatedAt }
    const connectedRef = ref(database, ".info/connected");

    onValue(connectedRef, (snap) => {
      const online = snap.val() === true;
      setConnection({ online, label: online ? "Live" : "Reconnecting…" });
    });

    onValue(
      stateRef,
      (snap) => setState(snap.val() ?? DEFAULT_STATE),
      (err) => {
        console.error("[store] Firebase read failed:", err);
        setConnection({ online: false, label: "Connection error" });
      }
    );

    applyWrite = async (next) => {
      await set(stateRef, {
        status: next.status,
        message: next.message,
        updatedAt: serverTimestamp(),
      });
    };
  }

  // --- Backend: localStorage demo mode ------------------------------------
  function initDemo() {
    setConnection({ mode: "demo", online: true, label: "Demo mode · this device only" });

    const load = () => {
      try {
        const raw = localStorage.getItem(DEMO_KEY);
        setState(raw ? JSON.parse(raw) : DEFAULT_STATE);
      } catch (err) {
        console.error("[store] Failed to read demo state:", err);
        setState(DEFAULT_STATE);
      }
    };

    // `storage` events fire in *other* tabs of the same browser — this is what
    // gives demo mode its (single-device) live updates.
    window.addEventListener("storage", (e) => {
      if (e.key === DEMO_KEY) load();
    });

    load();

    applyWrite = async (next) => {
      const record = { status: next.status, message: next.message, updatedAt: Date.now() };
      localStorage.setItem(DEMO_KEY, JSON.stringify(record));
      setState(record); // `storage` events don't fire in the writing tab.
    };
  }

  return {
    get mode() {
      return connection.mode;
    },

    // Subscribe to state changes. Immediately replays the latest known state.
    // Returns an unsubscribe function.
    onChange(handler) {
      changeHandlers.add(handler);
      if (hasData) handler(state);
      return () => changeHandlers.delete(handler);
    },

    // Subscribe to connection changes. Immediately replays current connection.
    onConnection(handler) {
      connHandlers.add(handler);
      handler(connection);
      return () => connHandlers.delete(handler);
    },

    async setStatus({ status, message = "" }) {
      if (!STATUSES[status]) throw new Error(`Unknown status: ${status}`);
      await applyWrite({
        status,
        message: String(message).trim().slice(0, MESSAGE_MAX),
      });
    },

    async init() {
      try {
        if (isFirebaseConfigured()) {
          await initFirebase();
        } else {
          initDemo();
        }
      } catch (err) {
        // If Firebase fails to load (offline, blocked CDN, bad config) we keep
        // the app usable by falling back to demo mode rather than dying.
        console.error("[store] Init failed; falling back to demo mode:", err);
        setConnection({ mode: "demo", online: true, label: "Demo mode · sync unavailable" });
        initDemo();
      }
    },
  };
}
