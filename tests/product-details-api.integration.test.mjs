import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const controlUrl = process.env.PRODUCT_DETAILS_TEST_DATABASE_URL;
test("product details migrate once, fill only exact empty reference rows and preserve employee edits across restart", { skip: !controlUrl, timeout: 120000 }, async (context) => {
  const url = new URL(controlUrl);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /^\/(?:sushi|daana)_admin_test_[a-z0-9_]+$/);
  const name = `sushi_admin_test_product_details_${Date.now()}_${process.pid}`;
  const control = postgres(controlUrl, { max: 1, onnotice: () => {} });
  await control.unsafe(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const db = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const listener = createServer().listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}/api`;
  const password = "ProductDetailsLocalFixture2026!";
  let api; let logs = ""; let cookie = "";
  const stop = async () => { if (api && api.exitCode === null) { const exit = once(api, "exit"); api.kill("SIGTERM"); await exit; } };
  context.after(async () => { await stop(); await db.end({ timeout: 5 }); await control.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`); await control.end({ timeout: 5 }); });
  const start = async () => {
    api = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { cwd: fileURLToPath(new URL("..", import.meta.url)), windowsHide: true, env: { ...process.env, DATABASE_URL: url.toString(), ADMIN_PASSWORD: password, JWT_SECRET: "product-details-local-fixture-secret-32", NODE_ENV: "production", API_HOST: "127.0.0.1", PORT: String(port), CORS_ORIGIN: "", VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", NIKITA_OTP_API_KEY: "" } });
    api.stdout.on("data", chunk => { logs += chunk; }); api.stderr.on("data", chunk => { logs += chunk; });
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) { assert.equal(api.exitCode, null, logs); try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* Wait for migrations. */ } await new Promise(resolve => setTimeout(resolve, 80)); }
    assert.fail(logs);
  };
  const call = async (path, options = {}) => {
    const response = await fetch(base + path, { ...options, headers: { ...(cookie ? { cookie } : {}), ...(options.body ? { "content-type": "application/json" } : {}) } });
    const body = await response.json(); assert.equal(response.ok, true, JSON.stringify(body));
    if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0]; return body;
  };
  await start();
  const initial = (await call("/catalog")).products.find(row => row.id === 1);
  assert.equal(initial.ingredients, "Лосось, творожный сыр"); assert.equal(initial.weight, 30); assert.equal(initial.calories, 45);
  await stop();
  await db`UPDATE products SET ingredients='',weight=NULL WHERE id=1`;
  await db`UPDATE products SET ingredients='Авторский состав сотрудника',weight=44 WHERE id=2`;
  await db`UPDATE products SET name='Заменённый товар',ingredients='',weight=NULL WHERE id=3`;
  await db`DELETE FROM app_migrations WHERE key='2026-10-30-product-details'`;
  await start();
  const rows = (await call("/catalog")).products;
  assert.equal(rows.find(row => row.id === 1).ingredients, initial.ingredients);
  assert.equal(rows.find(row => row.id === 1).weight, 30);
  assert.equal(rows.find(row => row.id === 2).ingredients, "Авторский состав сотрудника"); assert.equal(rows.find(row => row.id === 2).weight, 44);
  assert.equal(rows.find(row => row.id === 3).ingredients, ""); assert.equal(rows.find(row => row.id === 3).weight, null);
  await call("/admin/login", { method: "POST", body: JSON.stringify({ password }) });
  await call("/admin/products/1", { method: "PUT", body: JSON.stringify({ ...initial, ingredients: "", weight: null }) });
  await stop(); await start();
  const final = (await call("/catalog")).products.find(row => row.id === 1);
  assert.equal(final.ingredients, ""); assert.equal(final.weight, null);
  assert.equal(final.price, initial.price); assert.equal(final.name, initial.name); assert.equal(final.image, initial.image);
});
