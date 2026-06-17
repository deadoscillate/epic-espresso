// -----------------------------------------------------------------------------
// /api/auth/* — Google sign-in (OpenID Connect, authorization-code flow)
// -----------------------------------------------------------------------------
//   GET  /api/auth/login    -> redirect to Google's consent screen
//   GET  /api/auth/callback -> exchange code, set the session cookie, back to /order
//   GET  /api/auth/me       -> { user: {email,name,picture} | null, configured }
//   POST /api/auth/logout   -> clear the session cookie
//
// Visitor sign-in only (admin stays on the PIN). Anyone with a Google account may
// sign in. Configure in Vercel:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET
//   Authorized redirect URI in Google: https://<your-domain>/api/auth/callback
// Until configured, login/callback return 503 and /me reports configured:false,
// so the rest of the app keeps working.
// -----------------------------------------------------------------------------

import crypto from "crypto";
import { neon } from "@neondatabase/serverless";
import {
  signSession,
  getSession,
  sessionCookie,
  clearSessionCookie,
  stateCookie,
  clearStateCookie,
  parseCookies,
  hasSecret,
  STATE_COOKIE_NAME,
} from "../../lib/session.js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const CONFIGURED = Boolean(CLIENT_ID && CLIENT_SECRET && hasSecret());

const DB_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_PRISMA_URL;
const sql = DB_URL ? neon(DB_URL) : null;

function baseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return `${proto}://${host}`;
}
const redirectUri = (req) => `${baseUrl(req)}/api/auth/callback`;

function json(res, code, obj, extraHeaders) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}

function decodeJwtPayload(token) {
  try {
    const part = String(token).split(".")[1];
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

async function upsertUser(claims) {
  if (!sql) return;
  try {
    await sql`CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      email text,
      name text,
      picture text,
      created_at bigint,
      last_login bigint
    )`;
    const now = Date.now();
    await sql`INSERT INTO users (id, email, name, picture, created_at, last_login)
              VALUES (${claims.sub}, ${claims.email || ""}, ${claims.name || ""},
                      ${claims.picture || ""}, ${now}, ${now})
              ON CONFLICT (id) DO UPDATE
                SET email = EXCLUDED.email,
                    name = EXCLUDED.name,
                    picture = EXCLUDED.picture,
                    last_login = EXCLUDED.last_login`;
  } catch (err) {
    console.error("[auth] user upsert failed:", err);
  }
}

function login(req, res) {
  const state = crypto.randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  res.statusCode = 302;
  res.setHeader("Set-Cookie", stateCookie(state));
  res.setHeader("Location", `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  res.end();
}

async function callback(req, res) {
  const { code, state } = req.query;
  const cookies = parseCookies(req);
  if (!code || !state || state !== cookies[STATE_COOKIE_NAME]) {
    return json(res, 400, { error: "bad_state" }, { "Set-Cookie": clearStateCookie() });
  }

  let token;
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri(req),
        grant_type: "authorization_code",
      }).toString(),
    });
    token = await r.json();
    if (!r.ok) throw new Error(token.error || `token ${r.status}`);
  } catch (err) {
    console.error("[auth] token exchange failed:", err);
    return json(res, 502, { error: "token_exchange_failed" }, { "Set-Cookie": clearStateCookie() });
  }

  // The id_token came straight from Google's token endpoint over TLS, so its
  // claims are trusted without re-verifying the signature; still sanity-check them.
  const claims = decodeJwtPayload(token.id_token);
  const issOk = claims && /(^|\.)accounts\.google\.com$|^https:\/\/accounts\.google\.com$/.test(String(claims.iss));
  if (!claims || claims.aud !== CLIENT_ID || !issOk || Number(claims.exp) * 1000 < Date.now()) {
    return json(res, 400, { error: "bad_id_token" }, { "Set-Cookie": clearStateCookie() });
  }

  await upsertUser(claims);

  const sessionToken = signSession({
    uid: claims.sub,
    email: claims.email || "",
    name: claims.name || "",
    picture: claims.picture || "",
  });
  res.statusCode = 302;
  res.setHeader("Set-Cookie", [sessionCookie(sessionToken), clearStateCookie()]);
  res.setHeader("Location", "/order/");
  res.end();
}

function me(req, res) {
  const s = getSession(req);
  json(res, 200, {
    configured: CONFIGURED,
    user: s ? { email: s.email, name: s.name, picture: s.picture } : null,
  });
}

function logout(req, res) {
  json(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
}

export default async function handler(req, res) {
  const action = req.query.action;

  if (action === "me") return me(req, res);
  if (action === "logout") return logout(req, res);

  // login + callback require Google to be configured
  if (!CONFIGURED) return json(res, 503, { error: "oauth_not_configured" });
  if (action === "login") return login(req, res);
  if (action === "callback") return callback(req, res);

  return json(res, 404, { error: "not_found" });
}
