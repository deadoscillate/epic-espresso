// -----------------------------------------------------------------------------
// Session helpers — signed, httpOnly cookie (no DB lookup needed to authenticate)
// -----------------------------------------------------------------------------
// A session is a compact, HMAC-signed token: base64url(JSON payload).base64url(sig)
// Signed with SESSION_SECRET. Used by the serverless functions only (Node crypto),
// never shipped to the browser. The browser only ever sees an opaque httpOnly cookie.
// -----------------------------------------------------------------------------

import crypto from "crypto";

const COOKIE = "ee_session";
const STATE_COOKIE = "ee_oauth_state";
const DEFAULT_MAX_AGE = 30 * 24 * 60 * 60; // 30 days
const SECRET = process.env.SESSION_SECRET || "";

export const SESSION_COOKIE = COOKIE;
export const STATE_COOKIE_NAME = STATE_COOKIE;
export const hasSecret = () => Boolean(SECRET);

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

export function signSession(payload, maxAgeSec = DEFAULT_MAX_AGE) {
  if (!SECRET) throw new Error("no_session_secret");
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + maxAgeSec };
  const data = b64url(JSON.stringify(body));
  const sig = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifySession(token) {
  if (!SECRET || !token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let body;
  try {
    body = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!body || typeof body.exp !== "number" || body.exp < Math.floor(Date.now() / 1000)) return null;
  return body; // { uid, email, name, picture, exp }
}

export function parseCookies(req) {
  const header = (req.headers && req.headers.cookie) || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k) out[k] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function getSession(req) {
  return verifySession(parseCookies(req)[COOKIE]);
}

export function sessionCookie(token, maxAgeSec = DEFAULT_MAX_AGE) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function stateCookie(value) {
  return `${STATE_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`;
}

export function clearStateCookie() {
  return `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
