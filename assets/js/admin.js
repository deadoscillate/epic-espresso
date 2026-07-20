// -----------------------------------------------------------------------------
// Admin control panel
// -----------------------------------------------------------------------------
import "./pwa.js";
import { createCoffeeStore } from "./store.js";
import {
  STATUSES,
  STATUS_ORDER,
  getStatus,
  MANAGER_STATES,
  MANAGER_ORDER,
  getManager,
  getOrderState,
} from "./statuses.js";
import { formatClock, formatRelative, renderConnection } from "./util.js";

const PIN_KEY = "bsmeb:pin";
const store = createCoffeeStore();

const els = {
  grid: document.getElementById("status-grid"),
  message: document.getElementById("message"),
  messageCount: document.getElementById("message-count"),
  applyMessage: document.getElementById("apply-message"),
  currentThumb: document.getElementById("current-thumb"),
  currentIcon: document.getElementById("current-icon"),
  currentLabel: document.getElementById("current-label"),
  currentMessage: document.getElementById("current-message"),
  updatedAbs: document.getElementById("updated-abs"),
  updatedRel: document.getElementById("updated-rel"),
  connection: document.getElementById("connection"),
  toast: document.getElementById("toast"),
  managerGrid: document.getElementById("manager-grid"),
  managerNote: document.getElementById("manager-note"),
  managerNoteApply: document.getElementById("manager-note-apply"),
  managerCurrent: document.getElementById("manager-current"),
  scheduleForm: document.getElementById("schedule-form"),
  scheduleEnabled: document.getElementById("schedule-enabled"),
  scheduleOpen: document.getElementById("schedule-open"),
  scheduleClose: document.getElementById("schedule-close"),
  scheduleTz: document.getElementById("schedule-tz"),
  scheduleOpenStatus: document.getElementById("schedule-open-status"),
  scheduleSummary: document.getElementById("schedule-summary"),
  orderAdd: document.getElementById("order-add"),
  orderName: document.getElementById("order-name"),
  orderAddBtn: document.getElementById("order-add-btn"),
  orderList: document.getElementById("order-list"),
  orderEmpty: document.getElementById("order-empty"),
  invAdd: document.getElementById("inv-add"),
  invName: document.getElementById("inv-name"),
  invStock: document.getElementById("inv-stock"),
  invAddBtn: document.getElementById("inv-add-btn"),
  invList: document.getElementById("inv-list"),
  invEmpty: document.getElementById("inv-empty"),
  gate: document.getElementById("pin-gate"),
  gateForm: document.getElementById("pin-form"),
  gateInput: document.getElementById("pin-input"),
  gateError: document.getElementById("pin-error"),
};

let liveState = null;
let messageTouched = false;
let managerNoteTouched = false;
let scheduleTouched = false;
let busy = false;
let unlocked = false;
let needsPin = false;
let modeHandled = false;
let pin = sessionStorage.getItem(PIN_KEY) || null;

// --- Status button grid -----------------------------------------------------
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

for (const id of STATUS_ORDER.filter((statusId) => statusId !== "closed")) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = STATUSES[id].label;
  els.scheduleOpenStatus.appendChild(option);
}

// --- Manager (Joe) button grid ----------------------------------------------
const managerButtons = new Map();
for (const id of MANAGER_ORDER) {
  const m = MANAGER_STATES[id];
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "manager-btn";
  btn.dataset.mstate = id;
  btn.setAttribute("aria-pressed", "false");
  btn.setAttribute("aria-label", `Set Joe to ${m.label}`);
  btn.innerHTML = `<span aria-hidden="true">${m.icon}</span> <span>${m.label}</span>`;
  btn.addEventListener("click", () => commitManager(id));
  els.managerGrid.appendChild(btn);
  managerButtons.set(id, btn);
}

// Thumbnail falls back to the emoji if the image can't load.
els.currentThumb.addEventListener("load", () => {
  els.currentThumb.hidden = false;
  els.currentIcon.hidden = true;
});
els.currentThumb.addEventListener("error", () => {
  els.currentThumb.hidden = true;
  els.currentIcon.hidden = false;
});

