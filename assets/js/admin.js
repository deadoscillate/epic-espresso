// -----------------------------------------------------------------------------
// Admin control panel
// -----------------------------------------------------------------------------
import "./pwa.js";
import { createCoffeeStore } from "./store.js";
import { STATUSES, STATUS_ORDER, getStatus } from "./statuses.js";
import { formatClock, formatRelative, renderConnection } from "./util.js";

const PIN_KEY = "bsmeb:pin";
const store = createCoffeeStore();

const els = {
  grid: document.getElementById("status-grid"),
  message: document.getElementById("message"),
  messageCount: document.getElementById("message-count"),
  applyMessage: document.getElementById("apply-message"),
  currentIcon: document.getElementById("current-icon"),
  currentLabel: document.getElementById("current-label"),
  currentMessage: document.getElementById("current-message"),
  updatedAbs: document.getElementById("updated-abs"),
  updatedRel: document.getElementById("updated-rel"),
  connection: document.getElementById("connection"),
  toast: document.getElementById("toast"),
  gate: document.getElementById("pin-gate"),
  gateForm: document.getElementById("pin-form"),
  gateInput: document.getElementById("pin-input"),
  gateError: document.getElementById("pin-error"),
};

let liveState = null;
let messageTouched = false;
let busy = false;
let unlocked = false; // allowed to make changes
let needsPin = false; // live mode requires a PIN
let modeHandled = false; // gate/auth resolved once
let pin = sessionStorage.getItem(PIN_KEY) || null;

// --- Build the status button grid ------------------------------------------
const buttons = new Map();
for (const id of STATUS_ORDER) {
  const status = STATUSES[id];
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "status-btn";
  btn.dataset.status = id;
  btn.setAttribute("aria-pressed", "false");
  btn.setAttribute("aria-label", `Set status to ${status.label}`);
  btn.innerHTML = `
    <span class="status-btn__icon" aria-hidden="true">${status.icon}</span>
    <span class="status-btn__label">${status.label}</span>`;
  btn.addEventListener("click", () => applyStatus(id));
  els.grid.appendChild(btn);
  buttons.set(id, btn);
}

// --- Controls enable/disable ------------------------------------------------
function updateControls() {
  const enabled = unlocked && !busy;
  buttons.forEach((b) => (b.disabled = !enabled));
  els.applyMessage.disabled = !enabled || !liveState;
}

// --- Actions ----------------------------------------------------------------
async function applyStatus(statusId) {
  await commit(statusId, els.message.value, `Status set to “${STATUSES[statusId].label}”.`);
}
async function applyMessageOnly() {
  if (!liveState) return;
  await commit(liveState.status, els.message.value, "Message updated.");
}

async function commit(statusId, message, successMsg) {
  busy = true;
  updateControls();
  try {
    await store.setStatus({ status: statusId, message, pin });
    showToast(successMsg, "ok");
  } catch (err) {
    console.error("[admin] update failed:", err);
    if (err.code === "bad_pin") {
      // PIN was rotated — re-lock and prompt again.
      lock("That PIN no longer works. Please re-enter it.");
      showToast("PIN required.", "error");
    } else {
      showToast(err.message || "Couldn’t save — try again.", "error");
    }
  } finally {
    busy = false;
    updateControls();
  }
}

// --- PIN gate ---------------------------------------------------------------
function openGate(message) {
  els.gate.hidden = false;
  els.gateError.textContent = message || "";
  els.gateInput.value = "";
  setTimeout(() => els.gateInput.focus(), 50);
}
function closeGate() {
  els.gate.hidden = true;
}
function unlock() {
  unlocked = true;
  closeGate();
  updateControls();
}
function lock(message) {
  unlocked = false;
  pin = null;
  sessionStorage.removeItem(PIN_KEY);
  if (needsPin) openGate(message);
  updateControls();
}

els.gateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const entered = els.gateInput.value.trim();
  if (!entered) return;
  els.gateError.textContent = "Checking…";
  try {
    const ok = await store.verifyPin(entered);
    if (ok) {
      pin = entered;
      sessionStorage.setItem(PIN_KEY, pin);
      unlock();
      showToast("Unlocked.", "ok");
    } else {
      els.gateError.textContent = "Incorrect PIN.";
    }
  } catch (err) {
    els.gateError.textContent = err.message || "Couldn’t verify. Try again.";
  }
});

// --- Toast ------------------------------------------------------------------
let toastTimer;
function showToast(text, kind) {
  els.toast.textContent = text;
  els.toast.dataset.kind = kind;
  els.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 3200);
}

// --- Message field ----------------------------------------------------------
function updateMessageCount() {
  els.messageCount.textContent = `${els.message.value.length}/280`;
}
els.message.addEventListener("input", () => {
  messageTouched = true;
  updateMessageCount();
});
els.applyMessage.addEventListener("click", applyMessageOnly);

// --- Render live state -------------------------------------------------------
function render(state) {
  liveState = state;
  const status = getStatus(state.status);
  const shownMessage = state.message || status.tagline;

  document.body.dataset.status = status.id;
  buttons.forEach((btn, id) => {
    const active = id === status.id;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });

  els.currentIcon.textContent = status.icon;
  els.currentLabel.textContent = status.label;
  els.currentMessage.textContent = shownMessage;
  els.updatedAbs.textContent = formatClock(state.updatedAt);
  els.updatedRel.textContent = formatRelative(state.updatedAt);

  els.message.placeholder = status.tagline;
  if (!messageTouched) {
    els.message.value = state.message || "";
    updateMessageCount();
  }
  updateControls();
}

// --- Wire up & go ------------------------------------------------------------
store.onConnection((conn) => {
  renderConnection(els.connection, conn);
  if (modeHandled || conn.mode === "connecting") return;
  modeHandled = true;

  if (conn.mode === "demo") {
    needsPin = false;
    unlock(); // no PIN in demo mode
    return;
  }

  // Live mode requires the PIN.
  needsPin = true;
  if (pin) {
    store
      .verifyPin(pin)
      .then((ok) => (ok ? unlock() : lock()))
      .catch(() => openGate("Couldn’t verify saved PIN — please re-enter it."));
  } else {
    openGate();
  }
});
store.onChange(render);

setInterval(() => {
  if (liveState) els.updatedRel.textContent = formatRelative(liveState.updatedAt);
}, 15000);

updateMessageCount();
updateControls();
store.init();
