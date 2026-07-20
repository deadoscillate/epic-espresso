import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { handle, scheduleDecision } from "../api/status.js";
import { PIN_RATE_LIMIT } from "../lib/server-security.js";

function fakeDb({ status = "ready", menu = ["Latte"], initialOrders = 0 } = {}) {
  const orders = [];
  const queries = [];
  const rateLimits = new Map();
  for (let i = 0; i < initialOrders; i++) {
    orders.push({
      id: i + 1,
      name: `Person ${i + 1}`,
      item: "Latte",
      state: "queued",
      created_at: Date.now(),
      updated_at: Date.now(),
    });
  }
  let coffeeState = {
    status,
    message: "",
    updated_at: Date.now(),
    manager_state: null,
    manager_note: null,
    manager_updated_at: null,
    schedule_enabled: false,
    schedule_open: null,
    schedule_close: null,
    schedule_tz: null,
    schedule_days: null,
    schedule_open_status: null,
    schedule_updated_at: null,
  };

  const db = async (strings, ...values) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push({ query, values });

    if (query.startsWith("SELECT attempts, window_start FROM coffee_rate_limits")) {
      const current = rateLimits.get(values[0]);
      return current ? [current] : [];
    }
    if (query.startsWith("INSERT INTO coffee_rate_limits")) {
      const [key, now, cutoff] = values;
      const current = rateLimits.get(key);
      const next = !current || current.window_start <= cutoff
        ? { attempts: 1, window_start: now }
        : { attempts: current.attempts + 1, window_start: current.window_start };
      rateLimits.set(key, next);
      return [next];
    }
    if (query.startsWith("DELETE FROM coffee_rate_limits WHERE key")) {
      rateLimits.delete(values[0]);
      return [];
    }
    if (query.startsWith("SELECT name FROM inventory")) return menu.map((name) => ({ name }));
    if (query.startsWith("SELECT COUNT(*) AS count FROM coffee_orders")) {
      return [{ count: String(orders.length) }];
    }
    if (query.startsWith("INSERT INTO coffee_orders")) {
      const order = {
        id: orders.length + 1,
        name: values[0],
        item: values[1] || "",
        state: "queued",
        created_at: values[2],
        updated_at: values[3],
      };
      orders.push(order);
      return [{ id: order.id }];
    }
    if (query.startsWith("INSERT INTO coffee_state (") && query.includes("schedule_enabled")) {
      coffeeState = {
        status: values[0],
        message: values[1],
        updated_at: null,
        manager_state: null,
        manager_note: null,
        manager_updated_at: null,
        schedule_enabled: values[2],
        schedule_open: values[3],
        schedule_close: values[4],
        schedule_tz: values[5],
        schedule_days: values[6],
        schedule_open_status: values[7],
        schedule_updated_at: values[8],
      };
      return [];
    }
    if (query.startsWith("SELECT status, message")) return coffeeState ? [coffeeState] : [];
    if (query.startsWith("SELECT id, name, item, state")) return orders;
    return [];
  };

  return { db, orders, queries };
}

function invoke(body, db, { raw, headers: requestHeaders } = {}) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = "POST";
    req.headers = requestHeaders || {};

    const headers = {};
    const res = {
      statusCode: 200,
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      end(payload = "") {
        resolve({
          status: this.statusCode,
          headers,
          body: payload ? JSON.parse(payload) : null,
        });
      },
    };

    handle(req, res, db).catch(reject);
    queueMicrotask(() => {
      req.emit("data", Buffer.from(raw ?? JSON.stringify(body)));
      req.emit("end");
    });
  });
}

