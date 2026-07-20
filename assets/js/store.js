// -----------------------------------------------------------------------------
// Coffee store — the storage abstraction layer
// -----------------------------------------------------------------------------
// The pages only ever talk to this interface:
//
//   const store = createCoffeeStore();
//   store.onChange(state => { ... });   // { status, message, updatedAt, manager, schedule, orders }
//   store.onConnection(conn => { ... }); // { online, mode, label }
//   await store.verifyPin(pin);          // admin gate -> boolean
//   await store.setStatus({ status, message, pin });
//   await store.setManager({ state, note, pin });   // "Joe is in a meeting"
//   await store.setSchedule({ enabled, tz, open, close, days, openStatus, pin });
//   await store.addOrder({ name, item });           // guest order creation
//   await store.advanceOrder({ id, pin });          // Queued → Making → Ready → served
//   await store.removeOrder({ id, pin });
//   await store.init();
//
// Backend is chosen automatically at init():
//   • "live"  — polls /api/status (Neon Postgres) and POSTs partial updates.
//   • "demo"  — localStorage fallback when the API is unavailable (single
//               device; syncs across tabs). Clearly labelled in the UI.
// -----------------------------------------------------------------------------

import { API_PATH, POLL_INTERVAL_MS } from "./config.js";
import { STATUSES, DEFAULT_STATUS_ID, ORDER_FLOW } from "./statuses.js";

