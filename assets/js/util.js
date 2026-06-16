// -----------------------------------------------------------------------------
// Small shared helpers (time formatting + the connection indicator renderer)
// -----------------------------------------------------------------------------

// Absolute "last updated" clock, e.g. "Tue 9:42 AM". Uses the viewer's locale.
export function formatClock(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

// Friendly relative time, e.g. "just now", "4 min ago", "2 hr ago".
export function formatRelative(ts, now = Date.now()) {
  if (!ts) return "never";
  const diff = Math.max(0, now - ts);
  const sec = Math.round(diff / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

// Updates a connection-indicator element. The element is expected to contain
// `.conn-dot` and `.conn-text` children; colour is driven purely by CSS via the
// `data-online` / `data-mode` attributes set here.
export function renderConnection(el, conn) {
  if (!el) return;
  el.dataset.mode = conn.mode; // "firebase" | "demo"
  el.dataset.online = String(conn.online);
  const text = el.querySelector(".conn-text");
  if (text) text.textContent = conn.label;
  el.setAttribute("title", conn.label);
}
