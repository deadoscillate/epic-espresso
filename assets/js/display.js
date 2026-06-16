// -----------------------------------------------------------------------------
// Fullscreen warehouse display
// -----------------------------------------------------------------------------
import "./pwa.js";
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
  themeMeta: document.querySelector('meta[name="theme-color"]'),
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

  // Match the browser/standalone status bar to the active status colour.
  if (els.themeMeta) {
    const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim();
    if (accent) els.themeMeta.setAttribute("content", accent);
  }
}

// --- Fullscreen + keep-awake (kiosk niceties) -------------------------------
let wakeLock = null;
async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    /* needs HTTPS + a visible page; ignore if unavailable */
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
    console.error("[display] fullscreen failed:", err);
  }
}
els.fullscreenBtn.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => {
  els.fullscreenBtn.setAttribute("aria-pressed", String(Boolean(document.fullscreenElement)));
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && document.fullscreenElement) requestWakeLock();
});

// --- Wire up & go ------------------------------------------------------------
store.onConnection((conn) => renderConnection(els.connection, conn));
store.onChange(render);

setInterval(() => {
  if (liveState) els.updatedRel.textContent = formatRelative(liveState.updatedAt);
}, 15000);

store.init();