const DEMO_KEY = "bsmeb:state";
const MESSAGE_MAX = 280;
const NOTE_MAX = 120;
const NAME_MAX = 40;
const DEFAULT_MANAGER = { state: "available", note: "", updatedAt: null };
const DEFAULT_SCHEDULE = {
  enabled: true,
  tz: "America/Chicago",
  open: "08:00",
  close: "16:30",
  days: [1, 2, 3, 4, 5],
  openStatus: "ready",
  updatedAt: null,
};
const DEFAULT_STATE = {
  status: DEFAULT_STATUS_ID,
  message: "",
  updatedAt: null,
  manager: { ...DEFAULT_MANAGER },
  schedule: { ...DEFAULT_SCHEDULE, days: [...DEFAULT_SCHEDULE.days] },
  orders: [],
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

function sanitizeOrders(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((o) => o && typeof o === "object" && o.id != null)
    .map((o) => ({
      id: o.id,
      name: typeof o.name === "string" ? o.name.slice(0, NAME_MAX) : "",
      item: typeof o.item === "string" ? o.item.slice(0, NAME_MAX) : "",
      state: ORDER_FLOW.includes(o.state) ? o.state : "queued",
      createdAt: typeof o.createdAt === "number" ? o.createdAt : null,
      updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : null,
    }))
    .filter((o) => o.name);
}

function sanitizeSchedule(schedule) {
  if (!schedule || typeof schedule !== "object") {
    return { ...DEFAULT_SCHEDULE, days: [...DEFAULT_SCHEDULE.days] };
  }
  const days = Array.isArray(schedule.days)
    ? [...new Set(schedule.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort(
        (a, b) => a - b
      )
    : [];
  return {
    enabled: typeof schedule.enabled === "boolean" ? schedule.enabled : DEFAULT_SCHEDULE.enabled,
    tz: typeof schedule.tz === "string" && schedule.tz.trim() ? schedule.tz.trim().slice(0, 64) : DEFAULT_SCHEDULE.tz,
    open: /^\d{2}:\d{2}$/.test(schedule.open) ? schedule.open : DEFAULT_SCHEDULE.open,
    close: /^\d{2}:\d{2}$/.test(schedule.close) ? schedule.close : DEFAULT_SCHEDULE.close,
    days: days.length ? days : [...DEFAULT_SCHEDULE.days],
    openStatus: STATUSES[schedule.openStatus] && schedule.openStatus !== "closed"
      ? schedule.openStatus
      : DEFAULT_SCHEDULE.openStatus,
    updatedAt: typeof schedule.updatedAt === "number" ? schedule.updatedAt : null,
  };
}

function sanitize(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      ...DEFAULT_STATE,
      manager: { ...DEFAULT_MANAGER },
      schedule: { ...DEFAULT_SCHEDULE, days: [...DEFAULT_SCHEDULE.days] },
      orders: [],
    };
  }
  return {
    status: STATUSES[raw.status] ? raw.status : DEFAULT_STATUS_ID,
    message: typeof raw.message === "string" ? raw.message.slice(0, MESSAGE_MAX) : "",
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : null,
    manager: sanitizeManager(raw.manager),
    schedule: sanitizeSchedule(raw.schedule),
    orders: sanitizeOrders(raw.orders),
  };
}

// A compact signature of the queue — changes when an order is added, advanced,
// served, or removed, so equal polls still skip a re-render.
function ordersSig(orders) {
  return orders.map((o) => `${o.id}:${o.state}:${o.name}:${o.item}`).join("|");
}

// Demo-mode (localStorage) order mutations — mirrors the server's transitions.
function nextDemoId(list) {
  return list.reduce((m, o) => Math.max(m, Number(o.id) || 0), 0) + 1;
}
function applyOrderAction(orders, order) {
  const list = Array.isArray(orders) ? orders.slice() : [];
  const now = Date.now();
  switch (order.action) {
    case "add":
      return [
        ...list,
        { id: nextDemoId(list), name: order.name || "You", item: order.item || "", state: "queued", createdAt: now, updatedAt: now },
      ];
    case "advance":
      return list.flatMap((o) => {
        if (o.id !== order.id) return [o];
        const idx = ORDER_FLOW.indexOf(o.state);
        if (idx < 0 || idx >= ORDER_FLOW.length - 1) return []; // past "ready" -> served
        return [{ ...o, state: ORDER_FLOW[idx + 1], updatedAt: now }];
      });
    case "remove":
      return list.filter((o) => o.id !== order.id);
    case "clear":
      return [];
    default:
      return list;
  }
}

function sameState(a, b) {
  return (
    a.status === b.status &&
    a.message === b.message &&
    a.updatedAt === b.updatedAt &&
    a.manager.state === b.manager.state &&
    a.manager.note === b.manager.note &&
    a.manager.updatedAt === b.manager.updatedAt &&
    a.schedule.enabled === b.schedule.enabled &&
    a.schedule.tz === b.schedule.tz &&
    a.schedule.open === b.schedule.open &&
    a.schedule.close === b.schedule.close &&
    a.schedule.days.join(",") === b.schedule.days.join(",") &&
    a.schedule.openStatus === b.schedule.openStatus &&
    a.schedule.updatedAt === b.schedule.updatedAt &&
    ordersSig(a.orders) === ordersSig(b.orders)
  );
}

export function createCoffeeStore() {
  const changeHandlers = new Set();
  const connHandlers = new Set();

  let state = {
    ...DEFAULT_STATE,
    manager: { ...DEFAULT_MANAGER },
    schedule: { ...DEFAULT_SCHEDULE, days: [...DEFAULT_SCHEDULE.days] },
    orders: [],
  };
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const code = body.error || `http_${res.status}`;
        const msg = code === "bad_item" ? "That item isn’t on the menu right now." : "Couldn’t save — please try again.";
        throw new StoreError(msg, code);
      }
      const json = await res.json();
      setState(json);
      return json;
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
      // Merge the partial update into the current state (coffee / manager / schedule / orders).
      let next;
      let createdOrderId = null;
      if (payload.order) {
        next = { ...state, orders: applyOrderAction(state.orders, payload.order) };
        if (payload.order.action === "add" && next.orders.length) {
          createdOrderId = next.orders[next.orders.length - 1].id;
        }
      } else if (payload.manager) {
        next = { ...state, manager: { ...payload.manager, updatedAt: Date.now() } };
      } else if (payload.schedule) {
        next = { ...state, schedule: { ...payload.schedule, updatedAt: Date.now() } };
      } else {
        next = { ...state, status: payload.status, message: payload.message, updatedAt: Date.now() };
      }
      localStorage.setItem(DEMO_KEY, JSON.stringify(next));
      setState(next); // storage event doesn't fire in the writing tab
      return { ...next, createdOrderId };
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

    async setSchedule({ enabled, tz, open, close, days, openStatus, pin }) {
      await applyWrite({
        schedule: { enabled, tz, open, close, days, openStatus },
        pin,
      });
    },

    // name + item without a PIN = guest order; name + PIN = admin add. Returns
    // the new order's id when the backend provides it.
    async addOrder({ name, item, pin } = {}) {
      const payload = { action: "add" };
      if (name != null) payload.name = String(name).trim().slice(0, NAME_MAX);
      if (item != null) payload.item = String(item).trim().slice(0, NAME_MAX);
      const res = await applyWrite({ order: payload, pin });
      return res && res.createdOrderId != null ? res.createdOrderId : null;
    },

    async advanceOrder({ id, pin }) {
      await applyWrite({ order: { action: "advance", id }, pin });
    },

    async removeOrder({ id, pin }) {
      await applyWrite({ order: { action: "remove", id }, pin });
    },

    async clearOrders({ pin }) {
      await applyWrite({ order: { action: "clear" }, pin });
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
