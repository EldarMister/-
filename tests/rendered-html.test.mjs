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
  assert.match(html, /<title>Роллы — заказать онлайн \| ДААНА СУШИ<\/title>/i);
  assert.match(html, /<meta name="description" content="[^"]*роллы[^"]*самовывоз/i);
  assert.match(html, /<link rel="canonical" href="https:\/\/daanasushi\.com\/catalog\/1"/i);
  assert.match(html, /property="og:image" content="https:\/\/daanasushi\.com\/og\.png"/i);
  assert.match(html, /"@type":"WebSite"/);
  assert.match(html, /"@type":"Organization"/);
  assert.match(html, /Филадельфия/);
  assert.match(html, /Скидка последний час/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("publishes crawl controls, sitemap and web manifest", async () => {
  const [robotsResponse, sitemapResponse, manifestResponse, socialImage] = await Promise.all([
    render("/robots.txt"),
    render("/sitemap.xml"),
    render("/manifest.webmanifest"),
    readFile(new URL("../public/og.png", import.meta.url)),
  ]);

  assert.equal(robotsResponse.status, 200);
  const robots = await robotsResponse.text();
  assert.match(robots, /User-Agent:\s*\*/i);
  assert.match(robots, /Allow:\s*\//i);
  assert.match(robots, /Disallow:\s*\/api\//i);
  assert.match(robots, /Sitemap:\s*https:\/\/daanasushi\.com\/sitemap\.xml/i);

  assert.equal(sitemapResponse.status, 200);
  const sitemap = await sitemapResponse.text();
  assert.match(sitemap, /https:\/\/daanasushi\.com\/catalog\/1/);
  assert.match(sitemap, /https:\/\/daanasushi\.com\/promo/);
  assert.match(sitemap, /https:\/\/daanasushi\.com\/legal/);
  assert.match(sitemap, /https:\/\/daanasushi\.com\/privacy/);
  assert.match(sitemap, /https:\/\/daanasushi\.com\/terms/);
  assert.match(sitemap, /https:\/\/daanasushi\.com\/delete-account/);
  assert.match(sitemap, /https:\/\/daanasushi\.com\/support/);
  assert.doesNotMatch(sitemap, /\/admin|\/order|\/api/);

  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.text();
  assert.match(manifest, /ДААНА СУШИ/);
  assert.match(manifest, /\/catalog\/1/);

  assert.deepEqual([...socialImage.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(socialImage.byteLength > 10_000);
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

test("legal details render on public pages", async () => {
  const [catalogResponse, paymentResponse, privacyResponse] = await Promise.all([
    render("/catalog/1"),
    render("/payment-rule"),
    render("/privacy"),
  ]);
  const [catalog, payment, privacy] = await Promise.all([
    catalogResponse.text(),
    paymentResponse.text(),
    privacyResponse.text(),
  ]);
  for (const html of [catalog, payment, privacy]) {
    assert.match(html, /ИП Мусаев Жаныбек Кочкорбаевич/);
    assert.match(html, /22309199201100/);
    assert.match(html, /032-2026-169-3446/);
    assert.match(html, /Ошская область, Кара-Суйский район, с\. Отуз-Адыр/);
  }
  assert.doesNotMatch(`${payment}\n${privacy}`, /Багаутдинова|381455453478|317385000009123/);
});

test("publishes accurate legal, privacy and loyalty documents", async () => {
  for (const [path, heading] of [
    ["/legal", "Правовая информация"],
    ["/privacy", "Политика конфиденциальности"],
    ["/terms", "Условия использования и заказа"],
    ["/payment-rule", "Оплата, отмена и возврат"],
    ["/delete-account", "Удаление аккаунта и данных"],
    ["/support", "Поддержка"],
  ]) {
    const response = await render(path);
    assert.equal(response.status, 200);
    assert.match(await response.text(), new RegExp(`<h1[^>]*>${heading}</h1>`, "i"));
  }

  const [payment, privacy, terms] = await Promise.all([
    render("/payment-rule").then((response) => response.text()),
    render("/privacy").then((response) => response.text()),
    render("/terms").then((response) => response.text()),
  ]);
  assert.doesNotMatch(payment, /Юcassa|ЮKassa|Введите данные своей карты/i);
  assert.match(payment, /Оплата на сайте не проводится/i);
  assert.match(privacy, /Nikita/);
  assert.match(privacy, /адрес криптокошелька/i);
  assert.match(terms, /NAKTA Coin/);
  assert.match(terms, /Блокчейн-транзакции необратимы/i);
});

test("customer login uses Nikita OTP without exposing its API key", async () => {
  const [api, provider, storefront, account, envExample] = await Promise.all([
    readFile(new URL("../server/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/nikita-otp.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/SushiApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/CustomerAccountModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(provider, /https:\/\/smspro\.nikita\.kg\/api\/otp\/send/);
  assert.match(provider, /https:\/\/smspro\.nikita\.kg\/api\/otp\/verify/);
  assert.match(provider, /"X-API-KEY": apiKey/);
  assert.match(api, /process\.env\.NIKITA_OTP_API_KEY/);
  assert.match(api, /verificationChallenges\.set/);
  assert.match(api, /maxVerificationAttempts = 5/);
  assert.match(account, /SMS с одноразовым кодом/);
  assert.doesNotMatch(`${storefront}\n${account}`, /X-API-KEY|NIKITA_OTP_API_KEY/);
  assert.match(envExample, /^NIKITA_OTP_API_KEY=$/m);
  assert.match(envExample, /^OTP_BYPASS_PHONE=$/m);
});

test("order implements the scrollable pickup time dialog", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../app/SushiApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(app, /aria-haspopup="dialog"/);
  assert.match(app, /Время самовывоза/);
  assert.match(app, /extendedSlots: allSlots\.slice\(4\)/);
  assert.match(app, /setTimePickerOpen\(false\)/);
  assert.match(styles, /\.pickup-time-panel[^}]*overflow-y:\s*auto/);
  assert.match(styles, /\.pickup-time-grid[^}]*grid-template-columns:\s*repeat\(2/);
});

test("admin route renders its noindex, session-gated dashboard shell", async () => {
  const [response, adminSource] = await Promise.all([
    render("/admin"),
    readFile(new URL("../app/admin/AdminPanel.tsx", import.meta.url), "utf8"),
  ]);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Админка \| ДААНА СУШИ<\/title>/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /Проверяем сессию/);
  assert.match(adminSource, /Управление «ДААНА СУШИ»/);
  assert.match(adminSource, /\["loyalty", "Лояльность"\]/);
  assert.match(adminSource, /\/admin\/session/);
  assert.match(adminSource, /credentials: "include"/);
  assert.doesNotMatch(adminSource, /localStorage\.setItem\("sushi-admin-token"/);
});

test("pickup locations use Yandex Maps with address editing in the admin dashboard", async () => {
  const [storefront, map, locations, locationsAdmin, api, schema, styles, envExample] = await Promise.all([
    readFile(new URL("../app/SushiApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/PickupMap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/LocationsSection.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(storefront, /<PickupMap/);
  assert.match(storefront, /<MaterialIcon>location_on<\/MaterialIcon>/);
  assert.doesNotMatch(storefront, /max\.ru|Max_Messenger/);
  assert.doesNotMatch(storefront, /Отдел контроля качества|Контроль качества|qualityControl/);
  assert.doesNotMatch(storefront, /yandex\.ru\/map-widget|items\.slice\(0,\s*3\)|map-marker marker-/);
  assert.doesNotMatch(map, /openstreetmap|leaflet/i);
  assert.match(map, /api-maps\.yandex\.ru\/v3/);
  assert.match(map, /\[72\.966095, 40\.606046\]/);
  assert.match(map, /Кыргызстан, город или село, улица, дом/);
  assert.match(map, /new maps\.YMap/);
  assert.match(map, /new currentMaps\.YMapMarker/);
  assert.match(map, /new maps\.YMapListener/);
  assert.doesNotMatch(map, /maps\.geocode|SuggestView/);
  assert.doesNotMatch(map, /<form[^>]*pickup-map-address-search/);
  assert.match(map, /https:\/\/yandex\.ru\/maps/);
  assert.match(map, /draggable:\s*true/);
  assert.match(map, /navigator\.geolocation/);
  assert.match(map, /const SELECTED_LOCATION_ZOOM = 15/);
  assert.match(map, /const SELECTED_LOCATION_TRANSITION_MS = 450/);
  assert.match(map, /selectedFocusKeyRef/);
  assert.match(map, /Math\.max\(currentZoomRef\.current, SELECTED_LOCATION_ZOOM\)/);
  assert.match(map, /setLocation\(\{ center, zoom, duration, easing: "ease-in-out" \}\)/);
  assert.match(map, /Введите адрес, нажмите на карту или перетащите красную метку/);
  assert.match(locations, /ДААНА СУШИ — Отуз-Адыр/);
  assert.match(locations, /Ошская область, Кара-Суйский район/);
  assert.doesNotMatch(locations, /Иркутск|Модный Квартал|ЯркоМолл|Байкальская/);
  assert.match(locationsAdmin, /editablePosition=\{position\}/);
  assert.match(locationsAdmin, /editableAddress=\{editing\.address\}/);
  assert.match(locationsAdmin, /onLocationResolved=\{applyResolvedLocation\}/);
  assert.match(locationsAdmin, /onAddressSearch=\{searchAddress\}/);
  assert.match(locationsAdmin, /onAddressResolve=\{resolveAddress\}/);
  assert.match(locationsAdmin, /addressConfirmed/);
  assert.match(locationsAdmin, /method:\s*editing\.id \? "PUT" : "POST"/);
  assert.match(api, /function locationCoordinates/);
  assert.match(api, /app\.get\("\/api\/admin\/geocode"/);
  assert.match(schema, /2026-09-03-kyrgyz-pickup-map/);
  assert.match(styles, /\.pickup-map-canvas/);
  assert.match(styles, /\.location-top-row[^}]*z-index:\s*800/);
  assert.match(styles, /\.location-options[^}]*z-index:\s*910/);
  assert.match(styles, /\.pickup-map-controls/);
  assert.match(envExample, /NEXT_PUBLIC_YANDEX_MAPS_API_KEY=/);
  assert.match(envExample, /YANDEX_GEOCODER_API_KEY=/);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_YANDEX_GEOCODER_API_KEY=/);
});

test("PostgreSQL schema covers catalog, orders and administration", async () => {
  const schema = await readFile(new URL("../server/schema.sql", import.meta.url), "utf8");
  for (const table of ["admin_users", "categories", "products", "pickup_locations", "promotions", "orders", "order_items", "site_settings", "app_migrations"]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, "i"));
  }
  assert.match(schema, /REFERENCES products/);
  assert.match(schema, /CHECK \(status IN/);
  assert.match(schema, /2026-08-17-enable-onigiri/);
  assert.match(schema, /2026-08-31-kyrgyz-phone-prefix/);
  assert.match(schema, /2026-09-02-legal-operator/);
  assert.match(schema, /2026-09-03-kyrgyz-pickup-map/);
  assert.match(schema, /2026-09-03-remove-quality-control/);
});

test("production uses one public gateway and password-only admin login", async () => {
  const [launcher, adminPanel, api, storefront] = await Promise.all([
    readFile(new URL("../server/production.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/AdminPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/SushiApp.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(launcher, /path\.startsWith\("\/api\/"\)/);
  assert.doesNotMatch(adminPanel, /Отдел контроля качества|Подпись контроля качества|qualityControl/);
  assert.match(launcher, /path\.startsWith\("\/uploads\/"\)/);
  assert.doesNotMatch(adminPanel, /type="email"|JSON\.stringify\(\{ email, password \}\)/);
  assert.match(adminPanel, /JSON\.stringify\(\{ password \}\)/);
  assert.match(adminPanel, />Подробнее</);
  assert.match(adminPanel, /Отменить заказ/);
  assert.match(adminPanel, /updateStatus\(order, "cancelled"\)/);
  assert.match(api, /SELECT id, password_hash, name FROM admin_users ORDER BY id LIMIT 1/);
  assert.match(api, /l\.address AS "locationAddress"/);
  assert.doesNotMatch(`${storefront}\n${adminPanel}`, /₽/);
  assert.match(storefront, /\{product\.price\} С/);
  assert.match(storefront, /KYRGYZ_PHONE_PREFIX = "\+996"/);
  assert.match(storefront, /phone\.length !== 9/);
  assert.match(api, /kyrgyzPhonePattern = \/\^996\\d\{9\}\$\//);
});
