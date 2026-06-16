// -----------------------------------------------------------------------------
// Front-end configuration (no secrets here — the PIN and database creds live in
// Vercel environment variables, never in client code).
// -----------------------------------------------------------------------------

// Same-origin serverless endpoint that holds the shared status.
export const API_PATH = "/api/status";

// How often the display/admin re-checks for updates (ms). The app uses polling
// because Vercel has no built-in realtime push; 4s is plenty for a status sign.
export const POLL_INTERVAL_MS = 4000;
