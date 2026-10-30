import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const origin = "https://daana.example";
const workerSource = await readFile(
  new URL("../public/admin/sw.js", import.meta.url),
  "utf8",
);

function harness() {
  const handlers = new Map();
  const storage = new Map();
  const state = {
    fetches: [],
    notifications: [],
    opened: [],
    deletedCaches: [],
    skipped: 0,
    claimed: 0,
    windows: [],
    fetchImpl: null,
  };
  const key = (request) =>
    new URL(typeof request === "string" ? request : request.url, origin).href;
  const getCache = (name) => {
    if (!storage.has(name)) storage.set(name, new Map());
    const values = storage.get(name);
    return {
      async put(request, response) {
        values.set(key(request), response.clone());
      },
      async match(request) {
        return values.get(key(request))?.clone();
      },
      async keys() {
        return [...values.keys()].map((url) => new Request(url));
      },
      async delete(request) {
        return values.delete(key(request));
      },
    };
  };
  const caches = {
    async open(name) {
      return getCache(name);
    },
    async keys() {
      return [...storage.keys()];
    },
    async delete(name) {
      state.deletedCaches.push(name);
      return storage.delete(name);
    },
    async match(request) {
      for (const values of storage.values()) {
        const response = values.get(key(request));
        if (response) return response.clone();
      }
    },
  };
  const contentType = (path) =>
    path.endsWith(".html")
      ? "text/html"
      : path.endsWith(".png")
        ? "image/png"
        : path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".js")
            ? "application/javascript"
            : path.endsWith(".svg")
              ? "image/svg+xml"
              : "font/woff2";
  const fetch = async (request, options) => {
    const url = key(request);
    state.fetches.push({ url, options });
    if (state.fetchImpl) return state.fetchImpl(request, options);
    return new Response(`public:${new URL(url).pathname}`, {
      status: 200,
      headers: {
        "Content-Type": contentType(new URL(url).pathname),
        "Cache-Control": "public,max-age=86400",
      },
    });
  };
  const self = {
    location: { origin, href: `${origin}/admin/sw.js` },
    addEventListener(name, handler) {
      handlers.set(name, handler);
    },
    skipWaiting() {
      state.skipped++;
      return Promise.resolve();
    },
    registration: {
      async showNotification(title, options) {
        state.notifications.push({
          title,
          options: JSON.parse(JSON.stringify(options)),
        });
      },
    },
    clients: {
      async claim() {
        state.claimed++;
      },
      async matchAll() {
        return state.windows;
      },
      async openWindow(url) {
        state.opened.push(url);
      },
    },
  };
  vm.runInNewContext(
    workerSource,
    { self, caches, fetch, URL, Request, Response, Headers, console },
    { filename: "public/admin/sw.js" },
  );
  const dispatch = async (name, properties = {}) => {
    const waits = [];
    let response;
    const event = {
      ...properties,
      waitUntil(promise) {
        waits.push(Promise.resolve(promise));
      },
      respondWith(promise) {
        response = Promise.resolve(promise);
      },
    };
    handlers.get(name)?.(event);
    const result = response ? await response : undefined;
    await Promise.all(waits);
    return { intercepted: Boolean(response), response: result };
  };
  const request = (path, { method = "GET", mode = "cors", headers } = {}) => ({
    url: new URL(path, origin).href,
    method,
    mode,
    headers: new Headers(headers),
  });
  const cachedUrls = () =>
    [...storage.values()].flatMap((values) => [...values.keys()]);
  return { state, storage, caches, dispatch, request, cachedUrls };
}

test("admin manifest has a scoped installed entry and valid standalone icons", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../public/admin/manifest.webmanifest", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(manifest.scope, "/admin/");
  assert.equal(manifest.start_url, "/admin/app");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.name.includes("ДААНА"));
  assert.ok(
    new URL(manifest.start_url, origin).pathname.startsWith(
      new URL(manifest.scope, origin).pathname,
    ),
  );
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(
      (value) => value.sizes === `${size}x${size}` && value.purpose === "any",
    );
    assert.ok(icon);
    const bytes = await readFile(
      new URL(`../public${icon.src}`, import.meta.url),
    );
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
  const maskable = manifest.icons.find((value) => value.purpose === "maskable");
  assert.ok(maskable);
  assert.equal(maskable.sizes, "512x512");
  const bytes = await readFile(
    new URL(`../public${maskable.src}`, import.meta.url),
  );
  assert.equal(bytes.readUInt32BE(16), 512);
  assert.equal(bytes.readUInt32BE(20), 512);
});

test("install stores only the public offline shell without credentials or automatic activation", async () => {
  const worker = harness();
  await worker.dispatch("install");
  const cached = worker
    .cachedUrls()
    .map((url) => new URL(url).pathname)
    .sort();
  assert.deepEqual(cached, [
    "/admin/icon-192.png",
    "/admin/icon-512.png",
    "/admin/icon-maskable.png",
    "/admin/offline.html",
  ]);
  assert.ok(
    worker.state.fetches.every(({ options }) => options.credentials === "omit"),
  );
  assert.equal(worker.state.skipped, 0);
  assert.ok(
    !cached.some((path) => path.includes("api") || path === "/admin/app"),
  );
});

