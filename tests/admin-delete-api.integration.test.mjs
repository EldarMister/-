import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import test from "node:test";
import postgres from "postgres";

const configuredDatabaseUrl = process.env.ADMIN_DELETE_TEST_DATABASE_URL;
const rootDirectory = fileURLToPath(new URL("..", import.meta.url));

test("product and pickup deletion survives API restart and seeding without losing orders", {
  skip: !configuredDatabaseUrl,
  timeout: 180_000,
}, async (context) => {
  const databaseUrl = new URL(configuredDatabaseUrl);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname), "use a local test PostgreSQL instance");
  assert.match(databaseUrl.pathname, /^\/sushi_admin_test_[a-z0-9_]+$/, "use a dedicated sushi_admin_test_ database");

  // Only this newly created database is modified; configured databases stay intact.
  const temporaryDatabase = `sushi_admin_test_delete_${Date.now()}_${process.pid}`;
  const controlSql = postgres(configuredDatabaseUrl, { max: 1, onnotice: () => undefined });
  await controlSql.unsafe(`CREATE DATABASE "${temporaryDatabase}"`);
  databaseUrl.pathname = `/${temporaryDatabase}`;
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const baseUrl = `http://127.0.0.1:${port}/api`;
  const password = "AdminDeleteTest123!";
  const environment = {
    ...process.env,
    DATABASE_URL: databaseUrl.toString(),
    ADMIN_PASSWORD: password,
    JWT_SECRET: "local-delete-integration-test-secret-2026",
    NODE_ENV: "production",
    API_HOST: "127.0.0.1",
    PORT: String(port),
    TRUST_PROXY: "loopback",
    CORS_ORIGIN: "",
    NIKITA_OTP_API_KEY: "",
    NFT_TRANSFER_WEBHOOK_URL: "",
    NFT_TRANSFER_WEBHOOK_TOKEN: "",
  };
  let api;
  let cookie = "";
  const stopApi = async () => {
    if (!api || api.exitCode !== null || api.signalCode !== null) return;
    const exited = once(api, "exit");
    api.kill("SIGTERM");
    await exited;
  };
  context.after(async () => {
    try {
      await stopApi();
      await controlSql.unsafe(`DROP DATABASE "${temporaryDatabase}" WITH (FORCE)`);
    } finally {
      await controlSql.end({ timeout: 5 });
    }
  });
  const startApi = async () => {
    api = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { cwd: rootDirectory, env: environment, windowsHide: true });
    let errors = "";
    api.stderr.on("data", (chunk) => { errors += chunk; });
    api.stdout.on("data", (chunk) => { errors += chunk; });
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      assert.equal(api.exitCode, null, `API exited before becoming ready: ${errors}`);
      try {
        if ((await fetch(`${baseUrl}/health`)).ok) return;
      } catch { /* Wait for schema migration and initial seeding. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail(`API did not become ready: ${errors}`);
  };
  const call = async (path, { expected = 200, ...options } = {}) => {
    const headers = new Headers(options.headers);
    // Match the production gateway's sanitized headers after TLS termination.
    if (!headers.has("origin")) headers.set("origin", "https://daanasushi.com");
    headers.set("x-forwarded-host", "daanasushi.com");
    headers.set("x-forwarded-proto", "https");
    if (cookie) headers.set("cookie", cookie);
    if (options.body) headers.set("content-type", "application/json");
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";", 1)[0];
    const body = await response.json().catch(() => ({}));
    assert.equal(response.status, expected, `${options.method || "GET"} ${path}: ${JSON.stringify(body)}`);
    return body;
  };
  await startApi();
  await call("/admin/login", { method: "POST", body: JSON.stringify({ password }) });
  await call("/admin/products/2147483647", { method: "DELETE", expected: 403, headers: { origin: "https://attacker.example" } });
  await call("/admin/locations/2147483647", { method: "DELETE", expected: 403, headers: { origin: "null" } });
  const category = (await call("/admin/categories"))[0];
  const retainedProduct = (await call("/catalog")).products[0];
  const productDraft = { categoryId: category.id, name: "Удаляемый товар", price: 180, image: "/assets/icons/logo.svg", active: true, sortOrder: 0, naktaCoins: 7 };
  const locationDraft = { name: "Удаляемая точка", address: "Тестовый адрес", phone: "+996555000000", hours: "10:00 - 21:00", opensAt: "10:00", latitude: 40.6, longitude: 72.9, active: true };
  const products = [];
  const locations = [];
  for (const active of [true, true, false]) {
    products.push(await call("/admin/products", { method: "POST", expected: 201, body: JSON.stringify({ ...productDraft, active }) }));
    locations.push(await call("/admin/locations", { method: "POST", expected: 201, body: JSON.stringify({ ...locationDraft, active }) }));
  }
  const orderDraft = { customerName: "Тест удаления", customerPhone: "996555000001", locationId: locations[1].id, items: [{ productId: products[1].id, quantity: 2 }] };
  const order = await call("/orders", { method: "POST", expected: 201, body: JSON.stringify(orderDraft) });
  await call("/orders", { method: "POST", expected: 409, body: JSON.stringify({ ...orderDraft, locationId: locations[2].id }) });
  for (const resource of ["products", "locations"]) {
    for (const item of resource === "products" ? products : locations) {
      await call(`/admin/${resource}/${item.id}`, { method: "DELETE", expected: 204 });
      await call(`/admin/${resource}/${item.id}`, { method: "DELETE", expected: 204 });
    }
    await call(`/admin/${resource}/2147483647`, { method: "DELETE", expected: 404 });
  }
  await call(`/admin/products/${products[1].id}`, { method: "PUT", expected: 404, body: JSON.stringify(productDraft) });
  await call(`/admin/locations/${locations[1].id}`, { method: "PUT", expected: 404, body: JSON.stringify(locationDraft) });
  await call("/orders", { method: "POST", expected: 409, body: JSON.stringify(orderDraft) });
  await call("/orders", { method: "POST", expected: 409, body: JSON.stringify({ ...orderDraft, items: [{ productId: retainedProduct.id, quantity: 1 }] }) });
  const savedOrder = (await call("/admin/orders")).find((entry) => entry.id === order.id);
  assert.ok(savedOrder, "old orders remain visible after product and location deletion");
  assert.equal(savedOrder.locationName, locationDraft.name);
  assert.equal(savedOrder.locationAddress, locationDraft.address);
  assert.equal(savedOrder.items[0].productName, productDraft.name);
  assert.equal(savedOrder.items[0].unitPrice, productDraft.price);
  assert.equal(savedOrder.items[0].quantity, 2);
  assert.equal(savedOrder.items[0].naktaCoinsReward, 14);
  const nextProduct = await call("/admin/products", { method: "POST", expected: 201, body: JSON.stringify(productDraft) });
  const nextLocation = await call("/admin/locations", { method: "POST", expected: 201, body: JSON.stringify(locationDraft) });
  assert.ok(nextProduct.id > products[2].id, "deleted product IDs must not be reused");
  assert.ok(nextLocation.id > locations[2].id, "deleted location IDs must not be reused");
  for (const resource of ["products", "locations"]) {
    for (const item of await call(`/admin/${resource}`)) {
      await call(`/admin/${resource}/${item.id}`, { method: "DELETE", expected: 204 });
    }
  }
  const assertEmptyCatalog = async () => {
    assert.deepEqual(await call("/admin/products"), []);
    assert.deepEqual(await call("/admin/locations"), []);
    assert.deepEqual((await call("/catalog")).products, []);
    assert.deepEqual(await call("/locations"), []);
    assert.equal((await call("/admin/dashboard")).products, 0);
    const oldOrder = (await call("/admin/orders")).find((entry) => entry.id === order.id);
    assert.ok(oldOrder, "order history survives restarts and seed runs");
    assert.equal(oldOrder.items[0].productName, productDraft.name);
  };
  await assertEmptyCatalog();
  await stopApi();
  await startApi();
  await assertEmptyCatalog();
  await stopApi();
  const seed = spawn(process.execPath, ["--import", "tsx", "server/seed.ts"], { cwd: rootDirectory, env: environment, windowsHide: true });
  let seedErrors = "";
  seed.stderr.on("data", (chunk) => { seedErrors += chunk; });
  seed.stdout.resume();
  const [seedExit] = await once(seed, "exit");
  assert.equal(seedExit, 0, `seed failed: ${seedErrors}`);
  await startApi();
  await assertEmptyCatalog();
});
