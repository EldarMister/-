import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import cors from "cors";
import express, { type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import { seed } from "./seed";
import { syncAdminPassword } from "./admin-account";
import { createAdminToken, requireAdmin } from "./auth";
import { closeDatabase, sql } from "./db";
import { migrate } from "./migrate";
import { NikitaOtpError, sendNikitaOtp, verifyNikitaOtp } from "./nikita-otp";
import { resolveYandexMapLink, YandexMapLinkError } from "./yandex-map-link";

const app = express();
const port = Number(process.env.PORT || 4000);
const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const uploadsDirectory = join(rootDirectory, "public", "uploads");
await mkdir(uploadsDirectory, { recursive: true });

app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: (process.env.CORS_ORIGIN || "http://localhost:3000").split(","), credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(uploadsDirectory, { maxAge: "7d", immutable: false }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });
const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => response.status(429).json({ error: "Слишком много запросов кода. Попробуйте позже" }),
});
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => response.status(429).json({ error: "Слишком много попыток. Попробуйте позже" }),
});
const orderLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 25, standardHeaders: true, legacyHeaders: false });
const geocodeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 80,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => response.status(429).json({ error: "Слишком много запросов к поиску адреса. Подождите несколько минут" }),
});
const validStatuses = new Set(["new", "confirmed", "preparing", "ready", "completed", "cancelled"]);
type VerificationChallenge =
  | { mode: "nikita"; token: string; requestedAt: number; expiresAt: number; attempts: number }
  | { mode: "development"; code: string; requestedAt: number; expiresAt: number; attempts: number };
const verificationChallenges = new Map<string, VerificationChallenge>();
const kyrgyzPhonePattern = /^996\d{9}$/;
const verificationLifetimeMs = 10 * 60 * 1000;
const verificationResendDelayMs = 60 * 1000;
const maxVerificationAttempts = 5;

