import assert from "node:assert/strict";
import test from "node:test";
import "dotenv/config";

const baseUrl = process.env.ADMIN_API_INTEGRATION_URL;
test("live admin events and category deletion preserve products and old orders", {
  skip: !baseUrl || !process.env.ADMIN_PASSWORD, timeout: 30_000,
}, async () => {
  let cookie = "";
  const call = async (path, { expected = 200, ...options } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options, headers: { ...(cookie ? { cookie } : {}), ...(options.body ? { "content-type": "application/json" } : {}) },
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";", 1)[0];
    const body = await response.json().catch(() => ({}));
    assert.equal(response.status, expected, `${options.method || "GET"} ${path}: ${JSON.stringify(body)}`);
    return body;
  };
  await call("/admin/events", { expected: 401 });
  await call("/admin/login", { method: "POST", body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  const controller = new AbortController();
  const stream = await fetch(`${baseUrl}/admin/events`, { headers: { cookie }, signal: controller.signal });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type"), /text\/event-stream/);
  const reader = stream.body.getReader();
  let buffer = "";
  const nextChange = async () => {
    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (event.includes("event: change")) return;
      } else {
        const chunk = await reader.read();
        assert.equal(chunk.done, false, "event stream must stay connected");
        buffer += new TextDecoder().decode(chunk.value);
      }
    }
  };
  try {
    await nextChange();
    const draft = { name: `Категория тест ${Date.now()}`, slug: `category-test-${Date.now()}`, sortOrder: 0, active: true };
    const category = await call("/admin/categories", { method: "POST", expected: 201, body: JSON.stringify(draft) });
    await nextChange();
    const productDraft = { name: "Товар тестовой категории", categoryId: category.id, price: 100, image: "/assets/icons/logo.svg", active: true, sortOrder: 0, naktaCoins: 0 };
    const product = await call("/admin/products", { method: "POST", expected: 201, body: JSON.stringify(productDraft) });
    const location = (await call("/locations"))[0];
    const orderBody = { customerName: "Тест категории", customerPhone: "996555000002", locationId: location.id, items: [{ productId: product.id, quantity: 1 }] };
    const order = await call("/orders", { method: "POST", expected: 201, body: JSON.stringify(orderBody) });
    await call(`/admin/categories/${category.id}`, { method: "DELETE", expected: 204 });
    await call(`/admin/categories/${category.id}`, { method: "DELETE", expected: 204 });
    assert.ok(!(await call("/admin/categories")).some((entry) => entry.id === category.id));
    const catalog = await call("/catalog");
    assert.ok(!catalog.categories.some((entry) => entry.id === category.id));
    assert.ok(!catalog.products.some((entry) => entry.id === product.id));
    assert.ok((await call("/admin/products")).some((entry) => entry.id === product.id));
    const savedOrder = (await call("/admin/orders")).find((entry) => entry.id === order.id);
    assert.ok(savedOrder);
    assert.equal(savedOrder.items[0].productName, product.name);
    await call("/orders", { method: "POST", expected: 409, body: JSON.stringify(orderBody) });
    await call(`/admin/categories/${category.id}`, { method: "PUT", expected: 404, body: JSON.stringify(draft) });
    await call("/admin/products", { method: "POST", expected: 409, body: JSON.stringify(productDraft) });
    await call(`/admin/products/${product.id}`, { method: "PUT", expected: 409, body: JSON.stringify(productDraft) });
    const replacement = await call("/admin/categories", { method: "POST", expected: 201, body: JSON.stringify(draft) });
    assert.ok(replacement.id > category.id);
    await call(`/admin/products/${product.id}`, { method: "PUT", body: JSON.stringify({ ...productDraft, categoryId: replacement.id }) });
    assert.ok((await call("/catalog")).products.some((entry) => entry.id === product.id));
    await call("/orders", { method: "POST", expected: 201, body: JSON.stringify(orderBody) });
    await call(`/admin/categories/${replacement.id}`, { method: "DELETE", expected: 204 });
    await call("/admin/categories/2147483647", { method: "DELETE", expected: 404 });
    await call("/admin/logout", { method: "POST" });
    await call("/admin/events", { expected: 401 });
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }
});
