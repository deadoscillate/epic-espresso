// -----------------------------------------------------------------------------
// /api/inventory — the espresso bar's items (a menu + a back-office stock count)
// -----------------------------------------------------------------------------
//   GET  -> { items: [{ id, name, available, stock }] }
//   POST -> admin only (ADMIN_PIN). { action, pin, ... }:
//             { action: "add",    name, stock?, available?, pin }
//             { action: "update", id, name?, stock?, available?, pin }
//             { action: "remove", id, pin }
//
// `available` controls whether the item shows on the public order menu; `stock`
// is the admin-facing supply count. Same Neon DB + PIN as /api/status.
// -----------------------------------------------------------------------------

import { neon } from "@neondatabase/serverless";
import { ITEM_NAME_MAX } from "../shared/constants.js";
import {
  clearRateLimit,
  inspectRateLimit,
  PIN_RATE_LIMIT,
  pinMatches,
  rateLimitKey,
  readJsonBody,
  recordRateLimitAttempt,
  sendRateLimited,
} from "../lib/server-security.js";

const DB_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_PRISMA_URL;
const sql = DB_URL ? neon(DB_URL) : null;

let tableReady = false;
async function ensureTable(db) {
  if (tableReady) return;
  await db`CREATE TABLE IF NOT EXISTS inventory (
    id bigserial PRIMARY KEY,
    name text NOT NULL,
    available boolean NOT NULL DEFAULT true,
    stock integer NOT NULL DEFAULT 0,
    created_at bigint,
    updated_at bigint
  )`;
  tableReady = true;
}

async function readItems(db) {
  await ensureTable(db);
  const rows = await db`SELECT id, name, available, stock
                        FROM inventory ORDER BY name ASC, id ASC`;
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    available: r.available !== false,
    stock: r.stock == null ? 0 : Number(r.stock),
  }));
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

const clampStock = (n) => Math.max(0, Math.min(100000, Math.round(Number(n) || 0)));

// Exported for testing; `db` is the Neon tagged-template `sql` function.
export async function handle(req, res, db) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (!db) return send(res, 503, { error: "storage_not_configured" });

  if (req.method === "GET") {
    try {
      return send(res, 200, { items: await readItems(db) });
    } catch (err) {
      console.error("[inventory] read failed:", err);
      return send(res, 502, { error: "db_read_failed" });
    }
  }

  if (req.method === "POST") {
    const adminPin = process.env.ADMIN_PIN;
    if (!adminPin) return send(res, 503, { error: "pin_not_configured" });

    let body = {};
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return send(res, err.code === "body_too_large" ? 413 : 400, {
        error: err.code === "body_too_large" ? "body_too_large" : "bad_json",
      });
    }
    const submittedPin = String(body.pin || "");
    const pinRateKey = rateLimitKey(req, "admin-pin");
    const pinLimit = await inspectRateLimit(db, pinRateKey, PIN_RATE_LIMIT);
    if (pinLimit.limited) return sendRateLimited(res, pinLimit.retryAfter);
    if (!pinMatches(submittedPin, adminPin)) {
      const failedPinLimit = await recordRateLimitAttempt(db, pinRateKey, PIN_RATE_LIMIT);
      if (failedPinLimit.limited) return sendRateLimited(res, failedPinLimit.retryAfter);
      return send(res, 401, { error: "bad_pin" });
    }
    await clearRateLimit(db, pinRateKey);

    try {
      await ensureTable(db);
      const now = Date.now();
      if (body.action === "add") {
        const name = String(body.name || "").trim().slice(0, ITEM_NAME_MAX);
        if (!name) return send(res, 400, { error: "bad_item" });
        const available = body.available !== false;
        const stock = clampStock(body.stock);
        await db`INSERT INTO inventory (name, available, stock, created_at, updated_at)
                 VALUES (${name}, ${available}, ${stock}, ${now}, ${now})`;
      } else if (body.action === "update") {
        const id = Number(body.id);
        if (!Number.isFinite(id)) return send(res, 400, { error: "bad_item" });
        const name = body.name == null ? null : String(body.name).trim().slice(0, ITEM_NAME_MAX);
        const available = body.available == null ? null : body.available !== false;
        const stock = body.stock == null ? null : clampStock(body.stock);
        await db`UPDATE inventory SET
                   name = COALESCE(${name}, name),
                   available = COALESCE(${available}, available),
                   stock = COALESCE(${stock}, stock),
                   updated_at = ${now}
                 WHERE id = ${id}`;
      } else if (body.action === "remove") {
        const id = Number(body.id);
        if (!Number.isFinite(id)) return send(res, 400, { error: "bad_item" });
        await db`DELETE FROM inventory WHERE id = ${id}`;
      } else {
        return send(res, 400, { error: "bad_action" });
      }
      return send(res, 200, { items: await readItems(db) });
    } catch (err) {
      console.error("[inventory] write failed:", err);
      return send(res, 502, { error: "db_write_failed" });
    }
  }

  return send(res, 405, { error: "method_not_allowed" });
}

export default (req, res) => handle(req, res, sql);
