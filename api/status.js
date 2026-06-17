// -----------------------------------------------------------------------------
// /api/status — the shared state, backed by Neon (serverless Postgres)
// -----------------------------------------------------------------------------
//   GET  -> { status, message, updatedAt, manager: {…}, orders: [{ id, name, state, … }] }
//   POST -> updates the state; requires the admin PIN. Partial:
//             { status, message, pin }            -> coffee status
//             { manager: { state, note }, pin }   -> manager (Joe) presence
//             { order: { action, … }, pin }       -> order queue (add/advance/remove/clear)
//             { pin, verify: true }               -> PIN check only
//
// State lives in a single-row table `coffee_state` (created/upgraded on demand,
// so there's no migration step). Configured via Vercel env vars:
//   DATABASE_URL  -> Neon connection string (POSTGRES_URL also accepted)
//   ADMIN_PIN     -> passcode required to write
//   APP_ROLE      -> "public" makes this deployment read-only (hides admin)
//   AUTO_RESET_MINUTES -> revert to Closed after N min idle (default 30; 0 = off)
// -----------------------------------------------------------------------------

import { neon } from "@neondatabase/serverless";

const MESSAGE_MAX = 280;
const NOTE_MAX = 120;
const NAME_MAX = 40;
const STATUSES = ["brewing", "ready", "empty", "cleaning", "closed", "beans_low", "maintenance"];
const MANAGER_STATES = ["available", "meeting", "heads_down", "out"];
const ORDER_FLOW = ["queued", "making", "ready"]; // advancing past "ready" serves (removes) it
// Auto-reset: if the coffee status goes untouched this long, revert to Closed so
// the board never lies after hours. Read-time (no cron needed); 0 disables it.
const AUTO_RESET_MIN = Number(process.env.AUTO_RESET_MINUTES ?? 30);
const AUTO_RESET_MS =
  Number.isFinite(AUTO_RESET_MIN) && AUTO_RESET_MIN > 0 ? AUTO_RESET_MIN * 60000 : 0;
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
  // Order queue (names only) — a separate table since it's a list, not a singleton.
  await db`CREATE TABLE IF NOT EXISTS coffee_orders (
    id bigserial PRIMARY KEY,
    name text NOT NULL,
    state text NOT NULL DEFAULT 'queued',
    created_at bigint,
    updated_at bigint
  )`;
  tableReady = true;
}

async function readOrders(db) {
  const rows = await db`SELECT id, name, state, created_at, updated_at
                        FROM coffee_orders ORDER BY created_at ASC, id ASC`;
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    state: ORDER_FLOW.includes(r.state) ? r.state : "queued",
    createdAt: r.created_at == null ? null : Number(r.created_at),
    updatedAt: r.updated_at == null ? null : Number(r.updated_at),
  }));
}

async function readState(db) {
  await ensureTable(db);
  const rows = await db`SELECT status, message, updated_at,
                               manager_state, manager_note, manager_updated_at
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
      }
    : { ...DEFAULT_STATE, manager: { ...DEFAULT_MANAGER } };
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

async function addOrder(db, name) {
  await ensureTable(db);
  const now = Date.now();
  await db`INSERT INTO coffee_orders (name, state, created_at, updated_at)
           VALUES (${name}, 'queued', ${now}, ${now})`;
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

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

// Length-aware constant-time-ish compare for the PIN.
function pinMatches(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Exported for testing; `db` is the Neon tagged-template `sql` function.
export async function handle(req, res, db) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (!db) return send(res, 503, { error: "storage_not_configured" });

  if (req.method === "GET") {
    try {
      return send(res, 200, await maybeAutoReset(db, await readState(db)));
    } catch (err) {
      console.error("[api] DB read failed:", err);
      return send(res, 502, { error: "db_read_failed" });
    }
  }

  if (req.method === "POST") {
    if ((process.env.APP_ROLE || "all") === "public") {
      return send(res, 403, { error: "read_only" });
    }
    const adminPin = process.env.ADMIN_PIN;
    if (!adminPin) return send(res, 503, { error: "pin_not_configured" });

    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return send(res, 400, { error: "bad_json" });
    }

    if (!pinMatches(String(body.pin || ""), adminPin)) {
      return send(res, 401, { error: "bad_pin" });
    }
    if (body.verify) return send(res, 200, { ok: true });

    try {
      if (body.order) {
        const o = body.order;
        if (o.action === "add") {
          const name = String(o.name || "").trim().slice(0, NAME_MAX);
          if (!name) return send(res, 400, { error: "bad_order" });
          await addOrder(db, name);
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
      } else {
        if (!STATUSES.includes(body.status)) return send(res, 400, { error: "bad_status" });
        const message = String(body.message || "").trim().slice(0, MESSAGE_MAX);
        await writeCoffee(db, body.status, message);
      }
      return send(res, 200, await readState(db));
    } catch (err) {
      console.error("[api] DB write failed:", err);
      return send(res, 502, { error: "db_write_failed" });
    }
  }

  return send(res, 405, { error: "method_not_allowed" });
}

export default (req, res) => handle(req, res, sql);
