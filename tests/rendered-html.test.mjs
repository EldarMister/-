import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the catalog and brand metadata", async () => {
  const response = await render("/catalog/1");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>ДААНА СУШИ — меню<\/title>/i);
  assert.match(html, /Филадельфия/);
  assert.match(html, /Скидка последний час/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("onigiri category renders its promotion and active products", async () => {
  const response = await render("/catalog/2");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Онигири с креветкой/);
  assert.match(html, /Онигири с лососем/);
  assert.match(html, /Скидка последний час/);
});

test("promotion page renders flippable cards with their back-side copy", async () => {
  const response = await render("/promo");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /promotion-flip-card/);
  assert.match(html, /-15% имениннику/);
  assert.match(html, /Дарим именинникам скидку/);
  assert.match(html, /Скидка 20% действует в последний час/);
});

test("admin route renders its noindex dashboard shell", async () => {
  const response = await render("/admin");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Админка \| ДААНА СУШИ<\/title>/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /Управление «ДААНА СУШИ»/);
  assert.match(html, />Товары<\/button>/);
});

test("PostgreSQL schema covers catalog, orders and administration", async () => {
  const schema = await readFile(new URL("../server/schema.sql", import.meta.url), "utf8");
  for (const table of ["admin_users", "categories", "products", "pickup_locations", "promotions", "orders", "order_items", "site_settings", "app_migrations"]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, "i"));
  }
  assert.match(schema, /REFERENCES products/);
  assert.match(schema, /CHECK \(status IN/);
  assert.match(schema, /2026-08-17-enable-onigiri/);
});

test("production uses one public gateway and password-only admin login", async () => {
  const [launcher, adminPanel, api] = await Promise.all([
    readFile(new URL("../server/production.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/AdminPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(launcher, /path\.startsWith\("\/api\/"\)/);
  assert.match(launcher, /path\.startsWith\("\/uploads\/"\)/);
  assert.doesNotMatch(adminPanel, /type="email"|JSON\.stringify\(\{ email, password \}\)/);
  assert.match(adminPanel, /JSON\.stringify\(\{ password \}\)/);
  assert.match(api, /SELECT id, password_hash, name FROM admin_users ORDER BY id LIMIT 1/);
});
