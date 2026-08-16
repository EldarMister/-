import "dotenv/config";
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
const orderLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 25, standardHeaders: true, legacyHeaders: false });
const validStatuses = new Set(["new", "confirmed", "preparing", "ready", "completed", "cancelled"]);
const verificationCodes = new Map<string, { code: string; expiresAt: number }>();

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

app.post("/api/auth/request-code", authLimiter, (request, response) => {
  const phone = String(request.body.phone || "").replace(/\D/g, "");
  if (phone.length < 10) return response.status(400).json({ error: "Укажите корректный телефон" });
  const code = process.env.NODE_ENV === "production" ? String(Math.floor(1000 + Math.random() * 9000)) : "0000";
  verificationCodes.set(phone, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
  response.json({ sent: true, ...(process.env.NODE_ENV !== "production" ? { devCode: code } : {}) });
});

app.post("/api/auth/verify-code", authLimiter, async (request, response) => {
  const phone = String(request.body.phone || "").replace(/\D/g, "");
  const stored = verificationCodes.get(phone);
  if (!stored || stored.expiresAt < Date.now() || stored.code !== String(request.body.code || "")) return response.status(400).json({ error: "Неверный или просроченный код" });
  verificationCodes.delete(phone);
  const [customer] = await sql`INSERT INTO customers (phone) VALUES (${phone}) ON CONFLICT (phone) DO UPDATE SET updated_at = NOW() RETURNING id, phone, name`;
  response.json({ customer });
});

app.post("/api/orders", orderLimiter, async (request, response) => {
  const customerName = String(request.body.customerName || "").trim();
  const customerPhone = String(request.body.customerPhone || "").trim();
  const locationId = numberValue(request.body.locationId);
  const rawItems = Array.isArray(request.body.items) ? request.body.items : [];
  if (!customerName || customerPhone.replace(/\D/g, "").length < 10 || !locationId || rawItems.length === 0) return response.status(400).json({ error: "Заполните контактные данные и корзину" });
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
  const [created] = await sql`INSERT INTO pickup_locations (id,name,address,phone,hours,opens_at,latitude,longitude,active) VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM pickup_locations),${String(request.body.name || "Новая точка")},${String(request.body.address || "")},${String(request.body.phone || "")},${String(request.body.hours || "10:00 - 21:00")},${String(request.body.opensAt || "10:00")},${numberValue(request.body.latitude)},${numberValue(request.body.longitude)},${booleanValue(request.body.active)}) RETURNING id,name,address,phone,hours,opens_at AS "opensAt",latitude,longitude,active`;
  response.status(201).json(created);
});
app.put("/api/admin/locations/:id", async (request, response) => {
  const [updated] = await sql`UPDATE pickup_locations SET name=${String(request.body.name)},address=${String(request.body.address)},phone=${String(request.body.phone)},hours=${String(request.body.hours)},opens_at=${String(request.body.opensAt)},latitude=${numberValue(request.body.latitude)},longitude=${numberValue(request.body.longitude)},active=${booleanValue(request.body.active)},updated_at=NOW() WHERE id=${numberValue(request.params.id)} RETURNING id,name,address,phone,hours,opens_at AS "opensAt",latitude,longitude,active`;
  response.json(updated);
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
  const orders = await sql`SELECT o.id,o.order_number AS "orderNumber",o.customer_name AS "customerName",o.customer_phone AS "customerPhone",o.status,o.comment,o.total,o.created_at AS "createdAt",l.name AS "locationName" FROM orders o JOIN pickup_locations l ON l.id=o.location_id ORDER BY o.created_at DESC LIMIT 500`;
  const orderIds = orders.map((order) => order.id);
  const items = orderIds.length ? await sql`SELECT order_id AS "orderId",product_name AS "productName",unit_price AS "unitPrice",quantity,line_total AS "lineTotal" FROM order_items WHERE order_id IN ${sql(orderIds)} ORDER BY id` : [];
  response.json(orders.map((order) => ({ ...order, items: items.filter((item) => item.orderId === order.id) })));
});
app.patch("/api/admin/orders/:id/status", async (request, response) => {
  const status = String(request.body.status || "");
  if (!validStatuses.has(status)) return response.status(400).json({ error: "Неизвестный статус" });
  const [updated] = await sql`UPDATE orders SET status=${status},updated_at=NOW() WHERE id=${numberValue(request.params.id)} RETURNING id,order_number AS "orderNumber",status,updated_at AS "updatedAt"`;
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
