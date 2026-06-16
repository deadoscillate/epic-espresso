// -----------------------------------------------------------------------------
// Fullscreen warehouse display
// -----------------------------------------------------------------------------
import { createCoffeeStore } from "./store.js";
import { getStatus } from "./statuses.js";
import { formatClock, formatRelative, renderConnection } from "./util.js";

const store = createCoffeeStore();

const els = {
  icon: document.getElementById("display-icon"),
  status: document.getElementById("display-status"),
  message: document.getElementById("display-message"),
  updatedAbs: document.getElementById("updated-abs"),
  updatedRel: document.getElementById("updated-rel"),
  connection: document.getElementById("connection"),
  fullscreenBtn: document.getElementById("fullscreen-btn"),
};

let liveState = null;

function render(state) {
  liveState = state;
  const status = getStatus(state.status);

  document.body.dataset.status = status.id;
  els.icon.textContent = status.icon;
  els.status.textContent = status.label;
  els.message.textContent = state.message || status.tagline;
  els.updatedAbs.textContent = formatClock(state.updatedAt);
  els.updatedRel.textContent = formatRelative(state.updatedAt);
}

// --- Fullscreen + keep-awake (kiosk niceties) -------------------------------
let wakeLock = null;

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    /* Wake Lock needs HTTPS + a visible page; ignore if unavailable. */
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
      requestWakeLock();
    }
  } catch (err) {
    console.error("[display] Fullscreen request failed:", err);
  }
}

els.fullscreenBtn.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => {
  els.fullscreenBtn.setAttribute("aria-pressed", String(Boolean(document.fullscreenElement)));
});

// Re-acquire the wake lock if the tab was hidden (OS releases it automatically).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && document.fullscreenElement) requestWakeLock();
});

// --- Wire up & go ------------------------------------------------------------
store.onConnection((conn) => renderConnection(els.connection, conn));
store.onChange(render);

// Live updates come from the store; this just keeps the relative time fresh.
setInterval(() => {
  if (liveState) els.updatedRel.textContent = formatRelative(liveState.updatedAt);
}, 15000);

store.init();
