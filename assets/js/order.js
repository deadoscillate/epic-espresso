// -----------------------------------------------------------------------------
// Self-serve order page — sign in with Google, pick from the menu, watch the queue
// -----------------------------------------------------------------------------
import { createCoffeeStore } from "./store.js";
import { getStatus, getOrderState } from "./statuses.js";
import { getMe, logout } from "./auth.js";
import { renderConnection } from "./util.js";

const MY_KEY = "ee:myorders";
const store = createCoffeeStore();

const els = {
  loading: document.getElementById("order-loading"),
  sub: document.getElementById("order-sub"),
  unconfigured: document.getElementById("state-unconfigured"),
  signedOut: document.getElementById("state-signedout"),
  signedIn: document.getElementById("state-signedin"),
  greeting: document.getElementById("user-greeting"),
  logoutBtn: document.getElementById("logout-btn"),
  barStatus: document.getElementById("bar-status"),
  menu: document.getElementById("menu"),
  menuEmpty: document.getElementById("menu-empty"),
  queue: document.getElementById("queue"),
  queueEmpty: document.getElementById("queue-empty"),
  ready: document.getElementById("order-ready"),
  toast: document.getElementById("toast"),
  connection: document.getElementById("connection"),
};

let busy = false;
const readySeen = new Set();

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
    btn.addEventListener("click", () => placeOrder(it.name, btn));
    els.menu.appendChild(btn);
  }
}

async function placeOrder(item, btn) {
  if (busy) return;
  busy = true;
  if (btn) btn.disabled = true;
  try {
    const id = await store.addOrder({ item });
    rememberOrder(id);
    showToast(`Ordered ${item}! You're in the queue.`, "ok");
  } catch (err) {
    showToast(err.message || "Couldn't place your order.", "error");
  } finally {
    busy = false;
    if (btn) btn.disabled = false;
  }
}

function renderQueue(state) {
  const status = getStatus(state.status);
  document.body.dataset.status = status.id;
  els.barStatus.textContent = `Bar status: ${status.icon} ${status.label}`;

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
  const info = await getMe();
  els.loading.hidden = true;

  if (!info.configured) {
    els.unconfigured.hidden = false;
    els.sub.textContent = "Ordering isn't available yet.";
    return;
  }
  if (!info.user) {
    els.signedOut.hidden = false;
    els.sub.textContent = "Sign in to place your order.";
    return;
  }

  els.signedIn.hidden = false;
  const first = String(info.user.name || info.user.email || "there").split(/\s+/)[0];
  els.greeting.textContent = `Hi, ${first}`;
  els.sub.textContent = "Pick something from the menu.";
  els.logoutBtn.addEventListener("click", async () => {
    await logout();
    location.reload();
  });

  await loadMenu();
  store.onConnection((c) => renderConnection(els.connection, c));
  store.onChange(renderQueue);
  store.init();
}

start();
