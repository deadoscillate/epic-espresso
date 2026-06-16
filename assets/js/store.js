// -----------------------------------------------------------------------------
// Coffee store — the storage abstraction layer
// -----------------------------------------------------------------------------
// The pages only ever talk to this interface:
//
//   const store = createCoffeeStore();
//   store.onChange(state => { ... });   // { status, message, updatedAt, manager }
//   store.onConnection(conn => { ... }); // { online, mode, label }
//   await store.verifyPin(pin);          // admin gate -> boolean
//   await store.setStatus({ status, message, pin });
//   await store.setManager({ state, note, pin });   // "Joe is in a meeting"
//   await store.init();
//
// Backend is chosen automatically at init():
//   • "live"  — polls /api/status (Neon Postgres) and POSTs partial updates.
//   • "demo"  — localStorage fallback when the API is unavailable (single
//               device; syncs across tabs). Clearly labelled in the UI.
// -----------------------------------------------------------------------------

import { API_PATH, POLL_INTERVAL_MS } from "./config.js";
import { STATUSES, DEFAULT_STATUS_ID } from "./statuses.js";

const DEMO_KEY = "bsmeb:state";
const MESSAGE_MAX = 280;
const NOTE_MAX = 120;
const DEFAULT_MANAGER = { state: "available", note: "", updatedAt: null };
const DEFAULT_STATE = {
  status: DEFAULT_STATUS_ID,
  message: "",
  updatedAt: null,
  manager: { ...DEFAULT_MANAGER },
};

export class StoreError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function sanitizeManager(m) {
  if (!m || typeof m !== "object") return { ...DEFAULT_MANAGER };
  return {
    state: typeof m.state === "string" ? m.state : DEFAULT_MANAGER.state,
    note: typeof m.note === "string" ? m.note.slice(0, NOTE_MAX) : "",
    updatedAt: typeof m.updatedAt === "number" ? m.updatedAt : null,
  };
}

function sanitize(raw) {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_STATE, manager: { ...DEFAULT_MANAGER } };
  return {
    status: STATUSES[raw.status] ? raw.status : DEFAULT_STATUS_ID,
    message: typeof raw.message === "string" ? raw.message.slice(0, MESSAGE_MAX) : "",
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : null,
    manager: sanitizeManager(raw.manager),
  };
}

function sameState(a, b) {
  return (
    a.status === b.status &&
    a.message === b.message &&
    a.updatedAt === b.updatedAt &&
    a.manager.state === b.manager.state &&
    a.manager.note === b.manager.note &&
    a.manager.updatedAt === b.manager.updatedAt
  );
}

export function createCoffeeStore() {
  const changeHandlers = new Set();
  const connHandlers = new Set();

  let state = { ...DEFAULT_STATE };
  let hasData = false;
  let connection = { online: false, mode: "connecting", label: "Connecting…" };

  let applyWrite = async () => {
    throw new StoreError("Store not ready.", "not_ready");
  };
  let verifyImpl = async () => true; // demo needs no PIN

  const emitChange = () => changeHandlers.forEach((h) => h(state));
  const emitConn = () => connHandlers.forEach((h) => h(connection));

  function setConnection(patch) {
    connection = { ...connection, ...patch };
    emitConn();
  }
  function setState(next) {
    const clean = sanitize(next);
    if (hasData && sameState(clean, state)) return; // skip redundant re-renders
    state = clean;
    hasData = true;
    emitChange();
  }

  // --- Backend: live API (polling) ----------------------------------------
  function startApi() {
    setConnection({ mode: "live", online: true, label: "Live" });

    async function poll() {
      try {
        const res = await fetch(API_PATH, { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        setState(await res.json());
        if (!connection.online) setConnection({ online: true, label: "Live" });
      } catch {
        if (connection.online) setConnection({ online: false, label: "Reconnecting…" });
      }
    }

    poll();
    setInterval(poll, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") poll();
    });

    applyWrite = async (payload) => {
      let res;
      try {
        res = await fetch(API_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {
        throw new StoreError("Network error — try again.", "network");
      }
      if (res.status === 401) throw new StoreError("Incorrect PIN.", "bad_pin");
      if (res.status === 403) throw new StoreError("This site is read-only.", "read_only");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new StoreError("Couldn’t save — please try again.", body.error || `http_${res.status}`);
      }
      setState(await res.json());
    };

    verifyImpl = async (pin) => {
      const res = await fetch(API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, verify: true }),
      });
      if (res.ok) return true;
      if (res.status === 401) return false;
      throw new StoreError("Couldn’t reach the server.", "verify_failed");
    };
  }

  // --- Backend: localStorage demo -----------------------------------------
  function startDemo() {
    setConnection({ mode: "demo", online: true, label: "Demo mode · this device only" });

    const load = () => {
      try {
        const raw = localStorage.getItem(DEMO_KEY);
        setState(raw ? JSON.parse(raw) : DEFAULT_STATE);
      } catch {
        setState(DEFAULT_STATE);
      }
    };
    window.addEventListener("storage", (e) => {
      if (e.key === DEMO_KEY) load();
    });
    load();

    applyWrite = async (payload) => {
      // Merge the partial update into the current state (coffee or manager).
      let next;
      if (payload.manager) {
        next = { ...state, manager: { ...payload.manager, updatedAt: Date.now() } };
      } else {
        next = { ...state, status: payload.status, message: payload.message, updatedAt: Date.now() };
      }
      localStorage.setItem(DEMO_KEY, JSON.stringify(next));
      setState(next); // storage event doesn't fire in the writing tab
    };
    verifyImpl = async () => true;
  }

  return {
    get mode() {
      return connection.mode;
    },

    onChange(handler) {
      changeHandlers.add(handler);
      if (hasData) handler(state);
      return () => changeHandlers.delete(handler);
    },

    onConnection(handler) {
      connHandlers.add(handler);
      handler(connection);
      return () => connHandlers.delete(handler);
    },

    verifyPin(pin) {
      return verifyImpl(pin);
    },

    async setStatus({ status, message = "", pin }) {
      if (!STATUSES[status]) throw new StoreError(`Unknown status: ${status}`, "bad_status");
      await applyWrite({ status, message: String(message).trim().slice(0, MESSAGE_MAX), pin });
    },

    async setManager({ state: mState, note = "", pin }) {
      await applyWrite({ manager: { state: mState, note: String(note).trim().slice(0, NOTE_MAX) }, pin });
    },

    async init() {
      try {
        const res = await fetch(API_PATH, { cache: "no-store" });
        if (res.ok) {
          setState(await res.json());
          startApi();
          return;
        }
        throw new Error(`api ${res.status}`); // 503 (no database) etc. -> demo
      } catch {
        startDemo();
      }
    },
  };
}
