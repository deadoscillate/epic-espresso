// -----------------------------------------------------------------------------
// Fullscreen warehouse display
// -----------------------------------------------------------------------------
import "./pwa.js";
import { setupInstallButton } from "./install.js";
import { createCoffeeStore } from "./store.js";
import { getStatus, getManager, getOrderState } from "./statuses.js";
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
  soundBtn: document.getElementById("sound-btn"),
  orders: document.getElementById("orders"),
  ordersList: document.getElementById("orders-list"),
  orderFlash: document.getElementById("order-flash"),
  orderFlashText: document.getElementById("order-flash-text"),
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

  // Orders — render the queue and flash/chime on any newly-ready order.
  const orders = Array.isArray(state.orders) ? state.orders : [];
  const newlyReady = detectReady(orders);
  renderOrders(orders);
  if (newlyReady.length) {
    showFlash(newlyReady);
    playChime();
  }

  els.live.textContent = `${status.label}. ${state.message || status.tagline}`;
  els.updatedAbs.textContent = formatClock(state.updatedAt);
  els.updatedRel.textContent = formatRelative(state.updatedAt);

  if (els.themeMeta) {
    const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim();
    if (accent) els.themeMeta.setAttribute("content", accent);
  }
}

// --- Orders: queue rendering + "ready" flash & chime ------------------------
const ORDER_RANK = { ready: 0, making: 1, queued: 2 };

function renderOrders(orders) {
  els.orders.hidden = orders.length === 0;
  els.ordersList.textContent = "";
  const sorted = [...orders].sort(
    (a, b) => (ORDER_RANK[a.state] - ORDER_RANK[b.state]) || (a.createdAt || 0) - (b.createdAt || 0)
  );
  for (const o of sorted) {
    const info = getOrderState(o.state);
    const li = document.createElement("li");
    li.className = "order-chip";
    li.dataset.state = o.state;
    const name = document.createElement("span");
    name.className = "order-chip__name";
    name.textContent = o.item ? `${o.name} · ${o.item}` : o.name;
    const pill = document.createElement("span");
    pill.className = "order-chip__state";
    pill.textContent = info.label;
    li.append(name, pill);
    els.ordersList.appendChild(li);
  }
}

// Returns orders that just transitioned into "ready" since the last render. The
// first render only primes the baseline so we don't chime for a pre-existing queue.
let knownOrders = null;
function detectReady(orders) {
  const next = new Map(orders.map((o) => [o.id, o.state]));
  if (knownOrders === null) {
    knownOrders = next;
    return [];
  }
  const newly = orders.filter((o) => o.state === "ready" && knownOrders.get(o.id) !== "ready");
  knownOrders = next;
  return newly;
}

let flashTimer;
function showFlash(ready) {
  const first = ready[0];
  const label = first.item ? `${first.name}'s ${first.item}` : first.name;
  const extra = ready.length - 1;
  els.orderFlashText.textContent =
    extra > 0 ? `${label} + ${extra} more — order ready!` : `${label} — order ready!`;
  els.orderFlash.hidden = false;
  void els.orderFlash.offsetWidth; // reflow so the transition re-runs on retrigger
  els.orderFlash.classList.add("is-on");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    els.orderFlash.classList.remove("is-on");
    setTimeout(() => (els.orderFlash.hidden = true), 400);
  }, 5000);
}

// --- Chime (Web Audio; needs a user gesture to unlock on most browsers) ------
let soundOn = localStorage.getItem("bsmeb:sound") !== "off";
let audioCtx = null;
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {
    /* no Web Audio available — the visual flash still fires */
  }
}
function playChime() {
  if (!soundOn) return;
  unlockAudio();
  if (!audioCtx || audioCtx.state !== "running") return;
  const t0 = audioCtx.currentTime;
  [880, 1108.73, 1318.51].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = t0 + i * 0.16;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.5);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.55);
  });
}

function renderSoundBtn() {
  els.soundBtn.textContent = soundOn ? "🔔" : "🔕";
  els.soundBtn.setAttribute("aria-pressed", String(soundOn));
}
els.soundBtn.addEventListener("click", () => {
  soundOn = !soundOn;
  localStorage.setItem("bsmeb:sound", soundOn ? "on" : "off");
  renderSoundBtn();
  if (soundOn) playChime(); // doubles as the gesture that unlocks audio
});
renderSoundBtn();

// Unlock audio on the first interaction so the chime can play later (kiosks).
function primeAudioOnce() {
  unlockAudio();
  window.removeEventListener("pointerdown", primeAudioOnce);
  window.removeEventListener("keydown", primeAudioOnce);
}
window.addEventListener("pointerdown", primeAudioOnce);
window.addEventListener("keydown", primeAudioOnce);

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

// --- Scan-to-open QR (rendered once; points at this board's own origin) ------
function renderBoardQr() {
  const box = document.getElementById("board-qr");
  const img = document.getElementById("board-qr-img");
  if (!box || !img || typeof window.qrcode !== "function") return;
  try {
    const qr = window.qrcode(0, "M");
    qr.addData(location.origin + "/");
    qr.make();
    img.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    box.hidden = false;
  } catch (err) {
    console.error("[display] QR render failed:", err);
    box.hidden = true;
  }
}
renderBoardQr();

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
