// -----------------------------------------------------------------------------
// /api/status — the shared state, backed by Neon (serverless Postgres)
// -----------------------------------------------------------------------------
//   GET  -> { status, message, updatedAt, manager: {…}, schedule: {…}, orders: […] }
//   POST -> creates guarded guest orders or performs PIN-protected admin updates. Partial:
//             { status, message, pin }            -> coffee status
//             { manager: { state, note }, pin }   -> manager (Joe) presence
//             { schedule: { enabled, open, close, tz, days, openStatus }, pin }
//                                                   -> operating hours
//             { order: { action, name, item, … } } -> order queue; a visitor may
//                                                     "add" (no PIN), the rest is admin
//             { pin, verify: true }               -> PIN check only
//
// State lives in a single-row table `coffee_state` (created/upgraded on demand,
// so there's no migration step). Configured via Vercel env vars:
//   DATABASE_URL  -> Neon connection string (POSTGRES_URL also accepted)
//   ADMIN_PIN     -> passcode required to write
//   AUTO_RESET_MINUTES -> revert to Closed after N min idle (default 30; 0 = off)
//   SCHEDULE_*         -> initial schedule defaults; Admin-saved hours then win
//   (when scheduling is on it supersedes AUTO_RESET_MINUTES)
// -----------------------------------------------------------------------------

import { neon } from "@neondatabase/serverless";
import {
  CUSTOMER_NAME_MAX,
  ITEM_NAME_MAX,
  MAX_ACTIVE_ORDERS,
  ORDERABLE_STATUSES,
} from "../shared/constants.js";
import {
  clearRateLimit,
  inspectRateLimit,
  ORDER_RATE_LIMIT,
  PIN_RATE_LIMIT,
  pinMatches,
  rateLimitKey,
  readJsonBody,
  recordRateLimitAttempt,
  sendRateLimited,
} from "../lib/server-security.js";

const MESSAGE_MAX = 280;
const NOTE_MAX = 120;
const STATUSES = ["brewing", "ready", "empty", "cleaning", "closed", "beans_low", "maintenance"];
const OPEN_STATUSES = STATUSES.filter((status) => status !== "closed");
const MANAGER_STATES = ["available", "meeting", "heads_down", "out"];
const ORDER_FLOW = ["queued", "making", "ready"]; // advancing past "ready" serves (removes) it
// Auto-reset: if the coffee status goes untouched this long, revert to Closed so
// the board never lies after hours. Read-time (no cron needed); 0 disables it.
const AUTO_RESET_MIN = Number(process.env.AUTO_RESET_MINUTES ?? 30);
const AUTO_RESET_MS =
  Number.isFinite(AUTO_RESET_MIN) && AUTO_RESET_MIN > 0 ? AUTO_RESET_MIN * 60000 : 0;

// Scheduled open/close: outside business hours the board is forced to Closed, and
// at opening it flips back to an "open" status. Read-time + IANA timezone, so it's
// DST-correct with no cron. When enabled it supersedes the idle auto-reset above.
const DEFAULT_DAYS = [1, 2, 3, 4, 5];
const SCHEDULE_CFG = buildScheduleConfig();

