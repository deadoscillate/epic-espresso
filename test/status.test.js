import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { handle } from "../api/status.js";

function fakeDb() {
  const orders = [];
  const queries = [];

  const db = async (strings, ...values) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push({ query, values });

    if (query.startsWith("SELECT name FROM inventory")) return [{ name: "Latte" }];
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
    if (query.startsWith("SELECT status, message")) return [];
    if (query.startsWith("SELECT id, name, item, state")) return orders;
    return [];
  };

  return { db, orders, queries };
}

function invoke(body, db) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = "POST";
    req.headers = {};

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
      req.emit("data", Buffer.from(JSON.stringify(body)));
      req.emit("end");
    });
  });
}

test("guest and admin order authorization", async (t) => {
  process.env.ADMIN_PIN = "4827";

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
