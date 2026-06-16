// -----------------------------------------------------------------------------
// /api/status — the shared coffee state, backed by Vercel KV (Upstash Redis)
// -----------------------------------------------------------------------------
//   GET  -> returns { status, message, updatedAt }            (public, read-only)
//   POST -> updates the state; requires the admin PIN          (write)
//           body: { status, message, pin }     or  { pin, verify: true }
//
// Dependency-free: talks to the KV REST API with `fetch` (Node 18+), so there's
// no build step. Configured entirely through Vercel environment variables:
//   KV_REST_API_URL / KV_REST_API_TOKEN   (auto-added by the Vercel KV / Redis
//       integration; UPSTASH_REDIS_REST_URL / _TOKEN are also accepted)
//   ADMIN_PIN     -> passcode required to write
//   APP_ROLE      -> "public" makes this deployment read-only (hides admin)
// -----------------------------------------------------------------------------

const KEY = "coffee";
const MESSAGE_MAX = 280;
const STATUSES = ["brewing", "ready", "empty", "cleaning", "closed", "beans_low", "maintenance"];
const DEFAULT_STATE = { status: "closed", message: "", updatedAt: null };

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// Run a single Redis command through the Upstash REST API.
async function kv(command) {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`KV ${res.status}`);
  return (await res.json()).result;
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

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  // Without a KV store the live backend can't work; signal "unconfigured" so the
  // front-end falls back to demo mode cleanly.
  if (!KV_URL || !KV_TOKEN) return send(res, 503, { error: "storage_not_configured" });

  if (req.method === "GET") {
    try {
      const raw = await kv(["GET", KEY]);
      return send(res, 200, raw ? JSON.parse(raw) : DEFAULT_STATE);
    } catch (err) {
      console.error("[api] KV read failed:", err);
      return send(res, 502, { error: "kv_read_failed" });
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
    // PIN-only check used by the admin gate.
    if (body.verify) return send(res, 200, { ok: true });

    if (!STATUSES.includes(body.status)) return send(res, 400, { error: "bad_status" });

    const state = {
      status: body.status,
      message: String(body.message || "").trim().slice(0, MESSAGE_MAX),
      updatedAt: Date.now(),
    };

    try {
      await kv(["SET", KEY, JSON.stringify(state)]);
    } catch (err) {
      console.error("[api] KV write failed:", err);
      return send(res, 502, { error: "kv_write_failed" });
    }
    return send(res, 200, state);
  }

  return send(res, 405, { error: "method_not_allowed" });
};