function normalizeTime(value, fallback = null) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeMinutes(value) {
  const normalized = normalizeTime(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(":").map(Number);
  return hour * 60 + minute;
}

function parseDays(value, fallback = DEFAULT_DAYS) {
  if (Array.isArray(value)) {
    const days = [...new Set(value.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
    return days.length ? days.sort((a, b) => a - b) : [...fallback];
  }

  const str = String(value || "").trim();
  if (!str) return [...fallback];
  const days = new Set();
  for (const part of str.split(",")) {
    const range = part.split("-").map((item) => Number(item.trim()));
    if (range.length === 2 && Number.isInteger(range[0]) && Number.isInteger(range[1])) {
      for (let day = range[0]; day <= range[1]; day++) days.add(((day % 7) + 7) % 7);
    } else if (range.length === 1 && Number.isInteger(range[0])) {
      days.add(((range[0] % 7) + 7) % 7);
    }
  }
  return days.size ? [...days].sort((a, b) => a - b) : [...fallback];
}

function validTimezone(value) {
  const timezone = String(value || "").trim().slice(0, 64);
  if (!timezone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return null;
  }
}

function buildScheduleConfig() {
  const openStatus = process.env.SCHEDULE_OPEN_STATUS;
  return {
    enabled: !/^(0|false|off|no)$/i.test(process.env.SCHEDULE_ENABLED || ""),
    tz: validTimezone(process.env.SCHEDULE_TZ) || "America/Chicago",
    open: normalizeTime(process.env.SCHEDULE_OPEN, "08:00"),
    close: normalizeTime(process.env.SCHEDULE_CLOSE, "16:30"),
    days: parseDays(process.env.SCHEDULE_DAYS),
    openStatus: OPEN_STATUSES.includes(openStatus) ? openStatus : "ready",
    updatedAt: null,
  };
}

function scheduleFromRow(row) {
  if (!row) return { ...SCHEDULE_CFG, days: [...SCHEDULE_CFG.days] };
  return {
    enabled: row.schedule_enabled == null ? SCHEDULE_CFG.enabled : row.schedule_enabled !== false,
    tz: validTimezone(row.schedule_tz) || SCHEDULE_CFG.tz,
    open: normalizeTime(row.schedule_open, SCHEDULE_CFG.open),
    close: normalizeTime(row.schedule_close, SCHEDULE_CFG.close),
    days: parseDays(row.schedule_days, SCHEDULE_CFG.days),
    openStatus: OPEN_STATUSES.includes(row.schedule_open_status)
      ? row.schedule_open_status
      : SCHEDULE_CFG.openStatus,
    updatedAt: row.schedule_updated_at == null ? null : Number(row.schedule_updated_at),
  };
}

function validateSchedule(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.enabled !== "boolean") return null;
  const open = normalizeTime(raw.open);
  const close = normalizeTime(raw.close);
  const tz = validTimezone(raw.tz);
  const validDays =
    Array.isArray(raw.days) &&
    raw.days.length > 0 &&
    raw.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  const days = validDays ? [...new Set(raw.days)].sort((a, b) => a - b) : [];
  const openStatus = OPEN_STATUSES.includes(raw.openStatus) ? raw.openStatus : null;
  if (!open || !close || !tz || !days.length || !openStatus) return null;
  if (timeMinutes(open) >= timeMinutes(close)) return null;
  return { enabled: raw.enabled, tz, open, close, days, openStatus };
}

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function tzInfo(epochMs, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(epochMs));
  const g = (t) => parts.find((p) => p.type === t)?.value;
  return {
    date: `${g("year")}-${g("month")}-${g("day")}`,
    mins: Number(g("hour")) * 60 + Number(g("minute")),
    day: WEEKDAY[g("weekday")] ?? 0,
  };
}

// Pure decision (exported for tests): given the stored state + "now", returns the
// status the schedule wants to force, or null to leave it alone.
export function scheduleDecision(state, nowEpoch, cfg) {
  if (!cfg.enabled) return null;
  const now = tzInfo(nowEpoch, cfg.tz);
  const open = typeof cfg.open === "number" ? cfg.open : timeMinutes(cfg.open);
  const close = typeof cfg.close === "number" ? cfg.close : timeMinutes(cfg.close);
  if (open == null || close == null) return null;
  const days = cfg.days instanceof Set ? cfg.days : new Set(Array.isArray(cfg.days) ? cfg.days : []);
  const isOpen = days.has(now.day) && now.mins >= open && now.mins < close;
  if (!isOpen) {
    return state.status !== "closed" ? { status: "closed" } : null;
  }
  if (state.status === "closed") {
    const upd = state.updatedAt ? tzInfo(state.updatedAt, cfg.tz) : null;
    const closedBeforeOpen =
      !upd || upd.date < now.date || (upd.date === now.date && upd.mins < open);
    if (closedBeforeOpen) return { status: cfg.openStatus };
  }
  return null;
}

const DEFAULT_STATE = { status: "closed", message: "", updatedAt: null };
const DEFAULT_MANAGER = { state: "available", note: "", updatedAt: null };

const DB_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_PRISMA_URL;

const sql = DB_URL ? neon(DB_URL) : null;

let tableReady = false;
async function ensureTable(db) {
  if (tableReady) return;
  await db`CREATE TABLE IF NOT EXISTS coffee_state (
    id int PRIMARY KEY,
    status text NOT NULL,
    message text NOT NULL DEFAULT '',
    updated_at bigint
  )`;
  // Added later (manager presence) — idempotent for existing tables.
  await db`ALTER TABLE coffee_state ADD COLUMN IF NOT EXISTS manager_state text`;
  await db`ALTER TABLE coffee_state ADD COLUMN IF NOT EXISTS manager_note text`;
  await db`ALTER TABLE coffee_state ADD COLUMN IF NOT EXISTS manager_updated_at bigint`;
  // Admin-editable operating hours. Environment variables remain the defaults
  // until these nullable columns are saved for the first time.
  await db`ALTER TABLE coffee_state ADD COLUMN IF NOT EXISTS schedule_enabled boolean`;
  await db`ALTER TABLE coffee_state ADD COLUMN IF NOT EXISTS schedule_open text`;
  await db`ALTER TABLE coffee_state ADD COLUMN IF NOT EXISTS schedule_close text`;
  await db`ALTER TABLE coffee_state ADD COLUMN IF NOT EXISTS schedule_tz text`;
  await db`ALTER TABLE coffee_state ADD COLUMN IF NOT EXISTS schedule_days text`;
  await db`ALTER TABLE coffee_state ADD COLUMN IF NOT EXISTS schedule_open_status text`;
  await db`ALTER TABLE coffee_state ADD COLUMN IF NOT EXISTS schedule_updated_at bigint`;
  // Order queue (names only) — a separate table since it's a list, not a singleton.
  await db`CREATE TABLE IF NOT EXISTS coffee_orders (
    id bigserial PRIMARY KEY,
    name text NOT NULL,
    state text NOT NULL DEFAULT 'queued',
    created_at bigint,
    updated_at bigint
  )`;
  // Added later (self-serve ordering): the chosen menu item.
  await db`ALTER TABLE coffee_orders ADD COLUMN IF NOT EXISTS item text`;
  tableReady = true;
}

async function readOrders(db) {
  const rows = await db`SELECT id, name, item, state, created_at, updated_at
                        FROM coffee_orders ORDER BY created_at ASC, id ASC`;
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    item: r.item || "",
    state: ORDER_FLOW.includes(r.state) ? r.state : "queued",
    createdAt: r.created_at == null ? null : Number(r.created_at),
    updatedAt: r.updated_at == null ? null : Number(r.updated_at),
  }));
}

