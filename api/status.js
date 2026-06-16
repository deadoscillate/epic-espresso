// -----------------------------------------------------------------------------
// /api/status — the shared state, backed by Neon (serverless Postgres)
// -----------------------------------------------------------------------------
//   GET  -> { status, message, updatedAt, manager: { state, note, updatedAt } }
//   POST -> updates the state; requires the admin PIN. Partial:
//             { status, message, pin }            -> coffee status
//             { manager: { state, note }, pin }   -> manager (Joe) presence
//             { pin, verify: true }               -> PIN check only
//
// State lives in a single-row table `coffee_state` (created/upgraded on demand,
// so there's no migration step). Configured via Vercel env vars:
//   DATABASE_URL  -> Neon connection string (POSTGRES_URL also accepted)
//   ADMIN_PIN     -> passcode required to write
//   APP_ROLE      -> "public" makes this deployment read-only (hides admin)
// -----------------------------------------------------------------------------

import { neon } from "@neondatabase/serverless";

const MESSAGE_MAX = 280;
const NOTE_MAX = 120;
const STATUSES = ["brewing", "ready", "empty", "cleaning", "closed", "beans_low", "maintenance"];
const MANAGER_STATES = ["available", "meeting", "heads_down", "out"];
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
  tableReady = true;
}

async function readState(db) {
  await ensureTable(db);
  const rows = await db`SELECT status, message, updated_at,
                               manager_state, manager_note, manager_updated_at
                        FROM coffee_state WHERE id = 1`;
  if (!rows.length) return { ...DEFAULT_STATE, manager: { ...DEFAULT_MANAGER } };
  const r = rows[0];
  return {
    status: r.status,
    message: r.message ?? "",
    updatedAt: r.updated_at == null ? null : Number(r.updated_at),
    manager: {
      state: r.manager_state || DEFAULT_MANAGER.state,
      note: r.manager_note || "",
      updatedAt: r.manager_updated_at == null ? null : Number(r.manager_updated_at),
    },
  };
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
      return send(res, 200, await readState(db));
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
      if (body.manager) {
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
