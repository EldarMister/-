import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("admin address search uses the protected server-side Yandex Geocoder API", async () => {
  const api = await readFile(new URL("../server/index.ts", import.meta.url), "utf8");
  const authMiddleware = api.indexOf('app.use("/api/admin", requireAdmin)');
  const endpoint = api.indexOf('app.get("/api/admin/geocode"');

  assert.ok(authMiddleware >= 0, "admin authentication middleware should exist");
  assert.ok(endpoint > authMiddleware, "the geocoding endpoint must be protected by admin authentication");
  assert.match(api, /app\.get\("\/api\/admin\/geocode", geocodeLimiter/);
  assert.match(api, /const geocodeLimiter = rateLimit\([\s\S]*limit:\s*80/);
  assert.match(api, /https:\/\/geocode-maps\.yandex\.ru\/v1\//);
  assert.match(api, /process\.env\.YANDEX_GEOCODER_API_KEY/);
  assert.match(api, /AbortSignal\.timeout\(yandexGeocoderTimeoutMs\)/);
  assert.match(api, /query\.length < 3 \|\| query\.length > 300/);
  assert.match(api, /geocodeWithYandex\(`\$\{longitude\},\$\{latitude\}`\)/);
  assert.match(api, /return \{ address, latitude, longitude \}/);
  assert.match(api, /referer: "https:\/\/daanasushi\.com\/"/);
  assert.match(api, /app\.post\("\/api\/admin\/yandex-map-link", geocodeLimiter/);
  assert.match(api, /resolveYandexMapLink\(rawUrl\)/);
  assert.doesNotMatch(api, /NEXT_PUBLIC_YANDEX_GEOCODER_API_KEY/);
});