function pruneVerificationChallenges(now = Date.now()) {
  for (const [phone, challenge] of verificationChallenges) {
    if (challenge.expiresAt < now) verificationChallenges.delete(phone);
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDirectory,
    filename: (_request, file, callback) => callback(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => callback(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
});

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanValue(value: unknown, fallback = true) {
  return value === undefined ? fallback : value === true || value === "true";
}

function locationCoordinates(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const values = body as Record<string, unknown>;
  const parseCoordinate = (value: unknown) => {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "") return Number(value);
    return Number.NaN;
  };
  const latitude = parseCoordinate(values.latitude);
  const longitude = parseCoordinate(values.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

const yandexGeocoderUrl = "https://geocode-maps.yandex.ru/v1/";
const yandexGeocoderTimeoutMs = 8_000;

type YandexGeocoderResponse = {
  response?: {
    GeoObjectCollection?: {
      featureMember?: Array<{
        GeoObject?: {
          description?: string;
          name?: string;
          metaDataProperty?: {
            GeocoderMetaData?: {
              text?: string;
              Address?: { formatted?: string };
            };
          };
          Point?: { pos?: string };
        };
      }>;
    };
  };
};

class YandexGeocoderError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function queryCoordinate(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") return Number.NaN;
  return Number(value);
}

async function geocodeWithYandex(searchValue: string) {
  const apiKey = String(process.env.YANDEX_GEOCODER_API_KEY || "").trim();
  if (!apiKey) throw new YandexGeocoderError(503, "Геокодер Яндекса не настроен: добавьте YANDEX_GEOCODER_API_KEY");

  const url = new URL(yandexGeocoderUrl);
  url.search = new URLSearchParams({
    apikey: apiKey,
    geocode: searchValue,
    lang: "ru_RU",
    format: "json",
    results: "1",
  }).toString();

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(url, {
      headers: { accept: "application/json", referer: "https://daanasushi.com/" },
      signal: AbortSignal.timeout(yandexGeocoderTimeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      throw new YandexGeocoderError(504, "Яндекс Карты не ответили вовремя. Попробуйте ещё раз");
    }
    throw new YandexGeocoderError(502, "Не удалось связаться с геокодером Яндекса");
  }

  if (!upstream.ok) {
    if (upstream.status === 401 || upstream.status === 403) {
      throw new YandexGeocoderError(502, "Яндекс отклонил ключ геокодера. Проверьте YANDEX_GEOCODER_API_KEY");
    }
    if (upstream.status === 429) {
      throw new YandexGeocoderError(429, "Превышен лимит запросов к геокодеру Яндекса. Попробуйте позже");
    }
    throw new YandexGeocoderError(502, "Геокодер Яндекса временно недоступен");
  }

  let payload: YandexGeocoderResponse;
  try {
    payload = await upstream.json() as YandexGeocoderResponse;
  } catch {
    throw new YandexGeocoderError(502, "Геокодер Яндекса вернул некорректный ответ");
  }

  const geoObject = payload.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
  const [longitude, latitude] = String(geoObject?.Point?.pos || "").trim().split(/\s+/).map(Number);
  const metadata = geoObject?.metaDataProperty?.GeocoderMetaData;
  const fallbackAddress = [geoObject?.description, geoObject?.name].filter(Boolean).join(", ");
  const address = String(metadata?.Address?.formatted || metadata?.text || fallbackAddress).trim();
  if (!address || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new YandexGeocoderError(404, "Адрес не найден. Уточните запрос или выберите другую точку на карте");
  }

  return { address, latitude, longitude };
}

app.get("/api/health", async (_request, response) => {
  const [result] = await sql`SELECT NOW() AS now`;
  response.json({ status: "ok", database: true, now: result.now });
});

app.get("/api/catalog", async (_request, response) => {
  const categoryRows = await sql`SELECT id, name, slug, sort_order AS "sortOrder", active FROM categories WHERE active = TRUE ORDER BY sort_order, id`;
  const productRows = await sql`SELECT id, category_id AS "categoryId", name, price, image, active, sort_order AS "sortOrder" FROM products WHERE active = TRUE ORDER BY category_id, sort_order, id`;
  response.json({ categories: categoryRows, products: productRows });
});

app.get("/api/locations", async (_request, response) => {
  const rows = await sql`SELECT id, name, address, phone, hours, opens_at AS "opensAt", latitude, longitude, active FROM pickup_locations WHERE active = TRUE ORDER BY id`;
  response.json(rows);
});

app.get("/api/promotions", async (_request, response) => {
  const rows = await sql`SELECT id, title, description, image, active, sort_order AS "sortOrder" FROM promotions WHERE active = TRUE ORDER BY sort_order, id`;
  response.json(rows);
});

app.get("/api/settings", async (_request, response) => {
  const rows = await sql`SELECT key, value FROM site_settings`;
  response.json(Object.fromEntries(rows.map((row) => [row.key, row.value])));
});

app.post("/api/auth/request-code", otpRequestLimiter, async (request, response) => {
  const phone = String(request.body.phone || "").replace(/\D/g, "");
  if (!kyrgyzPhonePattern.test(phone)) return response.status(400).json({ error: "Укажите телефон в формате +996" });
  const now = Date.now();
  pruneVerificationChallenges(now);
  const existingChallenge = verificationChallenges.get(phone);
  if (existingChallenge && now - existingChallenge.requestedAt < verificationResendDelayMs) {
    return response.status(429).json({ error: "Код уже отправлен. Повторите через минуту" });
  }
  const apiKey = String(process.env.NIKITA_OTP_API_KEY || "").trim();
  try {
    if (apiKey) {
      const transactionId = randomUUID().replaceAll("-", "");
      const token = await sendNikitaOtp(apiKey, phone, transactionId);
      verificationChallenges.set(phone, { mode: "nikita", token, requestedAt: now, expiresAt: now + verificationLifetimeMs, attempts: 0 });
      return response.json({ sent: true });
    }
    if (process.env.NODE_ENV === "production") return response.status(503).json({ error: "Отправка SMS ещё не настроена" });

    const code = "0000";
    verificationChallenges.set(phone, { mode: "development", code, requestedAt: now, expiresAt: now + verificationLifetimeMs, attempts: 0 });
    return response.json({ sent: true, devCode: code });
  } catch (error) {
    if (error instanceof NikitaOtpError) return response.status(error.httpStatus).json({ error: error.message });
    console.error("Nikita OTP send failed", error);
    return response.status(502).json({ error: "Не удалось отправить SMS-код" });
  }
});

app.post("/api/auth/verify-code", otpVerifyLimiter, async (request, response) => {
  const phone = String(request.body.phone || "").replace(/\D/g, "");
  const code = String(request.body.code || "").trim();
  if (!kyrgyzPhonePattern.test(phone) || code.length < 4 || code.length > 32) return response.status(400).json({ error: "Укажите корректные телефон и код" });
  const challenge = verificationChallenges.get(phone);
  if (!challenge || challenge.expiresAt < Date.now()) {
    verificationChallenges.delete(phone);
    return response.status(400).json({ error: "Код устарел. Запросите новый" });
  }
  if (challenge.attempts >= maxVerificationAttempts) {
    verificationChallenges.delete(phone);
    return response.status(429).json({ error: "Слишком много попыток. Запросите новый код" });
  }

  try {
    if (challenge.mode === "nikita") {
      const apiKey = String(process.env.NIKITA_OTP_API_KEY || "").trim();
      if (!apiKey) return response.status(503).json({ error: "Проверка SMS временно недоступна" });
      await verifyNikitaOtp(apiKey, challenge.token, code);
    } else if (challenge.code !== code) {
      challenge.attempts += 1;
      return response.status(400).json({ error: "Неверный код" });
    }

    verificationChallenges.delete(phone);
    const [customer] = await sql`INSERT INTO customers (phone) VALUES (${phone}) ON CONFLICT (phone) DO UPDATE SET updated_at = NOW() RETURNING id, phone, name`;
    return response.json({ customer });
  } catch (error) {
    if (error instanceof NikitaOtpError) {
      if (error.providerStatus === 12 || error.providerStatus === 13) verificationChallenges.delete(phone);
      else if (error.providerStatus === 14) challenge.attempts += 1;
      return response.status(error.httpStatus).json({ error: error.message });
    }
    console.error("Nikita OTP verification failed", error);
    return response.status(502).json({ error: "Не удалось проверить SMS-код" });
  }
});

app.post("/api/orders", orderLimiter, async (request, response) => {
  const customerName = String(request.body.customerName || "").trim();
  const customerPhone = String(request.body.customerPhone || "").trim();
  const locationId = numberValue(request.body.locationId);
  const rawItems = Array.isArray(request.body.items) ? request.body.items : [];
  if (!customerName || !kyrgyzPhonePattern.test(customerPhone.replace(/\D/g, "")) || !locationId || rawItems.length === 0) return response.status(400).json({ error: "Заполните контактные данные и укажите телефон в формате +996" });
  const requested = new Map<number, number>();
  for (const item of rawItems) {
    const productId = numberValue(item.productId); const quantity = Math.min(99, Math.max(1, numberValue(item.quantity, 1)));
    if (productId) requested.set(productId, (requested.get(productId) || 0) + quantity);
  }
  const ids = [...requested.keys()];
  if (!ids.length) return response.status(400).json({ error: "Корзина пуста" });
  const available = await sql`SELECT id, name, price FROM products WHERE active = TRUE AND id IN ${sql(ids)}`;
  if (available.length !== ids.length) return response.status(409).json({ error: "Некоторые позиции больше недоступны" });
  const total = available.reduce((sum, product) => sum + product.price * (requested.get(product.id) || 0), 0);
  const orderNumber = `ST-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const order = await sql.begin(async (tx) => {
    const normalizedPhone = customerPhone.replace(/\D/g, "");
    const [customer] = await tx`INSERT INTO customers (phone, name) VALUES (${normalizedPhone}, ${customerName}) ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW() RETURNING id`;
    const [created] = await tx`INSERT INTO orders (order_number, customer_id, customer_name, customer_phone, location_id, comment, total) VALUES (${orderNumber}, ${customer.id}, ${customerName}, ${customerPhone}, ${locationId}, ${String(request.body.comment || "").slice(0, 1000)}, ${total}) RETURNING id, order_number AS "orderNumber", status, total, created_at AS "createdAt"`;
    for (const product of available) {
      const quantity = requested.get(product.id) || 1;
      await tx`INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total) VALUES (${created.id}, ${product.id}, ${product.name}, ${product.price}, ${quantity}, ${product.price * quantity})`;
    }
    return created;
  });
  response.status(201).json(order);
});

app.post("/api/admin/login", authLimiter, async (request, response) => {
  const [user] = await sql`SELECT id, password_hash, name FROM admin_users ORDER BY id LIMIT 1`;
  if (!user || !(await bcrypt.compare(String(request.body.password || ""), user.password_hash))) return response.status(401).json({ error: "Неверный пароль" });
  const publicUser = { id: Number(user.id), name: String(user.name) };
  response.json({ token: await createAdminToken(publicUser), user: publicUser });
});

app.use("/api/admin", requireAdmin);

app.get("/api/admin/geocode", geocodeLimiter, async (request, response) => {
  try {
    const rawQuery = request.query.query;
    if (rawQuery !== undefined) {
      if (typeof rawQuery !== "string") return response.status(400).json({ error: "Укажите один адрес для поиска" });
      const query = rawQuery.trim();
      if (query.length < 3 || query.length > 300) return response.status(400).json({ error: "Адрес должен содержать от 3 до 300 символов" });
      response.setHeader("Cache-Control", "no-store");
      return response.json(await geocodeWithYandex(query));
    }

    const latitude = queryCoordinate(request.query.latitude);
    const longitude = queryCoordinate(request.query.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return response.status(400).json({ error: "Укажите корректные широту и долготу" });
    }
    response.setHeader("Cache-Control", "no-store");
    return response.json(await geocodeWithYandex(`${longitude},${latitude}`));
  } catch (error) {
    if (error instanceof YandexGeocoderError) return response.status(error.status).json({ error: error.message });
    console.error("Yandex geocoding failed", error);
    return response.status(502).json({ error: "Не удалось выполнить поиск адреса" });
  }
});

app.post("/api/admin/yandex-map-link", geocodeLimiter, async (request, response) => {
  try {
    const rawUrl = request.body?.url;
    if (typeof rawUrl !== "string") return response.status(400).json({ error: "Вставьте ссылку из Яндекс Карт" });
    const coordinates = await resolveYandexMapLink(rawUrl);
    let address = "";
    if (String(process.env.YANDEX_GEOCODER_API_KEY || "").trim()) {
      try {
        address = (await geocodeWithYandex(`${coordinates.longitude},${coordinates.latitude}`)).address;
      } catch (error) {
        console.warn("Yandex link coordinates resolved without reverse geocoding", error instanceof Error ? error.message : error);
      }
    }
    response.setHeader("Cache-Control", "no-store");
    return response.json({ ...coordinates, address });
  } catch (error) {
    if (error instanceof YandexMapLinkError) return response.status(error.status).json({ error: error.message });
    console.error("Yandex map link resolution failed", error);
    return response.status(502).json({ error: "Не удалось обработать ссылку Яндекс Карт" });
  }
});

app.get("/api/admin/dashboard", async (_request, response) => {
  const [stats] = await sql`SELECT (SELECT COUNT(*)::int FROM orders WHERE created_at >= CURRENT_DATE) AS "ordersToday", (SELECT COALESCE(SUM(total),0)::int FROM orders WHERE created_at >= CURRENT_DATE AND status <> 'cancelled') AS "revenueToday", (SELECT COUNT(*)::int FROM products WHERE active = TRUE) AS products, (SELECT COUNT(*)::int FROM orders WHERE status IN ('new','confirmed','preparing')) AS "activeOrders"`;
  response.json(stats);
});

app.get("/api/admin/categories", async (_request, response) => response.json(await sql`SELECT id, name, slug, sort_order AS "sortOrder", active FROM categories ORDER BY sort_order, id`));
app.post("/api/admin/categories", async (request, response) => {
  const [created] = await sql`INSERT INTO categories (id, name, slug, sort_order, active) VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM categories), ${String(request.body.name || "Новая категория")}, ${String(request.body.slug || `category-${Date.now()}`)}, ${numberValue(request.body.sortOrder)}, ${booleanValue(request.body.active)}) RETURNING id, name, slug, sort_order AS "sortOrder", active`;
  response.status(201).json(created);
});
app.put("/api/admin/categories/:id", async (request, response) => {
  const [updated] = await sql`UPDATE categories SET name=${String(request.body.name)}, slug=${String(request.body.slug)}, sort_order=${numberValue(request.body.sortOrder)}, active=${booleanValue(request.body.active)}, updated_at=NOW() WHERE id=${numberValue(request.params.id)} RETURNING id, name, slug, sort_order AS "sortOrder", active`;
  if (updated) response.json(updated);
  else response.status(404).json({ error: "Категория не найдена" });
});
app.delete("/api/admin/categories/:id", async (request, response) => {
  try { await sql`DELETE FROM categories WHERE id=${numberValue(request.params.id)}`; response.status(204).end(); } catch { response.status(409).json({ error: "Сначала перенесите или удалите товары категории" }); }
});

app.get("/api/admin/products", async (_request, response) => response.json(await sql`SELECT id, category_id AS "categoryId", name, price, image, active, sort_order AS "sortOrder" FROM products ORDER BY category_id, sort_order, id`));
app.post("/api/admin/products", async (request, response) => {
  const [created] = await sql`INSERT INTO products (id, category_id, name, price, image, active, sort_order) VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM products), ${numberValue(request.body.categoryId)}, ${String(request.body.name || "Новый товар")}, ${numberValue(request.body.price)}, ${String(request.body.image || "")}, ${booleanValue(request.body.active)}, ${numberValue(request.body.sortOrder)}) RETURNING id, category_id AS "categoryId", name, price, image, active, sort_order AS "sortOrder"`;
  response.status(201).json(created);
});
app.put("/api/admin/products/:id", async (request, response) => {
  const [updated] = await sql`UPDATE products SET category_id=${numberValue(request.body.categoryId)}, name=${String(request.body.name)}, price=${numberValue(request.body.price)}, image=${String(request.body.image)}, active=${booleanValue(request.body.active)}, sort_order=${numberValue(request.body.sortOrder)}, updated_at=NOW() WHERE id=${numberValue(request.params.id)} RETURNING id, category_id AS "categoryId", name, price, image, active, sort_order AS "sortOrder"`;
  if (updated) response.json(updated);
  else response.status(404).json({ error: "Товар не найден" });
});
app.delete("/api/admin/products/:id", async (request, response) => { await sql`DELETE FROM products WHERE id=${numberValue(request.params.id)}`; response.status(204).end(); });

app.get("/api/admin/locations", async (_request, response) => response.json(await sql`SELECT id, name, address, phone, hours, opens_at AS "opensAt", latitude, longitude, active FROM pickup_locations ORDER BY id`));
app.post("/api/admin/locations", async (request, response) => {
  const coordinates = locationCoordinates(request.body);
  if (!coordinates) { response.status(400).json({ error: "Укажите корректные широту и долготу" }); return; }
  const [created] = await sql`INSERT INTO pickup_locations (id,name,address,phone,hours,opens_at,latitude,longitude,active) VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM pickup_locations),${String(request.body.name || "Новая точка")},${String(request.body.address || "")},${String(request.body.phone || "")},${String(request.body.hours || "10:00 - 21:00")},${String(request.body.opensAt || "10:00")},${coordinates.latitude},${coordinates.longitude},${booleanValue(request.body.active)}) RETURNING id,name,address,phone,hours,opens_at AS "opensAt",latitude,longitude,active`;
  response.status(201).json(created);
});
app.put("/api/admin/locations/:id", async (request, response) => {
  const coordinates = locationCoordinates(request.body);
  if (!coordinates) { response.status(400).json({ error: "Укажите корректные широту и долготу" }); return; }
  const [updated] = await sql`UPDATE pickup_locations SET name=${String(request.body.name)},address=${String(request.body.address)},phone=${String(request.body.phone)},hours=${String(request.body.hours)},opens_at=${String(request.body.opensAt)},latitude=${coordinates.latitude},longitude=${coordinates.longitude},active=${booleanValue(request.body.active)},updated_at=NOW() WHERE id=${numberValue(request.params.id)} RETURNING id,name,address,phone,hours,opens_at AS "opensAt",latitude,longitude,active`;
  if (updated) response.json(updated);
  else response.status(404).json({ error: "Точка не найдена" });
});
app.delete("/api/admin/locations/:id", async (request, response) => { try { await sql`DELETE FROM pickup_locations WHERE id=${numberValue(request.params.id)}`; response.status(204).end(); } catch { response.status(409).json({ error: "Точка используется в заказах" }); } });

app.get("/api/admin/promotions", async (_request, response) => response.json(await sql`SELECT id,title,description,image,active,sort_order AS "sortOrder" FROM promotions ORDER BY sort_order,id`));
app.post("/api/admin/promotions", async (request, response) => {
  const [created] = await sql`INSERT INTO promotions (id,title,description,image,active,sort_order) VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM promotions),${String(request.body.title || "Новая акция")},${String(request.body.description || "")},${String(request.body.image || "")},${booleanValue(request.body.active)},${numberValue(request.body.sortOrder)}) RETURNING id,title,description,image,active,sort_order AS "sortOrder"`;
  response.status(201).json(created);
});
app.put("/api/admin/promotions/:id", async (request, response) => {
  const [updated] = await sql`UPDATE promotions SET title=${String(request.body.title)},description=${String(request.body.description)},image=${String(request.body.image)},active=${booleanValue(request.body.active)},sort_order=${numberValue(request.body.sortOrder)},updated_at=NOW() WHERE id=${numberValue(request.params.id)} RETURNING id,title,description,image,active,sort_order AS "sortOrder"`;
  response.json(updated);
});
app.delete("/api/admin/promotions/:id", async (request, response) => { await sql`DELETE FROM promotions WHERE id=${numberValue(request.params.id)}`; response.status(204).end(); });

app.get("/api/admin/orders", async (_request, response) => {
  const orders = await sql`SELECT o.id,o.order_number AS "orderNumber",o.customer_name AS "customerName",o.customer_phone AS "customerPhone",o.status,o.comment,o.total,o.created_at AS "createdAt",l.name AS "locationName",l.address AS "locationAddress" FROM orders o JOIN pickup_locations l ON l.id=o.location_id ORDER BY o.created_at DESC LIMIT 500`;
  const orderIds = orders.map((order) => order.id);
  const items = orderIds.length ? await sql`SELECT order_id AS "orderId",product_name AS "productName",unit_price AS "unitPrice",quantity,line_total AS "lineTotal" FROM order_items WHERE order_id IN ${sql(orderIds)} ORDER BY id` : [];
  response.json(orders.map((order) => ({ ...order, items: items.filter((item) => item.orderId === order.id) })));
});
app.patch("/api/admin/orders/:id/status", async (request, response) => {
  const status = String(request.body.status || "");
  if (!validStatuses.has(status)) return response.status(400).json({ error: "Неизвестный статус" });
  const [updated] = await sql`UPDATE orders SET status=${status},updated_at=NOW() WHERE id=${numberValue(request.params.id)} RETURNING id,order_number AS "orderNumber",status,updated_at AS "updatedAt"`;
  if (!updated) return response.status(404).json({ error: "Заказ не найден" });
  response.json(updated);
});

app.get("/api/admin/settings", async (_request, response) => {
  const rows = await sql`SELECT key,value,updated_at AS "updatedAt" FROM site_settings ORDER BY key`;
  response.json(rows);
});
app.put("/api/admin/settings/:key", async (request, response) => {
  const [updated] = await sql`INSERT INTO site_settings (key,value) VALUES (${String(request.params.key)},${sql.json(request.body.value || {})}) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW() RETURNING key,value,updated_at AS "updatedAt"`;
  response.json(updated);
});
app.post("/api/admin/upload", upload.single("file"), (request: Request, response: Response) => {
  if (!request.file) return response.status(400).json({ error: "Поддерживаются PNG, JPG и WebP до 5 МБ" });
  response.status(201).json({ url: `/uploads/${request.file.filename}` });
});

app.use((error: unknown, _request: Request, response: Response, _next: unknown) => {
  void _next;
  console.error(error);
  response.status(500).json({ error: "Внутренняя ошибка сервера" });
});

await migrate();
const [databaseState] = await sql`SELECT EXISTS (SELECT 1 FROM products) AS "hasProducts"`;
if (!databaseState.hasProducts) await seed();
else await syncAdminPassword();
const server = app.listen(port, () => console.log(`DAANA SUSHI API: http://localhost:${port}/api`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(async () => { await closeDatabase(); process.exit(0); }));
}
