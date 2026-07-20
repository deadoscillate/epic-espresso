import { createHash } from "node:crypto";

export const JSON_BODY_MAX_BYTES = 8 * 1024;

const envInt = (name, fallback, min, max) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
};

export const PIN_RATE_LIMIT = {
  max: envInt("PIN_RATE_LIMIT_MAX", 8, 2, 100),
  windowMs: envInt("PIN_RATE_LIMIT_WINDOW_MINUTES", 15, 1, 1440) * 60_000,
};

// Twenty orders leaves room for the whole department behind one office NAT,
// while still bounding accidental loops and basic public spam.
export const ORDER_RATE_LIMIT = {
  max: envInt("ORDER_RATE_LIMIT_MAX", 20, 5, 500),
  windowMs: envInt("ORDER_RATE_LIMIT_WINDOW_MINUTES", 10, 1, 1440) * 60_000,
};

export class BodyReadError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function readJsonBody(req, maxBytes = JSON_BODY_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    let settled = false;

    const fail = (code) => {
      if (settled) return;
      settled = true;
      reject(new BodyReadError(code));
    };

    req.on("data", (chunk) => {
      if (settled) return;
      bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      if (bytes > maxBytes) {
        fail("body_too_large");
        return;
      }
      data += chunk.toString();
    });
    req.on("end", () => {
      if (settled) return;
      try {
        const parsed = JSON.parse(data || "{}");
        settled = true;
        resolve(parsed);
      } catch {
        fail("bad_json");
      }
    });
    req.on("error", () => fail("bad_json"));
  });
}

// Length-aware constant-time-ish comparison for the shared PIN.
export function pinMatches(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function header(req, name) {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

export function rateLimitKey(req, scope) {
  const forwarded = String(header(req, "x-forwarded-for") || "");
  const ip = forwarded.split(",")[0].trim() || String(header(req, "x-real-ip") || "unknown");
  const salt = process.env.RATE_LIMIT_SALT || process.env.ADMIN_PIN || "epic-espresso";
  const digest = createHash("sha256").update(`${salt}|${scope}|${ip}`).digest("hex").slice(0, 32);
  return `${scope}:${digest}`;
}

let rateTableReady = false;
async function ensureRateTable(db) {
  if (rateTableReady) return;
  await db`CREATE TABLE IF NOT EXISTS coffee_rate_limits (
    key text PRIMARY KEY,
    attempts integer NOT NULL,
    window_start bigint NOT NULL
  )`;
  await db`DELETE FROM coffee_rate_limits WHERE window_start < ${Date.now() - 24 * 60 * 60_000}`;
  rateTableReady = true;
}

export async function inspectRateLimit(db, key, { max, windowMs }) {
  try {
    await ensureRateTable(db);
    const rows = await db`SELECT attempts, window_start FROM coffee_rate_limits WHERE key = ${key}`;
    if (!rows.length) return { limited: false, retryAfter: 0 };
    const attempts = Number(rows[0].attempts) || 0;
    const windowStart = Number(rows[0].window_start) || 0;
    const remaining = windowMs - (Date.now() - windowStart);
    if (remaining <= 0) {
      await db`DELETE FROM coffee_rate_limits WHERE key = ${key}`;
      return { limited: false, retryAfter: 0 };
    }
    return {
      limited: attempts >= max,
      retryAfter: Math.max(1, Math.ceil(remaining / 1000)),
    };
  } catch (err) {
    // A limiter outage should not take down the coffee bar. Log and fail open.
    console.warn("[security] rate-limit check failed:", err);
    return { limited: false, retryAfter: 0 };
  }
}

export async function recordRateLimitAttempt(db, key, { max, windowMs }) {
  try {
    await ensureRateTable(db);
    const now = Date.now();
    const cutoff = now - windowMs;
    const rows = await db`INSERT INTO coffee_rate_limits (key, attempts, window_start)
      VALUES (${key}, 1, ${now})
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE
          WHEN coffee_rate_limits.window_start <= ${cutoff} THEN 1
          ELSE coffee_rate_limits.attempts + 1
        END,
        window_start = CASE
          WHEN coffee_rate_limits.window_start <= ${cutoff} THEN ${now}
          ELSE coffee_rate_limits.window_start
        END
      RETURNING attempts, window_start`;
    const attempts = Number(rows[0]?.attempts) || 1;
    const windowStart = Number(rows[0]?.window_start) || now;
    return {
      limited: attempts > max,
      retryAfter: Math.max(1, Math.ceil((windowMs - (now - windowStart)) / 1000)),
    };
  } catch (err) {
    console.warn("[security] rate-limit write failed:", err);
    return { limited: false, retryAfter: 0 };
  }
}

export async function clearRateLimit(db, key) {
  try {
    await ensureRateTable(db);
    await db`DELETE FROM coffee_rate_limits WHERE key = ${key}`;
  } catch (err) {
    console.warn("[security] rate-limit clear failed:", err);
  }
}

export function sendRateLimited(res, retryAfter, error = "rate_limited") {
  res.setHeader("Retry-After", String(Math.max(1, retryAfter || 1)));
  res.statusCode = 429;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ error, retryAfter: Math.max(1, retryAfter || 1) }));
}