async function readState(db) {
  await ensureTable(db);
  const rows = await db`SELECT status, message, updated_at,
                               manager_state, manager_note, manager_updated_at,
                               schedule_enabled, schedule_open, schedule_close, schedule_tz,
                               schedule_days, schedule_open_status, schedule_updated_at
                        FROM coffee_state WHERE id = 1`;
  const base = rows.length
    ? {
        status: rows[0].status,
        message: rows[0].message ?? "",
        updatedAt: rows[0].updated_at == null ? null : Number(rows[0].updated_at),
        manager: {
          state: rows[0].manager_state || DEFAULT_MANAGER.state,
          note: rows[0].manager_note || "",
          updatedAt:
            rows[0].manager_updated_at == null ? null : Number(rows[0].manager_updated_at),
        },
        schedule: scheduleFromRow(rows[0]),
      }
    : {
        ...DEFAULT_STATE,
        manager: { ...DEFAULT_MANAGER },
        schedule: { ...SCHEDULE_CFG, days: [...SCHEDULE_CFG.days] },
      };
  base.orders = await readOrders(db);
  return base;
}

// Revert a stale coffee status to Closed (clearing its message). Read-time, so
// the board self-heals after hours without a scheduled job. Leaves Joe + orders.
async function maybeAutoReset(db, state) {
  if (!AUTO_RESET_MS) return state;
  if (state.status === "closed" || state.updatedAt == null) return state;
  if (Date.now() - state.updatedAt < AUTO_RESET_MS) return state;
  await writeCoffee(db, "closed", "");
  return readState(db);
}

// Apply the open/close schedule (force Closed off-hours; open at the start of the
// business day). Runs read-time; returns the (possibly re-read) state.
async function applySchedule(db, state) {
  const decision = scheduleDecision(state, Date.now(), state.schedule || SCHEDULE_CFG);
  if (!decision) return state;
  await writeCoffee(db, decision.status, "");
  return readState(db);
}

async function writeCoffee(db, status, message) {
  await ensureTable(db);
  const updatedAt = Date.now();
  await db`INSERT INTO coffee_state (id, status, message, updated_at)
           VALUES (1, ${status}, ${message}, ${updatedAt})
           ON CONFLICT (id) DO UPDATE
             SET status = EXCLUDED.status,
                 message = EXCLUDED.message,
                 updated_at = EXCLUDED.updated_at`;
}