test("guest and admin order authorization", async (t) => {
  process.env.ADMIN_PIN = "4827";
  t.after(() => delete process.env.ADMIN_PIN);

  await t.test("a guest can place a menu order with a name and no PIN", async () => {
    const { db, orders } = fakeDb();
    const result = await invoke({ order: { action: "add", name: "Chris", item: "Latte" } }, db);

    assert.equal(result.status, 200);
    assert.equal(result.body.createdOrderId, 1);
    assert.deepEqual(orders.map(({ name, item }) => ({ name, item })), [
      { name: "Chris", item: "Latte" },
    ]);
  });

  await t.test("a guest order still requires a name", async () => {
    const { db, orders } = fakeDb();
    const result = await invoke({ order: { action: "add", item: "Latte" } }, db);

    assert.equal(result.status, 400);
    assert.equal(result.body.error, "bad_order");
    assert.equal(orders.length, 0);
  });

  await t.test("a guest cannot order while the bar is closed", async () => {
    const { db, orders } = fakeDb({ status: "closed" });
    const result = await invoke({ order: { action: "add", name: "Chris", item: "Latte" } }, db);

    assert.equal(result.status, 409);
    assert.equal(result.body.error, "bar_unavailable");
    assert.equal(orders.length, 0);
  });

  await t.test("a guest cannot bypass an empty menu", async () => {
    const { db, orders } = fakeDb({ menu: [] });
    const result = await invoke({ order: { action: "add", name: "Chris", item: "Latte" } }, db);

    assert.equal(result.status, 400);
    assert.equal(result.body.error, "bad_item");
    assert.equal(orders.length, 0);
  });

  await t.test("menu item names use the inventory limit", async () => {
    const item = "x".repeat(60);
    const { db, orders } = fakeDb({ menu: [item] });
    const result = await invoke({ order: { action: "add", name: "Chris", item } }, db);

    assert.equal(result.status, 200);
    assert.equal(orders[0].item, item);
  });

  await t.test("the public queue has a hard capacity", async () => {
    const { db, orders } = fakeDb({ initialOrders: 50 });
    const result = await invoke({ order: { action: "add", name: "Chris", item: "Latte" } }, db);

    assert.equal(result.status, 409);
    assert.equal(result.body.error, "queue_full");
    assert.equal(orders.length, 50);
  });

  await t.test("an incorrect supplied PIN cannot fall through to guest ordering", async () => {
    const { db, orders } = fakeDb();
    const result = await invoke(
      { order: { action: "add", name: "Chris", item: "Latte" }, pin: "wrong" },
      db
    );

    assert.equal(result.status, 401);
    assert.equal(result.body.error, "bad_pin");
    assert.equal(orders.length, 0);
  });

  await t.test("coffee status updates remain PIN protected", async () => {
    const { db, queries } = fakeDb();
    const result = await invoke({ status: "ready", message: "Fresh pot" }, db);

    assert.equal(result.status, 401);
    assert.equal(result.body.error, "bad_pin");
    assert.equal(queries.some(({ query }) => query.startsWith("INSERT INTO coffee_state")), false);
  });

  await t.test("repeated bad PINs are rate limited", async () => {
    const { db } = fakeDb();
    for (let attempt = 0; attempt < PIN_RATE_LIMIT.max; attempt++) {
      const result = await invoke({ verify: true, pin: "wrong" }, db);
      assert.equal(result.status, 401);
    }
    const blocked = await invoke({ verify: true, pin: "wrong" }, db);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, "rate_limited");
    assert.ok(Number(blocked.headers["retry-after"]) > 0);
  });

  await t.test("oversized request bodies are rejected", async () => {
    const { db, queries } = fakeDb();
    const raw = JSON.stringify({ status: "ready", message: "x".repeat(9000), pin: "4827" });
    const result = await invoke(null, db, { raw });

    assert.equal(result.status, 413);
    assert.equal(result.body.error, "body_too_large");
    assert.equal(queries.length, 0);
  });

  await t.test("the same-site admin path accepts the correct PIN", async () => {
    process.env.APP_ROLE = "public"; // legacy deployments may still have this set
    const { db, orders } = fakeDb();
    const result = await invoke(
      { order: { action: "add", name: "Walk-up" }, pin: "4827" },
      db
    );

    assert.equal(result.status, 200);
    assert.equal(orders.length, 1);
    delete process.env.APP_ROLE;
  });
});

test("operating schedule decisions", async (t) => {
  const cfg = {
    enabled: true,
    tz: "UTC",
    open: "08:00",
    close: "16:30",
    days: [1, 2, 3, 4, 5],
    openStatus: "ready",
  };

  await t.test("closes an open board before business hours", () => {
    const decision = scheduleDecision(
      { status: "ready", updatedAt: Date.UTC(2026, 6, 20, 7, 59) },
      Date.UTC(2026, 6, 20, 7, 59),
      cfg
    );
    assert.deepEqual(decision, { status: "closed" });
  });

  await t.test("opens a board that was closed before today's opening", () => {
    const decision = scheduleDecision(
      { status: "closed", updatedAt: Date.UTC(2026, 6, 19, 16, 30) },
      Date.UTC(2026, 6, 20, 8, 0),
      cfg
    );
    assert.deepEqual(decision, { status: "ready" });
  });

  await t.test("does not override a manual close during open hours", () => {
    const decision = scheduleDecision(
      { status: "closed", updatedAt: Date.UTC(2026, 6, 20, 10, 0) },
      Date.UTC(2026, 6, 20, 11, 0),
      cfg
    );
    assert.equal(decision, null);
  });

  await t.test("does nothing when automatic hours are disabled", () => {
    const decision = scheduleDecision(
      { status: "ready", updatedAt: null },
      Date.UTC(2026, 6, 20, 7, 0),
      { ...cfg, enabled: false }
    );
    assert.equal(decision, null);
  });
});

test("operating schedule updates are validated and PIN protected", async (t) => {
  process.env.ADMIN_PIN = "4827";
  t.after(() => delete process.env.ADMIN_PIN);
  const validSchedule = {
    enabled: false,
    open: "07:30",
    close: "15:45",
    tz: "America/Chicago",
    days: [1, 2, 3, 4, 5],
    openStatus: "brewing",
  };

  await t.test("rejects an update without the admin PIN", async () => {
    const { db, queries } = fakeDb();
    const result = await invoke({ schedule: validSchedule }, db);

    assert.equal(result.status, 401);
    assert.equal(result.body.error, "bad_pin");
    assert.equal(
      queries.some(({ query }) => query.startsWith("INSERT INTO coffee_state (") && query.includes("schedule_enabled")),
      false
    );
  });

  await t.test("rejects closing times before opening times", async () => {
    const { db } = fakeDb();
    const result = await invoke(
      { schedule: { ...validSchedule, open: "16:00", close: "08:00" }, pin: "4827" },
      db
    );

    assert.equal(result.status, 400);
    assert.equal(result.body.error, "bad_schedule");
  });

  await t.test("persists a valid schedule", async () => {
    const { db } = fakeDb();
    const result = await invoke({ schedule: validSchedule, pin: "4827" }, db);

    assert.equal(result.status, 200);
    assert.equal(result.body.schedule.enabled, false);
    assert.equal(result.body.schedule.open, "07:30");
    assert.equal(result.body.schedule.close, "15:45");
    assert.equal(result.body.schedule.tz, "America/Chicago");
    assert.deepEqual(result.body.schedule.days, [1, 2, 3, 4, 5]);
    assert.equal(result.body.schedule.openStatus, "brewing");
    assert.equal(typeof result.body.schedule.updatedAt, "number");
  });
});
