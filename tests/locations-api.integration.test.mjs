import assert from "node:assert/strict";
import test from "node:test";
import "dotenv/config";

const baseUrl = process.env.LOCATIONS_API_INTEGRATION_URL;

test("deleting pickup locations preserves orders and prevents further use", {
  skip: !baseUrl || !process.env.ADMIN_PASSWORD,
  timeout: 30_000,
}, async () => {
  let cookie = "";
  const call = async (path, { expected = 200, ...options } = {}) => {
    const headers = new Headers(options.headers);
    if (cookie) headers.set("cookie", cookie);
    if (options.body) headers.set("content-type", "application/json");
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";", 1)[0];
    const body = await response.json().catch(() => ({}));
    assert.equal(response.status, expected, `${options.method || "GET"} ${path}: ${JSON.stringify(body)}`);
    return body;
  };
  await call("/admin/login", { method: "POST", body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  const draft = {
    name: `Проверка удаления ${Date.now()}`, address: "Тестовый адрес", phone: "+996555000000",
    hours: "10:00 - 21:00", opensAt: "10:00", latitude: 40.6, longitude: 72.9, active: true,
  };
  const emptyLocation = await call("/admin/locations", { method: "POST", expected: 201, body: JSON.stringify(draft) });
  const location = await call("/admin/locations", { method: "POST", expected: 201, body: JSON.stringify({ ...draft, name: `${draft.name} с заказом` }) });
  const hiddenLocation = await call("/admin/locations", { method: "POST", expected: 201, body: JSON.stringify({ ...draft, active: false }) });
  const product = (await call("/admin/products")).find((item) => item.active);
  assert.ok(product);
  const orderBody = {
    customerName: "Тест удаления", customerPhone: "996555000000", locationId: location.id,
    items: [{ productId: product.id, quantity: 1 }],
  };
  const order = await call("/orders", { method: "POST", expected: 201, body: JSON.stringify(orderBody) });
  await call("/orders", { method: "POST", expected: 409, body: JSON.stringify({ ...orderBody, locationId: hiddenLocation.id }) });
  for (const entry of [emptyLocation, location, hiddenLocation]) {
    await call(`/admin/locations/${entry.id}`, { method: "DELETE", expected: 204 });
    await call(`/admin/locations/${entry.id}`, { method: "DELETE", expected: 204 });
  }
  for (const path of ["/locations", "/admin/locations"]) {
    const remaining = await call(path);
    assert.ok(remaining.every((entry) => ![emptyLocation.id, location.id, hiddenLocation.id].includes(entry.id)));
  }
  const savedOrder = (await call("/admin/orders")).find((entry) => entry.id === order.id);
  assert.ok(savedOrder, "the existing order must remain visible");
  assert.equal(savedOrder.locationName, location.name);
  assert.equal(savedOrder.locationAddress, location.address);
  await call("/orders", { method: "POST", expected: 409, body: JSON.stringify(orderBody) });
  await call(`/admin/locations/${location.id}`, { method: "PUT", expected: 404, body: JSON.stringify(draft) });
  const nextLocation = await call("/admin/locations", { method: "POST", expected: 201, body: JSON.stringify(draft) });
  assert.ok(nextLocation.id > hiddenLocation.id, "deleted location IDs must not be reused");
  await call(`/admin/locations/${nextLocation.id}`, { method: "DELETE", expected: 204 });
  await call("/admin/locations/2147483647", { method: "DELETE", expected: 404 });
});