test("activation removes only obsolete admin caches and preserves storefront caches", async () => {
  const worker = harness();
  await worker.caches.open("customer-storefront-v1");
  await worker.caches.open("another-application");
  await worker.caches.open("daana-admin-shell-obsolete");
  await worker.caches.open("daana-admin-assets-obsolete");
  await worker.dispatch("install");
  await worker.dispatch("activate");
  assert.ok(worker.storage.has("customer-storefront-v1"));
  assert.ok(worker.storage.has("another-application"));
  assert.ok(!worker.storage.has("daana-admin-shell-obsolete"));
  assert.ok(!worker.storage.has("daana-admin-assets-obsolete"));
  assert.equal(worker.state.claimed, 1);
  assert.equal(worker.state.skipped, 0);
});

test("authorized API, uploads, mutations, arbitrary images and storefront navigation bypass caches", async () => {
  const worker = harness();
  for (const [path, options] of [
    [
      "/api/admin/orders",
      { headers: { Authorization: "Bearer private-token" } },
    ],
    ["/api/admin/analytics/export", {}],
    ["/api/auth/profile", {}],
    ["/uploads/customer-receipt.png", {}],
    ["/admin/customer.json", {}],
    ["/assets/customer-photo.png", {}],
    ["/catalog/1", { mode: "navigate" }],
    ["/administrator", { mode: "navigate" }],
    ["/api/admin/orders/1/status", { method: "POST" }],
    ["https://other.example/_next/static/chunks/page-12345678.js", {}],
    [
      "/_next/static/chunks/page-12345678.js",
      { headers: { Authorization: "Bearer private-token" } },
    ],
  ]) {
    const result = await worker.dispatch("fetch", {
      request: worker.request(path, options),
    });
    assert.equal(result.intercepted, false, path);
  }
  assert.deepEqual(worker.cachedUrls(), []);
});

test("admin navigation uses fresh network HTML and a public offline page only on network failure", async () => {
  const worker = harness();
  await worker.dispatch("install");
  worker.state.fetchImpl = async () =>
    new Response("private HTML for current employee", {
      headers: {
        "Content-Type": "text/html",
        "Cache-Control": "private,no-store",
      },
    });
  const online = await worker.dispatch("fetch", {
    request: worker.request("/admin/app?section=orders", { mode: "navigate" }),
  });
  assert.equal(
    await online.response.text(),
    "private HTML for current employee",
  );
  assert.equal(worker.state.fetches.at(-1).options.cache, "no-store");
  assert.ok(
    !worker
      .cachedUrls()
      .some(
        (url) => url.includes("section=orders") || url.endsWith("/admin/app"),
      ),
  );
  worker.state.fetchImpl = async () => {
    throw new TypeError("Network unavailable");
  };
  const offline = await worker.dispatch("fetch", {
    request: worker.request("/admin/app?order=42", { mode: "navigate" }),
  });
  assert.equal(await offline.response.text(), "public:/admin/offline.html");
});

test("hashed scripts, styles, project fonts and logo cache successful public responses with a bounded size", async () => {
  const worker = harness();
  for (const path of [
    "/_next/static/chunks/page-12345678.js",
    "/_next/static/css/0123456789abcdef.css",
    "/assets/fonts/project.woff2",
    "/assets/icons/logo.svg",
  ]) {
    const first = await worker.dispatch("fetch", {
      request: worker.request(path),
    });
    assert.equal(first.intercepted, true);
    assert.equal(first.response.status, 200);
    const count = worker.state.fetches.length;
    const second = await worker.dispatch("fetch", {
      request: worker.request(path),
    });
    assert.equal(second.response.status, 200);
    assert.equal(worker.state.fetches.length, count, `cached ${path}`);
  }
  for (let index = 0; index < 70; index++) {
    await worker.dispatch("fetch", {
      request: worker.request(
        `/_next/static/chunks/page-${String(index).padStart(8, "0")}.js`,
      ),
    });
  }
  const assetCache = [...worker.storage].find(([name]) =>
    name.startsWith("daana-admin-assets-"),
  );
  assert.ok(assetCache);
  assert.ok(assetCache[1].size <= 60);
  assert.ok(assetCache[1].size > 0);
});

test("private, erroneous or HTML responses never enter the static asset cache", async () => {
  const worker = harness();
  const responses = [
    new Response("private", {
      headers: {
        "Content-Type": "application/javascript",
        "Cache-Control": "private,max-age=60",
      },
    }),
    new Response("secret", {
      headers: {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-store",
      },
    }),
    new Response("private variant", {
      headers: { "Content-Type": "application/javascript", Vary: "Cookie" },
    }),
    new Response("sets session", {
      headers: {
        "Content-Type": "application/javascript",
        "Set-Cookie": "private=yes",
      },
    }),
    new Response("login HTML", { headers: { "Content-Type": "text/html" } }),
    new Response("not found", {
      status: 404,
      headers: { "Content-Type": "application/javascript" },
    }),
    Response.redirect(`${origin}/admin/login`),
  ];
  for (let index = 0; index < responses.length; index++) {
    worker.state.fetchImpl = async () => responses[index].clone();
    await worker.dispatch("fetch", {
      request: worker.request(
        `/_next/static/chunks/private-${String(index).padStart(8, "0")}.js`,
      ),
    });
  }
  assert.deepEqual(worker.cachedUrls(), []);
});

