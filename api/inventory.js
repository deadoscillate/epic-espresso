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

const NAME_MAX = 60;

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

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

function pinMatches(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const clampStock = (n) => Math.max(0, Math.min(100000, Math.round(Number(n) || 0)));

// Exported for testing; `db` is the Neon tagged-template `sql` function.
export async function handle(req, res, db) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");

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
    if ((process.env.APP_ROLE || "all") === "public") return send(res, 403, { error: "read_only" });
    const adminPin = process.env.ADMIN_PIN;
    if (!adminPin) return send(res, 503, { error: "pin_not_configured" });

    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return send(res, 400, { error: "bad_json" });
    }
    if (!pinMatches(String(body.pin || ""), adminPin)) return send(res, 401, { error: "bad_pin" });

    try {
      await ensureTable(db);
      const now = Date.now();
      if (body.action === "add") {
        const name = String(body.name || "").trim().slice(0, NAME_MAX);
        if (!name) return send(res, 400, { error: "bad_item" });
        const available = body.available !== false;
        const stock = clampStock(body.stock);
        await db`INSERT INTO inventory (name, available, stock, created_at, updated_at)
                 VALUES (${name}, ${available}, ${stock}, ${now}, ${now})`;
      } else if (body.action === "update") {
        const id = Number(body.id);
        if (!Number.isFinite(id)) return send(res, 400, { error: "bad_item" });
        const name = body.name == null ? null : String(body.name).trim().slice(0, NAME_MAX);
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