async function writeManager(db, state, note) {
  await ensureTable(db);
  const updatedAt = Date.now();
  await db`INSERT INTO coffee_state (id, status, message, manager_state, manager_note, manager_updated_at)
           VALUES (1, ${DEFAULT_STATE.status}, ${""}, ${state}, ${note}, ${updatedAt})
           ON CONFLICT (id) DO UPDATE
             SET manager_state = EXCLUDED.manager_state,
                 manager_note = EXCLUDED.manager_note,
                 manager_updated_at = EXCLUDED.manager_updated_at`;
}

async function writeSchedule(db, schedule) {
  await ensureTable(db);
  const updatedAt = Date.now();
  const days = schedule.days.join(",");
  await db`INSERT INTO coffee_state (
             id, status, message, schedule_enabled, schedule_open, schedule_close,
             schedule_tz, schedule_days, schedule_open_status, schedule_updated_at
           )
           VALUES (
             1, ${DEFAULT_STATE.status}, ${""}, ${schedule.enabled}, ${schedule.open},
             ${schedule.close}, ${schedule.tz}, ${days}, ${schedule.openStatus}, ${updatedAt}
           )
           ON CONFLICT (id) DO UPDATE
             SET schedule_enabled = EXCLUDED.schedule_enabled,
                 schedule_open = EXCLUDED.schedule_open,
                 schedule_close = EXCLUDED.schedule_close,
                 schedule_tz = EXCLUDED.schedule_tz,
                 schedule_days = EXCLUDED.schedule_days,
                 schedule_open_status = EXCLUDED.schedule_open_status,
                 schedule_updated_at = EXCLUDED.schedule_updated_at`;
}

async function addOrder(db, name, item) {
  await ensureTable(db);
  const now = Date.now();
  const rows = await db`INSERT INTO coffee_orders (name, item, state, created_at, updated_at)
           VALUES (${name}, ${item || ""}, 'queued', ${now}, ${now})
           RETURNING id`;
  return rows.length ? Number(rows[0].id) : null;
}

async function activeOrderCount(db) {
  await ensureTable(db);
  const rows = await db`SELECT COUNT(*) AS count FROM coffee_orders`;
  return Number(rows[0]?.count) || 0;
}

// A visitor may only order something on the menu. If no items are marked
// available (or Inventory has not been initialized), ordering stays closed.
async function orderableItem(db, raw) {
  const item = String(raw || "").trim().slice(0, ITEM_NAME_MAX);
  if (!item) return null;
  let available = [];
  try {
    available = await db`SELECT name FROM inventory WHERE available = true`;
  } catch {
    return null;
  }
  if (!available.length) return null;
  const match = available.find((r) => r.name.toLowerCase() === item.toLowerCase());
  return match ? match.name : null;
}

async function advanceOrder(db, id) {
  await ensureTable(db);
  const rows = await db`SELECT state FROM coffee_orders WHERE id = ${id}`;
  if (!rows.length) return;
  const idx = ORDER_FLOW.indexOf(rows[0].state);
  if (idx < 0 || idx >= ORDER_FLOW.length - 1) {
    await db`DELETE FROM coffee_orders WHERE id = ${id}`; // past "ready" -> served
  } else {
    await db`UPDATE coffee_orders SET state = ${ORDER_FLOW[idx + 1]}, updated_at = ${Date.now()}
             WHERE id = ${id}`;
  }
}

async function removeOrder(db, id) {
  await ensureTable(db);
  await db`DELETE FROM coffee_orders WHERE id = ${id}`;
}

