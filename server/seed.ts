import "dotenv/config";
import bcrypt from "bcryptjs";
import { categories, locations, products, promotions } from "../app/data";
import { closeDatabase, sql } from "./db";
import { migrate } from "./migrate";

export async function seed() {
  await migrate();
  await sql.begin(async (tx) => {
    for (const category of categories) {
      await tx`INSERT INTO categories (id, name, slug, sort_order, active)
        VALUES (${category.id}, ${category.name}, ${category.slug}, ${category.sortOrder}, ${category.active})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, sort_order = EXCLUDED.sort_order, active = EXCLUDED.active, updated_at = NOW()`;
    }
    for (const product of products) {
      await tx`INSERT INTO products (id, category_id, name, price, image, active, sort_order)
        VALUES (${product.id}, ${product.categoryId}, ${product.name}, ${product.price}, ${product.image}, ${product.active}, ${product.sortOrder})
        ON CONFLICT (id) DO UPDATE SET category_id = EXCLUDED.category_id, name = EXCLUDED.name, price = EXCLUDED.price, image = EXCLUDED.image, active = EXCLUDED.active, sort_order = EXCLUDED.sort_order, updated_at = NOW()`;
    }
    for (const location of locations) {
      await tx`INSERT INTO pickup_locations (id, name, address, phone, hours, opens_at, latitude, longitude, active)
        VALUES (${location.id}, ${location.name}, ${location.address}, ${location.phone}, ${location.hours}, ${location.opensAt}, ${location.latitude}, ${location.longitude}, ${location.active})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address, phone = EXCLUDED.phone, hours = EXCLUDED.hours, opens_at = EXCLUDED.opens_at, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, active = EXCLUDED.active, updated_at = NOW()`;
    }
    for (const promotion of promotions) {
      await tx`INSERT INTO promotions (id, title, description, image, active, sort_order)
        VALUES (${promotion.id}, ${promotion.title}, ${promotion.description}, ${promotion.image}, ${promotion.active}, ${promotion.sortOrder})
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, image = EXCLUDED.image, active = EXCLUDED.active, sort_order = EXCLUDED.sort_order, updated_at = NOW()`;
    }
    const email = process.env.ADMIN_EMAIL || "admin@sushitochka.local";
    const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";
    const passwordHash = await bcrypt.hash(password, 12);
    await tx`INSERT INTO admin_users (email, password_hash, name) VALUES (${email}, ${passwordHash}, 'Администратор')
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`;
    await tx`INSERT INTO site_settings (key, value) VALUES ('general', ${sql.json({ legalName: "ИП Багаутдинова", qualityControl: "Отдел контроля качества", telegram: "https://t.me/BIG_REST_TEAM" })}) ON CONFLICT (key) DO NOTHING`;
  });
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seed().then(() => console.log("Initial data is ready.")).finally(closeDatabase);
}

