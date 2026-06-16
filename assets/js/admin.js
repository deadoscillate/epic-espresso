// -----------------------------------------------------------------------------
// Admin control panel
// -----------------------------------------------------------------------------
import { createCoffeeStore } from "./store.js";
import { STATUSES, STATUS_ORDER, getStatus } from "./statuses.js";
import { formatClock, formatRelative, renderConnection } from "./util.js";

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
};

let liveState = null;
let messageTouched = false; // don't overwrite the field once the user types.

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
    <span class="status-btn__label">${status.label}</span>
  `;
  btn.addEventListener("click", () => applyStatus(id));
  els.grid.appendChild(btn);
  buttons.set(id, btn);
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
  setBusy(true);
  try {
    await store.setStatus({ status: statusId, message });
    showToast(successMsg, "ok");
  } catch (err) {
    console.error("[admin] Failed to update status:", err);
    showToast("Couldn’t save — check your connection and try again.", "error");
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  buttons.forEach((b) => (b.disabled = busy));
  els.applyMessage.disabled = busy || !liveState;
}

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

  // Reflect the active status across the page.
  document.body.dataset.status = status.id;
  buttons.forEach((btn, id) => {
    const active = id === status.id;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });

  // "Currently live" summary card.
  els.currentIcon.textContent = status.icon;
  els.currentLabel.textContent = status.label;
  els.currentMessage.textContent = shownMessage;
  els.updatedAbs.textContent = formatClock(state.updatedAt);
  els.updatedRel.textContent = formatRelative(state.updatedAt);

  // Use the status tagline as the field placeholder; prefill the live message
  // once, but never fight the user once they've started typing.
  els.message.placeholder = status.tagline;
  if (!messageTouched) {
    els.message.value = state.message || "";
    updateMessageCount();
  }
  els.applyMessage.disabled = false;
}

// --- Wire up & go ------------------------------------------------------------
store.onConnection((conn) => renderConnection(els.connection, conn));
store.onChange(render);

// Keep the "x min ago" label fresh.
setInterval(() => {
  if (liveState) els.updatedRel.textContent = formatRelative(liveState.updatedAt);
}, 15000);

updateMessageCount();
store.init();