async function clearOrders(db) {
  await ensureTable(db);
  await db`DELETE FROM coffee_orders`;
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

// Exported for testing; `db` is the Neon tagged-template `sql` function.
export async function handle(req, res, db) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (!db) return send(res, 503, { error: "storage_not_configured" });

  if (req.method === "GET") {
    try {
      let state = await readState(db);
      // Scheduling owns open/close when enabled; otherwise the idle auto-reset does.
      state = state.schedule.enabled ? await applySchedule(db, state) : await maybeAutoReset(db, state);
      return send(res, 200, state);
    } catch (err) {
      console.error("[api] DB read failed:", err);
      return send(res, 502, { error: "db_read_failed" });
    }
  }

  if (req.method === "POST") {
    const adminPin = process.env.ADMIN_PIN;

    let body = {};
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return send(res, err.code === "body_too_large" ? 413 : 400, {
        error: err.code === "body_too_large" ? "body_too_large" : "bad_json",
      });
    }
    const submittedPin = typeof body.pin === "string" ? body.pin : "";
    const pinProvided = submittedPin.length > 0;
    const pinOk = Boolean(adminPin) && pinMatches(submittedPin, adminPin);

    // Self-serve order placement — no account or PIN. Supplying a PIN opts into
    // the admin path below, so a stale/incorrect admin PIN still fails closed.
    if (body.order && body.order.action === "add" && !pinProvided) {
      try {
        const orderRateKey = rateLimitKey(req, "guest-order");
        const recordedLimit = await recordRateLimitAttempt(db, orderRateKey, ORDER_RATE_LIMIT);
        if (recordedLimit.limited) return sendRateLimited(res, recordedLimit.retryAfter);

        const name = String(body.order.name || "").trim().slice(0, CUSTOMER_NAME_MAX);
        if (!name) return send(res, 400, { error: "bad_order" });
        let state = await readState(db);
        state = state.schedule.enabled
          ? await applySchedule(db, state)
          : await maybeAutoReset(db, state);
        if (!ORDERABLE_STATUSES.includes(state.status)) {
          return send(res, 409, { error: "bar_unavailable", status: state.status });
        }
        const item = await orderableItem(db, body.order.item);
        if (!item) return send(res, 400, { error: "bad_item" });
        if ((await activeOrderCount(db)) >= MAX_ACTIVE_ORDERS) {
          return send(res, 409, { error: "queue_full" });
        }
        const id = await addOrder(db, name, item);
        state = await readState(db);
        state.createdOrderId = id;
        return send(res, 200, state);
      } catch (err) {
        console.error("[api] order placement failed:", err);
        return send(res, 502, { error: "db_write_failed" });
      }
    }

    // Everything else is an admin action protected by the shared PIN.
    if (!adminPin) return send(res, 503, { error: "pin_not_configured" });
    const pinRateKey = rateLimitKey(req, "admin-pin");
    const pinLimit = await inspectRateLimit(db, pinRateKey, PIN_RATE_LIMIT);
    if (pinLimit.limited) return sendRateLimited(res, pinLimit.retryAfter);
    if (!pinOk) {
      const failedPinLimit = await recordRateLimitAttempt(db, pinRateKey, PIN_RATE_LIMIT);
      if (failedPinLimit.limited) return sendRateLimited(res, failedPinLimit.retryAfter);
      return send(res, 401, { error: "bad_pin" });
    }
    await clearRateLimit(db, pinRateKey);
    if (body.verify) return send(res, 200, { ok: true });

    try {
      if (body.order) {
        const o = body.order;
        if (o.action === "add") {
          const name = String(o.name || "").trim().slice(0, CUSTOMER_NAME_MAX);
          if (!name) return send(res, 400, { error: "bad_order" });
          const item = String(o.item || "").trim().slice(0, ITEM_NAME_MAX);
          await addOrder(db, name, item);
        } else if (o.action === "advance") {
          const id = Number(o.id);
          if (!Number.isFinite(id)) return send(res, 400, { error: "bad_order" });
          await advanceOrder(db, id);
        } else if (o.action === "remove") {
          const id = Number(o.id);
          if (!Number.isFinite(id)) return send(res, 400, { error: "bad_order" });
          await removeOrder(db, id);
        } else if (o.action === "clear") {
          await clearOrders(db);
        } else {
          return send(res, 400, { error: "bad_order" });
        }
      } else if (body.manager) {
        if (!MANAGER_STATES.includes(body.manager.state)) {
          return send(res, 400, { error: "bad_manager_state" });
        }
        const note = String(body.manager.note || "").trim().slice(0, NOTE_MAX);
        await writeManager(db, body.manager.state, note);
      } else if (body.schedule) {
        const schedule = validateSchedule(body.schedule);
        if (!schedule) return send(res, 400, { error: "bad_schedule" });
        await writeSchedule(db, schedule);
      } else {
        if (!STATUSES.includes(body.status)) return send(res, 400, { error: "bad_status" });
        const message = String(body.message || "").trim().slice(0, MESSAGE_MAX);
        await writeCoffee(db, body.status, message);
      }
      let state = await readState(db);
      if (body.schedule && state.schedule.enabled) state = await applySchedule(db, state);
      return send(res, 200, state);
    } catch (err) {
      console.error("[api] DB write failed:", err);
      return send(res, 502, { error: "db_write_failed" });
    }
  }

  return send(res, 405, { error: "method_not_allowed" });
}

export default (req, res) => handle(req, res, sql);
