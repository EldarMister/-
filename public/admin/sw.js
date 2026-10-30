/* Admin-only PWA: public static resources are cached; API, user data and
   personalized HTML always use the network. See tests/admin-pwa.test.mjs. */
const CACHE = "daana-admin-shell-v6";
const ASSETS = "daana-admin-assets-v6";
const ASSET_LIMIT = 60;
const ENTRY = "/admin/app";
const SHELL = [
  "/admin/offline.html",
  "/admin/icon-192.png",
  "/admin/icon-512.png",
  "/admin/icon-maskable.png",
];

function adminPath(path) {
  return path === "/admin" || path.startsWith("/admin/");
}
function orderId(value) {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || !/^[1-9]\d*$/.test(value))
  )
    return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}
function safeAsset(path) {
  if (path === "/admin/fonts/inter-latin-cyrillic.woff2") return true;
  if (path === "/assets/icons/logo.svg") return true;
  if (/^\/assets\/fonts\/[^/]+\.(?:woff2?|ttf|otf)$/.test(path)) return true;
  return (
    /^\/_next\/static\/(?:[^/]+\/)*[^/]+\.(?:js|css)$/.test(path) &&
    /(?:[-.][A-Za-z0-9_-]{8,}|\/[a-f\d]{8,})\.(?:js|css)$/.test(path)
  );
}
function cacheable(response, path) {
  if (
    !response ||
    response.status !== 200 ||
    response.type === "opaque" ||
    response.redirected
  )
    return false;
  if (/private|no-store/i.test(response.headers.get("Cache-Control") || ""))
    return false;
  if (/cookie|authorization/i.test(response.headers.get("Vary") || ""))
    return false;
  if (response.headers.has("Set-Cookie")) return false;
  const type = (response.headers.get("Content-Type") || "").toLowerCase();
  if (path === "/admin/offline.html") return type.startsWith("text/html");
  if (path.endsWith(".png")) return type.startsWith("image/png");
  if (path.endsWith(".svg")) return type.startsWith("image/svg+xml");
  if (path.endsWith(".css")) return type.startsWith("text/css");
  if (path.endsWith(".js"))
    return /^(?:application|text)\/(?:javascript|ecmascript)/.test(type);
  return /^(?:font\/|application\/(?:font-|x-font-|octet-stream))/.test(type);
}
async function remember(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  if (cacheName === ASSETS) {
    const keys = await cache.keys();
    await Promise.all(
      keys
        .slice(0, Math.max(0, keys.length - ASSET_LIMIT))
        .map((key) => cache.delete(key)),
    );
  }
}
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      await Promise.all(
        SHELL.map(async (path) => {
          const response = await fetch(path, {
            cache: "reload",
            credentials: "omit",
          });
          if (!cacheable(response, path))
            throw new Error("Public admin shell unavailable");
          await remember(CACHE, path, response);
        }),
      );
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (
          (key.startsWith("daana-admin-shell-") ||
            key.startsWith("daana-admin-assets-")) &&
          key !== CACHE &&
          key !== ASSETS
        )
          await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  ),
);
// An update waits for the explicit action in the admin UI.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING")
    event.waitUntil(Promise.resolve(self.skipWaiting()));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin)
    return;
  if (SHELL.includes(url.pathname) && !url.search) {
    event.respondWith(
      caches.match(event.request).then((hit) => hit || fetch(event.request)),
    );
    return;
  }
  if (event.request.mode === "navigate" && adminPath(url.pathname)) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(() =>
        caches.match("/admin/offline.html"),
      ),
    );
    return;
  }
  if (
    url.search ||
    !safeAsset(url.pathname) ||
    event.request.headers.has("Authorization")
  )
    return;
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (cacheable(response, url.pathname))
        await remember(ASSETS, event.request, response);
      return response;
    })(),
  );
});
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    const candidate = event.data?.json();
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate))
      payload = candidate;
  } catch {
    /* Show only the generic text below. */
  }
  const id = orderId(payload.orderId);
  const copy = {
    ru: ["Новый заказ", "Откройте панель, чтобы посмотреть заказ."],
    ky: ["Жаңы буйрутма", "Буйрутманы көрүү үчүн башкаруу панелин ачыңыз."],
    en: ["New order", "Open the dashboard to view the order."],
    kk: ["Жаңа тапсырыс", "Тапсырысты көру үшін басқару панелін ашыңыз."],
    uz: [
      "Yangi buyurtma",
      "Buyurtmani ko‘rish uchun boshqaruv panelini oching.",
    ],
  };
  const text = Object.hasOwn(copy, payload.locale)
    ? copy[payload.locale]
    : copy.ru;
  event.waitUntil(
    self.registration.showNotification(`ДААНА СУШИ · ${text[0]}`, {
      body: text[1],
      icon: "/admin/icon-192.png",
      badge: "/admin/icon-192.png",
      tag: id ? `order:${id}` : "daana-new-order",
      data: { url: id ? `${ENTRY}?order=${id}` : ENTRY },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let supplied;
  try {
    supplied = new URL(
      event.notification.data?.url || ENTRY,
      self.location.origin,
    );
  } catch {
    return;
  }
  if (supplied.origin !== self.location.origin || !adminPath(supplied.pathname))
    return;
  const id = orderId(supplied.searchParams.get("order"));
  const url = new URL(
    id ? `${ENTRY}?order=${id}` : ENTRY,
    self.location.origin,
  );
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const client = windows.find((item) => {
        try {
          const current = new URL(item.url);
          return (
            current.origin === self.location.origin &&
            adminPath(current.pathname)
          );
        } catch {
          return false;
        }
      });
      if (client) {
        try {
          const navigated = await client.navigate(url.href);
          if (navigated) return navigated.focus();
        } catch {
          /* Open the scoped entry if an old window cannot navigate. */
        }
      }
      return self.clients.openWindow(url.href);
    })(),
  );
});
