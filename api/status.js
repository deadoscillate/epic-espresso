// -----------------------------------------------------------------------------
// /api/status — the shared coffee state, backed by Neon (serverless Postgres)
// -----------------------------------------------------------------------------
//   GET  -> returns { status, message, updatedAt }            (public, read-only)
//   POST -> updates the state; requires the admin PIN          (write)
//           body: { status, message, pin }     or  { pin, verify: true }
//
// State lives in a single-row table `coffee_state` (created on demand, so
// there's no migration step). Configured entirely via Vercel environment
// variables:
//   DATABASE_URL  -> Neon connection string (added by the Vercel Neon
//                    integration; POSTGRES_URL is also accepted)
//   ADMIN_PIN     -> passcode required to write
//   APP_ROLE      -> "public" makes this deployment read-only (hides admin)
// -----------------------------------------------------------------------------

import { neon } from "@neondatabase/serverless";

const MESSAGE_MAX = 280;
const STATUSES = ["brewing", "ready", "empty", "cleaning", "closed", "beans_low", "maintenance"];
const DEFAULT_STATE = { status: "closed", message: "", updatedAt: null };

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
  tableReady = true;
}

async function readState(db) {
  await ensureTable(db);
  const rows = await db`SELECT status, message, updated_at FROM coffee_state WHERE id = 1`;
  if (!rows.length) return { ...DEFAULT_STATE };
  const row = rows[0];
  return {
    status: row.status,
    message: row.message ?? "",
    updatedAt: row.updated_at == null ? null : Number(row.updated_at),
  };
}

async function writeState(db, status, message) {
  await ensureTable(db);
  const updatedAt = Date.now();
  await db`INSERT INTO coffee_state (id, status, message, updated_at)
           VALUES (1, ${status}, ${message}, ${updatedAt})
           ON CONFLICT (id) DO UPDATE
             SET status = EXCLUDED.status,
                 message = EXCLUDED.message,
                 updated_at = EXCLUDED.updated_at`;
  return { status, message, updatedAt };
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

  // Without a database the live backend can't work; signal "unconfigured" so the
  // front-end falls back to demo mode cleanly.
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
    if (body.verify) return send(res, 200, { ok: true }); // PIN-only check

    if (!STATUSES.includes(body.status)) return send(res, 400, { error: "bad_status" });

    const message = String(body.message || "").trim().slice(0, MESSAGE_MAX);
    try {
      return send(res, 200, await writeState(db, body.status, message));
    } catch (err) {
      console.error("[api] DB write failed:", err);
      return send(res, 502, { error: "db_write_failed" });
    }
  }

  return send(res, 405, { error: "method_not_allowed" });
}

export default (req, res) => handle(req, res, sql);
