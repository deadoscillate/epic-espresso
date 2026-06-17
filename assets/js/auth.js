// -----------------------------------------------------------------------------
// Client-side auth helper — talks to /api/auth/*. The session is an httpOnly
// cookie, so JS never sees a token; it only asks "who am I?" and triggers login.
// -----------------------------------------------------------------------------

export async function getMe() {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (!res.ok) return { user: null, configured: false };
    return await res.json(); // { user: {email,name,picture}|null, configured }
  } catch {
    return { user: null, configured: false };
  }
}

export const LOGIN_URL = "/api/auth/login";

export async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* ignore — the cookie clears server-side */
  }
}
