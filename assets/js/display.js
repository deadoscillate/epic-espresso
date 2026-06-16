// -----------------------------------------------------------------------------
// Fullscreen warehouse display
// -----------------------------------------------------------------------------
import "./pwa.js";
import { setupInstallButton } from "./install.js";
import { createCoffeeStore } from "./store.js";
import { getStatus, getManager } from "./statuses.js";
import { formatClock, formatRelative, renderConnection } from "./util.js";

const store = createCoffeeStore();

const els = {
  card: document.getElementById("display-card"),
  fallback: document.getElementById("display-fallback"),
  icon: document.getElementById("display-icon"),
  status: document.getElementById("display-status"),
  tagline: document.getElementById("display-tagline"),
  message: document.getElementById("display-message"),
  live: document.getElementById("display-live"),
  managerBadge: document.getElementById("manager-badge"),
  managerBadgeText: document.getElementById("manager-badge-text"),
  updatedAbs: document.getElementById("updated-abs"),
  updatedRel: document.getElementById("updated-rel"),
  connection: document.getElementById("connection"),
  fullscreenBtn: document.getElementById("fullscreen-btn"),
  themeMeta: document.querySelector('meta[name="theme-color"]'),
};

let liveState = null;

els.card.addEventListener("load", () => {
  els.card.hidden = false;
  els.fallback.hidden = true;
});
els.card.addEventListener("error", () => {
  els.card.hidden = true;
  els.fallback.hidden = false;
});

function render(state) {
  liveState = state;
  const status = getStatus(state.status);

  document.body.dataset.status = status.id;

  if (els.card.dataset.status !== status.id) {
    els.card.dataset.status = status.id;
    els.card.alt = `${status.label} — ${status.tagline}`;
    els.card.src = status.image;
  }

  els.icon.textContent = status.icon;
  els.status.textContent = status.label;
  els.tagline.textContent = status.tagline;

  if (state.message) {
    els.message.textContent = state.message;
    els.message.hidden = false;
  } else {
    els.message.textContent = "";
    els.message.hidden = true;
  }

  // Manager (Joe) — only shown when he's not simply "Available".
  const manager = state.manager || { state: "available", note: "" };
  if (manager.state && manager.state !== "available") {
    const mInfo = getManager(manager.state);
    els.managerBadge.dataset.mstate = manager.state;
    els.managerBadgeText.textContent =
      `👤 Joe — ${mInfo.label}` + (manager.note ? ` · ${manager.note}` : "");
    els.managerBadge.hidden = false;
  } else {
    els.managerBadge.hidden = true;
  }

  els.live.textContent = `${status.label}. ${state.message || status.tagline}`;
  els.updatedAbs.textContent = formatClock(state.updatedAt);
  els.updatedRel.textContent = formatRelative(state.updatedAt);

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
setupInstallButton(
  document.getElementById("install-btn"),
  document.getElementById("install-hint")
);

store.onConnection((conn) => renderConnection(els.connection, conn));
store.onChange(render);

setInterval(() => {
  if (liveState) els.updatedRel.textContent = formatRelative(liveState.updatedAt);
}, 15000);

store.init();