// --- Controls enable/disable ------------------------------------------------
function updateControls() {
  const enabled = unlocked && !busy;
  buttons.forEach((b) => (b.disabled = !enabled));
  managerButtons.forEach((b) => (b.disabled = !enabled));
  els.applyMessage.disabled = !enabled || !liveState;
  els.managerNoteApply.disabled = !enabled || !liveState;
  els.scheduleForm
    .querySelectorAll("input, select, button")
    .forEach((control) => (control.disabled = !enabled || !liveState));
  els.orderName.disabled = !enabled;
  els.orderAddBtn.disabled = !enabled;
  els.orderList.querySelectorAll("button").forEach((b) => (b.disabled = !enabled));
  els.invName.disabled = !enabled;
  els.invStock.disabled = !enabled;
  els.invAddBtn.disabled = !enabled;
  els.invList.querySelectorAll("input, button").forEach((b) => (b.disabled = !enabled));
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
    handleWriteError(err, "Couldn’t save — try again.");
  } finally {
    busy = false;
    updateControls();
  }
}

async function commitManager(stateId) {
  busy = true;
  updateControls();
  try {
    await store.setManager({ state: stateId, note: els.managerNote.value, pin });
    managerNoteTouched = false;
    showToast(`Joe: ${MANAGER_STATES[stateId].label}.`, "ok");
  } catch (err) {
    handleWriteError(err, "Couldn’t update Joe’s status.");
  } finally {
    busy = false;
    updateControls();
  }
}

// Save just the note, keeping Joe's current status (e.g. update "back ~2:30").
async function applyManagerNoteOnly() {
  if (!liveState) return;
  const current = (liveState.manager && liveState.manager.state) || "available";
  busy = true;
  updateControls();
  try {
    await store.setManager({ state: current, note: els.managerNote.value, pin });
    managerNoteTouched = false;
    showToast("Joe’s note updated.", "ok");
  } catch (err) {
    handleWriteError(err, "Couldn’t update the note.");
  } finally {
    busy = false;
    updateControls();
  }
}

