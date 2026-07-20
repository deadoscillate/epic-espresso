import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { handle } from "../api/inventory.js";
import { PIN_RATE_LIMIT } from "../lib/server-security.js";

function fakeDb() {
  const items = [];
  const queries = [];
  const rateLimits = new Map();

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
    if (query.startsWith("INSERT INTO inventory")) {
      items.push({ id: items.length + 1, name: values[0], available: values[1], stock: values[2] });
      return [];
    }
    if (query.startsWith("SELECT id, name, available, stock")) return items;
    return [];
  };

  return { db, items, queries };
}

function invoke(body, db, { raw } = {}) {
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
      req.emit("data", Buffer.from(raw ?? JSON.stringify(body)));
      req.emit("end");
    });
  });
}

test("inventory writes are bounded and PIN protected", async (t) => {
  process.env.ADMIN_PIN = "4827";
  t.after(() => delete process.env.ADMIN_PIN);

  await t.test("accepts the shared 60-character item limit", async () => {
    const { db, items } = fakeDb();
    const name = "x".repeat(60);
    const result = await invoke({ action: "add", name, stock: 4, pin: "4827" }, db);

    assert.equal(result.status, 200);
    assert.equal(items[0].name, name);
  });

  await t.test("rate limits repeated bad PINs", async () => {
    const { db } = fakeDb();
    for (let attempt = 0; attempt < PIN_RATE_LIMIT.max; attempt++) {
      const result = await invoke({ action: "add", name: "Latte", pin: "wrong" }, db);
      assert.equal(result.status, 401);
    }
    const blocked = await invoke({ action: "add", name: "Latte", pin: "wrong" }, db);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, "rate_limited");
  });

  await t.test("rejects an oversized body before querying storage", async () => {
    const { db, queries } = fakeDb();
    const raw = JSON.stringify({ action: "add", name: "x".repeat(9000), pin: "4827" });
    const result = await invoke(null, db, { raw });

    assert.equal(result.status, 413);
    assert.equal(result.body.error, "body_too_large");
    assert.equal(queries.length, 0);
  });
});