test("an update activates only in response to the explicit UI message", async () => {
  const worker = harness();
  await worker.dispatch("install");
  await worker.dispatch("activate");
  await worker.dispatch("message", { data: { type: "other" } });
  assert.equal(worker.state.skipped, 0);
  await worker.dispatch("message", { data: { type: "SKIP_WAITING" } });
  assert.equal(worker.state.skipped, 1);
});

test("push notifications contain generic text and a canonical order identifier without customer data", async () => {
  const worker = harness();
  await worker.dispatch("push", {
    data: {
      json: () => ({
        orderId: 42,
        eventId: "customer-secret@example.com",
        customerName: "Private Customer",
        customerPhone: "+996555123456",
        address: "Private Street",
        total: 98999,
        url: "https://evil.example",
      }),
    },
  });
  const shown = worker.state.notifications[0];
  assert.equal(shown.options.tag, "order:42");
  assert.equal(shown.options.data.url, "/admin/app?order=42");
  const serialized = JSON.stringify(shown);
  for (const secret of [
    "customer-secret",
    "Private Customer",
    "+996555123456",
    "Private Street",
    "98999",
    "evil.example",
  ])
    assert.ok(!serialized.includes(secret), secret);
});

test("background notifications use the saved device language without copying customer data", async () => {
  const worker = harness();
  for (const locale of ["ky", "en", "kk", "uz"]) {
    await worker.dispatch("push", {
      data: {
        json: () => ({ orderId: 42, locale, customerName: "Private Customer" }),
      },
    });
  }
  assert.match(worker.state.notifications[1].title, /New order/);
  assert.match(worker.state.notifications[0].title, /Жаңы буйрутма/);
  assert.match(worker.state.notifications[2].title, /Жаңа тапсырыс/);
  assert.match(worker.state.notifications[3].title, /Yangi buyurtma/);
  assert.ok(
    !JSON.stringify(worker.state.notifications).includes("Private Customer"),
  );
});

test("malformed pushes safely fall back to the generic scoped entry", async () => {
  const worker = harness();
  const malformed = [
    null,
    [],
    "customer-secret",
    { orderId: true },
    { orderId: "1e3" },
    { orderId: -1 },
    { orderId: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const payload of malformed)
    await worker.dispatch("push", { data: { json: () => payload } });
  await worker.dispatch("push", {
    data: {
      json: () => {
        throw new SyntaxError("bad JSON");
      },
    },
  });
  await worker.dispatch("push");
  assert.equal(worker.state.notifications.length, malformed.length + 2);
  for (const { options } of worker.state.notifications) {
    assert.equal(options.tag, "daana-new-order");
    assert.equal(options.data.url, "/admin/app");
  }
});

test("notification clicks reject external, misleading admin prefixes and malformed URLs", async () => {
  const worker = harness();
  let closed = 0;
  for (const url of [
    "https://evil.example/admin/app?order=1",
    "/administrator?order=1",
    "/admin-fake?order=1",
    "javascript:alert(1)",
    "http://[",
    "/admin/../catalog/1",
  ]) {
    await worker.dispatch("notificationclick", {
      notification: {
        data: { url },
        close() {
          closed++;
        },
      },
    });
  }
  assert.equal(closed, 6);
  assert.deepEqual(worker.state.opened, []);
});

test("notification clicks reuse only same-origin admin windows and strip unrelated query data", async () => {
  const worker = harness();
  const navigated = [];
  let focused = 0;
  const client = {
    url: `${origin}/admin/app?section=profile`,
    async navigate(url) {
      navigated.push(url);
      return this;
    },
    async focus() {
      focused++;
    },
  };
  worker.state.windows = [
    {
      url: "https://evil.example/admin/app",
      async navigate() {
        assert.fail("external client used");
      },
    },
    {
      url: `${origin}/administrator`,
      async navigate() {
        assert.fail("unrelated client used");
      },
    },
    client,
  ];
  await worker.dispatch("notificationclick", {
    notification: {
      data: { url: "/admin/?order=42&customerPhone=private" },
      close() {},
    },
  });
  assert.deepEqual(navigated, [`${origin}/admin/app?order=42`]);
  assert.equal(focused, 1);
  assert.deepEqual(worker.state.opened, []);
  worker.state.windows = [];
  await worker.dispatch("notificationclick", {
    notification: { data: { url: "/admin/app?order=17" }, close() {} },
  });
  assert.deepEqual(worker.state.opened, [`${origin}/admin/app?order=17`]);
});