// --- Hours of operation ----------------------------------------------------
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function displayTime(value) {
  const [hour, minute] = String(value || "00:00").split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const shownHour = hour % 12 || 12;
  return `${shownHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function renderSchedule(schedule) {
  const current = schedule || {
    enabled: true,
    tz: "America/Chicago",
    open: "08:00",
    close: "16:30",
    days: [1, 2, 3, 4, 5],
    openStatus: "ready",
  };
  const days = Array.isArray(current.days) ? current.days : [];
  if (!scheduleTouched) {
    els.scheduleEnabled.checked = current.enabled;
    els.scheduleOpen.value = current.open;
    els.scheduleClose.value = current.close;
    els.scheduleTz.value = current.tz;
    els.scheduleOpenStatus.value = current.openStatus;
    els.scheduleForm.querySelectorAll('input[name="schedule-day"]').forEach((checkbox) => {
      checkbox.checked = days.includes(Number(checkbox.value));
    });
  }

  if (!current.enabled) {
    els.scheduleSummary.textContent = "Automatic hours are off.";
    return;
  }
  const dayText = days.map((day) => DAY_LABELS[day]).join(", ");
  els.scheduleSummary.textContent = `${dayText} · ${displayTime(current.open)}–${displayTime(
    current.close
  )} · ${current.tz}`;
}

async function saveSchedule(e) {
  e.preventDefault();
  if (!els.scheduleForm.reportValidity()) return;
  const days = [...els.scheduleForm.querySelectorAll('input[name="schedule-day"]:checked')].map(
    (checkbox) => Number(checkbox.value)
  );
  if (!days.length) {
    showToast("Choose at least one open day.", "error");
    return;
  }
  if (els.scheduleOpen.value >= els.scheduleClose.value) {
    showToast("Opening time must be before closing time.", "error");
    return;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: els.scheduleTz.value.trim() }).format(new Date());
  } catch {
    showToast("Enter a valid IANA time zone, such as America/Chicago.", "error");
    return;
  }

  busy = true;
  updateControls();
  try {
    await store.setSchedule({
      enabled: els.scheduleEnabled.checked,
      open: els.scheduleOpen.value,
      close: els.scheduleClose.value,
      tz: els.scheduleTz.value.trim(),
      days,
      openStatus: els.scheduleOpenStatus.value,
      pin,
    });
    scheduleTouched = false;
    showToast("Hours of operation updated.", "ok");
  } catch (err) {
    handleWriteError(err, "Couldn’t update the hours.");
  } finally {
    busy = false;
    updateControls();
  }
}

// --- Orders -----------------------------------------------------------------
async function addOrder(e) {
  e.preventDefault();
  const name = els.orderName.value.trim();
  if (!name) return;
  busy = true;
  updateControls();
  try {
    await store.addOrder({ name, pin });
    els.orderName.value = "";
    showToast(`Added ${name} to the queue.`, "ok");
  } catch (err) {
    handleWriteError(err, "Couldn’t add the order.");
  } finally {
    busy = false;
    updateControls();
    els.orderName.focus();
  }
}

async function advanceOrder(id) {
  busy = true;
  updateControls();
  try {
    await store.advanceOrder({ id, pin });
  } catch (err) {
    handleWriteError(err, "Couldn’t update the order.");
  } finally {
    busy = false;
    updateControls();
  }
}

async function removeOrder(id) {
  busy = true;
  updateControls();
  try {
    await store.removeOrder({ id, pin });
  } catch (err) {
    handleWriteError(err, "Couldn’t remove the order.");
  } finally {
    busy = false;
    updateControls();
  }
}

function renderOrders(orders) {
  els.orderList.textContent = "";
  els.orderEmpty.hidden = orders.length > 0;
  for (const o of orders) {
    const info = getOrderState(o.state);
    const li = document.createElement("li");
    li.className = "order-row";
    li.dataset.state = o.state;

    const name = document.createElement("span");
    name.className = "order-row__name";
    name.textContent = o.name;

    const pill = document.createElement("span");
    pill.className = "order-row__pill";
    pill.textContent = `${info.icon} ${info.label}`;

    const actions = document.createElement("div");
    actions.className = "order-row__actions";

    const adv = document.createElement("button");
    adv.type = "button";
    adv.className = "btn order-row__advance";
    adv.textContent = info.advanceLabel;
    adv.addEventListener("click", () => advanceOrder(o.id));

    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "btn order-row__remove";
    rm.setAttribute("aria-label", `Remove ${o.name}`);
    rm.textContent = "✕";
    rm.addEventListener("click", () => removeOrder(o.id));

    actions.append(adv, rm);
    li.append(name, pill, actions);
    els.orderList.appendChild(li);
  }
}

// --- Inventory (menu + stock) -----------------------------------------------
async function loadInventory() {
  try {
    const res = await fetch("/api/inventory", { cache: "no-store" });
    if (res.ok) renderInventory((await res.json()).items || []);
  } catch {
    /* GET is best-effort */
  }
}

async function invPost(payload) {
  const res = await fetch("/api/inventory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, pin }),
  });
  if (res.status === 401) {
    const e = new Error("Incorrect PIN.");
    e.code = "bad_pin";
    throw e;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const e = new Error("Couldn’t save inventory.");
    e.code = body.error || `http_${res.status}`;
    throw e;
  }
  return (await res.json()).items || [];
}

async function invAdd(e) {
  e.preventDefault();
  const name = els.invName.value.trim();
  if (!name) return;
  const stock = Number(els.invStock.value) || 0;
  busy = true;
  updateControls();
  try {
    renderInventory(await invPost({ action: "add", name, stock, available: true }));
    els.invName.value = "";
    els.invStock.value = "0";
    showToast(`Added ${name}.`, "ok");
  } catch (err) {
    handleWriteError(err, "Couldn’t add the item.");
  } finally {
    busy = false;
    updateControls();
    els.invName.focus();
  }
}

async function invMutate(payload, fallback) {
  busy = true;
  updateControls();
  try {
    renderInventory(await invPost(payload));
  } catch (err) {
    handleWriteError(err, fallback);
  } finally {
    busy = false;
    updateControls();
  }
}

function renderInventory(items) {
  els.invList.textContent = "";
  els.invEmpty.hidden = items.length > 0;
  for (const it of items) {
    const li = document.createElement("li");
    li.className = "inv-row";
    li.dataset.available = String(it.available);

    const name = document.createElement("span");
    name.className = "inv-row__name";
    name.textContent = it.name;

    const menuLabel = document.createElement("label");
    menuLabel.className = "inv-row__menu";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = it.available;
    cb.addEventListener("change", () =>
      invMutate({ action: "update", id: it.id, available: cb.checked }, "Couldn’t update the item.")
    );
    menuLabel.append(cb, document.createTextNode(" On menu"));

    const stockWrap = document.createElement("span");
    stockWrap.className = "inv-row__stock";
    const stockInput = document.createElement("input");
    stockInput.type = "number";
    stockInput.min = "0";
    stockInput.value = String(it.stock);
    stockInput.setAttribute("aria-label", `${it.name} stock`);
    stockInput.addEventListener("change", () => {
      const v = Number(stockInput.value);
      if (Number.isFinite(v) && v !== it.stock) {
        invMutate({ action: "update", id: it.id, stock: v }, "Couldn’t update stock.");
      }
    });
    stockInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        stockInput.blur();
      }
    });
    stockWrap.append(document.createTextNode("Stock "), stockInput);

    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "btn inv-row__remove";
    rm.setAttribute("aria-label", `Remove ${it.name}`);
    rm.textContent = "✕";
    rm.addEventListener("click", () =>
      invMutate({ action: "remove", id: it.id }, "Couldn’t remove the item.")
    );

    li.append(name, menuLabel, stockWrap, rm);
    els.invList.appendChild(li);
  }
  updateControls();
}

function handleWriteError(err, fallback) {
  console.error("[admin] update failed:", err);
  if (err.code === "bad_pin") {
    lock("That PIN no longer works. Please re-enter it.");
    showToast("PIN required.", "error");
  } else {
    showToast(err.message || fallback, "error");
  }
}

// --- PIN gate ---------------------------------------------------------------
function openGate(message) {
  els.gate.hidden = false;
  els.gateError.textContent = message || "";
  els.gateInput.value = "";
  setTimeout(() => els.gateInput.focus(), 50);
}
function unlock() {
  unlocked = true;
  els.gate.hidden = true;
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
    if (await store.verifyPin(entered)) {
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

// --- Inputs -----------------------------------------------------------------
function updateMessageCount() {
  els.messageCount.textContent = `${els.message.value.length}/280`;
}
els.message.addEventListener("input", () => {
  messageTouched = true;
  updateMessageCount();
});
els.managerNote.addEventListener("input", () => {
  managerNoteTouched = true;
});
els.managerNote.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    applyManagerNoteOnly();
  }
});
els.managerNoteApply.addEventListener("click", applyManagerNoteOnly);
els.applyMessage.addEventListener("click", applyMessageOnly);
els.scheduleForm.addEventListener("input", () => {
  scheduleTouched = true;
});
els.scheduleForm.addEventListener("submit", saveSchedule);
els.orderAdd.addEventListener("submit", addOrder);
els.invAdd.addEventListener("submit", invAdd);

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

  if (els.currentThumb.dataset.status !== status.id) {
    els.currentThumb.dataset.status = status.id;
    els.currentThumb.alt = status.label;
    els.currentThumb.src = status.image;
  }
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

  // Manager (Joe)
  const manager = state.manager || { state: "available", note: "", updatedAt: null };
  const mInfo = getManager(manager.state);
  managerButtons.forEach((btn, id) => {
    const active = id === manager.state;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  els.managerCurrent.textContent = manager.note
    ? `${mInfo.icon} ${mInfo.label} — ${manager.note}`
    : `${mInfo.icon} ${mInfo.label}`;
  if (!managerNoteTouched) els.managerNote.value = manager.note || "";

  // Hours of operation
  renderSchedule(state.schedule);

  // Orders
  renderOrders(state.orders || []);

  updateControls();
}

// --- Wire up & go ------------------------------------------------------------
store.onConnection((conn) => {
  renderConnection(els.connection, conn);
  if (modeHandled || conn.mode === "connecting") return;
  modeHandled = true;

  if (conn.mode === "demo") {
    needsPin = false;
    unlock();
    return;
  }
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
loadInventory();
store.init();
