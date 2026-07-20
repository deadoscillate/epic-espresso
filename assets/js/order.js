// -----------------------------------------------------------------------------
// Self-serve order page — enter a name, pick from the menu, watch the queue
// -----------------------------------------------------------------------------
import "./pwa.js";
import { createCoffeeStore } from "./store.js";
import { getStatus, getOrderState } from "./statuses.js";
import { setupTips } from "./tips.js";
import { renderConnection } from "./util.js";
import { ORDERABLE_STATUSES } from "../../shared/constants.js";

const MY_KEY = "ee:guestOrders";
const NAME_KEY = "ee:orderName";
const store = createCoffeeStore();

const els = {
  sub: document.getElementById("order-sub"),
  name: document.getElementById("order-name"),
  barStatus: document.getElementById("bar-status"),
  menu: document.getElementById("menu"),
  menuEmpty: document.getElementById("menu-empty"),
  queue: document.getElementById("queue"),
  queueEmpty: document.getElementById("queue-empty"),
  ready: document.getElementById("order-ready"),
  tips: document.getElementById("tips"),
  tipMethods: document.getElementById("tip-methods"),
  toast: document.getElementById("toast"),
  connection: document.getElementById("connection"),
};

let busy = false;
let connectionOnline = false;
let currentBarStatus = "closed";
const readySeen = new Set();
const DEFAULT_SUB = "Enter your name, then pick something from the menu.";

const myIds = () => {
  try {
    return JSON.parse(localStorage.getItem(MY_KEY) || "[]");
  } catch {
    return [];
  }
};
const setMyIds = (ids) => localStorage.setItem(MY_KEY, JSON.stringify(ids));
function rememberOrder(id) {
  if (id == null) return;
  const ids = myIds();
  if (!ids.includes(id)) {
    ids.push(id);
    setMyIds(ids);
  }
}

let toastTimer;
function showToast(text, kind) {
  els.toast.textContent = text;
  els.toast.dataset.kind = kind || "";
  els.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 3200);
}

async function loadMenu() {
  let items = [];
  try {
    const res = await fetch("/api/inventory", { cache: "no-store" });
    if (res.ok) items = (await res.json()).items || [];
  } catch {
    /* offline / not configured — menu just shows empty */
  }
  const available = items.filter((i) => i.available);
  els.menu.textContent = "";
  els.menuEmpty.hidden = available.length > 0;
  for (const it of available) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menu-item";
    btn.textContent = it.name;
    btn.addEventListener("click", () => placeOrder(it.name));
    els.menu.appendChild(btn);
  }
  updateOrderControls();
}

function updateOrderControls() {
  const statusAllowsOrders = ORDERABLE_STATUSES.includes(currentBarStatus);
  const canOrder = connectionOnline && statusAllowsOrders && !busy;
  els.menu.querySelectorAll("button").forEach((button) => (button.disabled = !canOrder));
  if (!connectionOnline) {
    els.sub.textContent = "Reconnecting — ordering is temporarily unavailable.";
  } else if (!statusAllowsOrders) {
    els.sub.textContent = "The espresso bar isn’t accepting orders in its current status.";
  } else {
    els.sub.textContent = DEFAULT_SUB;
  }
}

async function placeOrder(item) {
  if (busy) return;
  if (!connectionOnline) {
    showToast("Still reconnecting — please wait a moment.", "error");
    return;
  }
  if (!ORDERABLE_STATUSES.includes(currentBarStatus)) {
    showToast("The espresso bar isn’t accepting orders right now.", "error");
    return;
  }
  const name = els.name.value.trim();
  if (!name) {
    showToast("Enter your name before choosing an item.", "error");
    els.name.focus();
    return;
  }
  localStorage.setItem(NAME_KEY, name);
  busy = true;
  updateOrderControls();
  try {
    const id = await store.addOrder({ name, item });
    rememberOrder(id);
    showToast(`Ordered ${item}! You're in the queue.`, "ok");
  } catch (err) {
    showToast(err.message || "Couldn't place your order.", "error");
  } finally {
    busy = false;
    updateOrderControls();
  }
}

function renderQueue(state) {
  const status = getStatus(state.status);
  currentBarStatus = status.id;
  document.body.dataset.status = status.id;
  const availability = ORDERABLE_STATUSES.includes(status.id) ? "" : " · Ordering unavailable";
  els.barStatus.textContent = `Bar status: ${status.icon} ${status.label}${availability}`;
  updateOrderControls();

  const orders = Array.isArray(state.orders) ? state.orders : [];
  const present = new Set(orders.map((o) => o.id));
  const mine = new Set(myIds().filter((id) => present.has(id)));
  if (mine.size !== myIds().length) setMyIds([...mine]);

  els.queue.textContent = "";
  els.queueEmpty.hidden = orders.length > 0;
  for (const o of orders) {
    const info = getOrderState(o.state);
    const li = document.createElement("li");
    li.className = "queue-item";
    li.dataset.state = o.state;
    if (mine.has(o.id)) li.classList.add("is-mine");

    const who = document.createElement("span");
    who.className = "queue-item__who";
    who.textContent = mine.has(o.id) ? "You" : o.name;

    const what = document.createElement("span");
    what.className = "queue-item__what";
    what.textContent = o.item || "";

    const st = document.createElement("span");
    st.className = "queue-item__state";
    st.textContent = `${info.icon} ${info.label}`;

    li.append(who, what, st);
    els.queue.appendChild(li);
  }

  const myReady = orders.filter((o) => mine.has(o.id) && o.state === "ready");
  if (myReady.length) {
    const what = myReady.map((o) => o.item || "order").join(", ");
    els.ready.textContent = `✅ Your ${what} ${myReady.length > 1 ? "are" : "is"} ready — come grab it!`;
    els.ready.hidden = false;
    for (const o of myReady) {
      if (!readySeen.has(o.id)) {
        readySeen.add(o.id);
        if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
      }
    }
  } else {
    els.ready.hidden = true;
  }
}

async function start() {
  setupTips(els.tips, els.tipMethods);
  els.name.value = localStorage.getItem(NAME_KEY) || "";
  els.name.addEventListener("change", () => {
    const name = els.name.value.trim();
    if (name) localStorage.setItem(NAME_KEY, name);
    else localStorage.removeItem(NAME_KEY);
  });
  await loadMenu();
  store.onConnection((c) => {
    connectionOnline = c.online;
    renderConnection(els.connection, c);
    updateOrderControls();
  });
  store.onChange(renderQueue);
  store.init();
}

start();
