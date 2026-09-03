CREATE TABLE IF NOT EXISTS admin_users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Администратор',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  image TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pickup_locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  hours TEXT NOT NULL,
  opens_at TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  customer_id BIGINT REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  location_id INTEGER NOT NULL REFERENCES pickup_locations(id),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','preparing','ready','completed','cancelled')),
  comment TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL CHECK (total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS app_migrations (
  key TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE key = '2026-08-17-enable-onigiri') THEN
    UPDATE products SET
      name = CASE id WHEN 29 THEN 'Онигири с креветкой' WHEN 30 THEN 'Онигири с лососем' ELSE name END,
      price = CASE id WHEN 29 THEN 165 WHEN 30 THEN 195 ELSE price END,
      image = CASE id WHEN 29 THEN '/assets/products/1736432465572.webp' WHEN 30 THEN '/assets/products/1736432486643.webp' ELSE image END,
      active = TRUE,
      sort_order = CASE id WHEN 29 THEN 1 WHEN 30 THEN 2 ELSE sort_order END,
      updated_at = NOW()
    WHERE id IN (29, 30);
    INSERT INTO app_migrations (key) VALUES ('2026-08-17-enable-onigiri');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE key = '2026-09-02-legal-operator') THEN
    UPDATE site_settings
    SET value = jsonb_set(value, '{legalName}', to_jsonb('ИП Мусаев Жаныбек Кочкорбаевич'::text), TRUE), updated_at = NOW()
    WHERE key = 'general';
    INSERT INTO app_migrations (key) VALUES ('2026-09-02-legal-operator');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE key = '2026-08-31-kyrgyz-phone-prefix') THEN
    UPDATE pickup_locations SET phone = '+996 (555) 506-447', updated_at = NOW() WHERE phone LIKE '+7%';
    INSERT INTO app_migrations (key) VALUES ('2026-08-31-kyrgyz-phone-prefix');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE key = '2026-09-03-kyrgyz-pickup-map') THEN
    UPDATE pickup_locations
    SET active = FALSE, updated_at = NOW()
    WHERE active = TRUE
      AND latitude BETWEEN 51 AND 54
      AND longitude BETWEEN 103 AND 106;

    IF NOT EXISTS (
      SELECT 1
      FROM pickup_locations
      WHERE active = TRUE
        AND latitude BETWEEN 39 AND 44
        AND longitude BETWEEN 69 AND 81
    ) THEN
      INSERT INTO pickup_locations (id, name, address, phone, hours, opens_at, latitude, longitude, active)
      VALUES (
        (SELECT COALESCE(MAX(id), 0) + 1 FROM pickup_locations),
        'ДААНА СУШИ — Отуз-Адыр',
        'Ошская область, Кара-Суйский район, с. Отуз-Адыр, ул. Токтогула, дом 4',
        '+996 (555) 506-447',
        '10:00 - 21:00',
        '10:00',
        40.606046,
        72.966095,
        TRUE
      );
    END IF;

    INSERT INTO app_migrations (key) VALUES ('2026-09-03-kyrgyz-pickup-map');
  END IF;
END $$;
