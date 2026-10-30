CREATE TABLE IF NOT EXISTS admin_users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Администратор',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  admin_user_id BIGINT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin v2: additive migration, existing accounts and sessions are preserved.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'ADMIN';
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS permission_overrides JSONB NOT NULL DEFAULT '{}';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='admin_users_role_check') THEN
    ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check CHECK (role IN ('OWNER','ADMIN','MANAGER'));
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY, admin_user_id BIGINT REFERENCES admin_users(id),
  actor_name TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC);
CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
  endpoint TEXT PRIMARY KEY, admin_user_id BIGINT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  subscription JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE categories ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_live_slug ON categories(slug) WHERE deleted_at IS NULL;

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

ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredients TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS serving TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_unit TEXT NOT NULL DEFAULT 'г';
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight NUMERIC(10,2) CHECK (weight BETWEEN 0 AND 1000000);
ALTER TABLE products ADD COLUMN IF NOT EXISTS calories NUMERIC(10,2) CHECK (calories BETWEEN 0 AND 1000000);
ALTER TABLE products ADD COLUMN IF NOT EXISTS protein NUMERIC(10,2) CHECK (protein BETWEEN 0 AND 1000000);
ALTER TABLE products ADD COLUMN IF NOT EXISTS fat NUMERIC(10,2) CHECK (fat BETWEEN 0 AND 1000000);
ALTER TABLE products ADD COLUMN IF NOT EXISTS carbohydrates NUMERIC(10,2) CHECK (carbohydrates BETWEEN 0 AND 1000000);

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

ALTER TABLE pickup_locations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

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

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS nakta_coins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS nakta_coins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS reward_completed_orders INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS nakta_coins_reward INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS rewards_processed_at TIMESTAMPTZ;

UPDATE orders
SET rewards_processed_at = updated_at
WHERE status = 'completed' AND rewards_processed_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_nakta_coins') THEN
    ALTER TABLE products ADD CONSTRAINT chk_products_nakta_coins CHECK (nakta_coins >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_customers_nakta_coins') THEN
    ALTER TABLE customers ADD CONSTRAINT chk_customers_nakta_coins CHECK (nakta_coins >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_customers_reward_completed_orders') THEN
    ALTER TABLE customers ADD CONSTRAINT chk_customers_reward_completed_orders CHECK (reward_completed_orders >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_order_items_nakta_coins_reward') THEN
    ALTER TABLE order_items ADD CONSTRAINT chk_order_items_nakta_coins_reward CHECK (nakta_coins_reward >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS customer_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nakta_coin_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  description VARCHAR(240) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nakta_coin_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  request_key UUID NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  wallet_address VARCHAR(200) NOT NULL,
  network VARCHAR(20) NOT NULL DEFAULT 'polygon'
    CHECK (network IN ('polygon','ethereum','bsc','solana','ton')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','submitted','withdrawn','failed','cancelled')),
  tx_hash VARCHAR(200),
  error TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE nakta_coin_withdrawals
  ADD COLUMN IF NOT EXISTS request_key UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'nakta_coin_withdrawals'::regclass
      AND attname = 'request_key'
      AND NOT attnotnull
  ) THEN
    UPDATE nakta_coin_withdrawals SET request_key = id WHERE request_key IS NULL;
    ALTER TABLE nakta_coin_withdrawals ALTER COLUMN request_key SET NOT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS account_nfts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  reward_key VARCHAR(180) NOT NULL UNIQUE,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  milestone_order_count INTEGER NOT NULL DEFAULT 0 CHECK (milestone_order_count >= 0),
  name VARCHAR(160) NOT NULL,
  image TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  network VARCHAR(20) NOT NULL
    CHECK (network IN ('polygon','ethereum','bsc','solana','ton')),
  contract_address VARCHAR(200) NOT NULL DEFAULT '',
  metadata_uri TEXT NOT NULL DEFAULT '',
  token_id VARCHAR(160),
  status VARCHAR(20) NOT NULL DEFAULT 'owned'
    CHECK (status IN ('owned','pending','submitted','withdrawn','failed')),
  wallet_address VARCHAR(200),
  tx_hash VARCHAR(200),
  withdrawal_error TEXT,
  withdrawal_requested_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_reward_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  asset VARCHAR(10) NOT NULL CHECK (asset IN ('coin','nft')),
  delta INTEGER NOT NULL CHECK (delta <> 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reason VARCHAR(240) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer_expires
  ON customer_sessions(customer_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_expires
  ON customer_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_coin_transactions_customer_created
  ON nakta_coin_transactions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coin_withdrawals_customer_created
  ON nakta_coin_withdrawals(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coin_withdrawals_status
  ON nakta_coin_withdrawals(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_coin_withdrawals_customer_request
  ON nakta_coin_withdrawals(customer_id, request_key);
CREATE INDEX IF NOT EXISTS idx_account_nfts_customer_created
  ON account_nfts(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_nfts_status
  ON account_nfts(status, withdrawal_requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_nfts_customer_milestone
  ON account_nfts(customer_id, milestone_order_count)
  WHERE milestone_order_count > 0;
CREATE INDEX IF NOT EXISTS idx_reward_adjustments_customer_created
  ON customer_reward_adjustments(customer_id, created_at DESC);

INSERT INTO site_settings (key, value)
VALUES (
  'rewards',
  '{"nftRewardEveryOrders":10,"nftRewardName":"NFT NAKTA","nftRewardImage":"","nftRewardDescription":"","nftRewardNetwork":"polygon","nftContractAddress":"","nftMetadataUri":"","coinNetwork":"polygon"}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_migrations (key)
VALUES ('2026-09-05-nakta-loyalty-program')
ON CONFLICT (key) DO NOTHING;

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
  IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE key = '2026-09-03-remove-quality-control') THEN
    UPDATE site_settings
    SET value = value - 'qualityControl', updated_at = NOW()
    WHERE key = 'general';
    INSERT INTO app_migrations (key) VALUES ('2026-09-03-remove-quality-control');
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

CREATE OR REPLACE FUNCTION notify_admin_change() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('admin_changes', TG_TABLE_NAME);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['orders', 'order_items', 'categories', 'products', 'pickup_locations', 'promotions', 'site_settings', 'customers', 'nakta_coin_transactions', 'nakta_coin_withdrawals', 'account_nfts', 'customer_reward_adjustments']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'admin_change' AND tgrelid = table_name::regclass) THEN
      EXECUTE format('CREATE TRIGGER admin_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION notify_admin_change()', table_name);
    END IF;
  END LOOP;
END $$;

-- Promote the original account once. Never silently recreate a revoked owner.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE key='2026-10-25-admin-v2-access') THEN
    UPDATE admin_users SET role='OWNER' WHERE id=(SELECT id FROM admin_users ORDER BY id LIMIT 1);
    INSERT INTO app_migrations(key) VALUES ('2026-10-25-admin-v2-access');
  END IF;
END $$;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS category_name_snapshot TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS category_id_snapshot INTEGER;
CREATE TABLE IF NOT EXISTS order_status_history (
  id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id),
  admin_user_id BIGINT REFERENCES admin_users(id), actor_name TEXT,
  from_status TEXT, to_status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id,created_at);
CREATE OR REPLACE FUNCTION notify_admin_order_created() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('admin_order_created', json_build_object('eventId','order:'||NEW.id,'orderId',NEW.id,'orderNumber',NEW.order_number)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='admin_order_created' AND tgrelid='orders'::regclass) THEN
    CREATE TRIGGER admin_order_created AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION notify_admin_order_created();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='admin_change' AND tgrelid='admin_users'::regclass) THEN
    CREATE TRIGGER admin_change AFTER INSERT OR UPDATE OR DELETE ON admin_users FOR EACH STATEMENT EXECUTE FUNCTION notify_admin_change();
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS admin_push_deliveries (order_id BIGINT PRIMARY KEY REFERENCES orders(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE admin_push_subscriptions ADD COLUMN IF NOT EXISTS session_token_hash TEXT;
ALTER TABLE admin_push_subscriptions ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'ru';
CREATE INDEX IF NOT EXISTS idx_orders_customer_history ON orders(customer_phone,created_at);
CREATE INDEX IF NOT EXISTS idx_orders_location_created ON orders(location_id,created_at);
CREATE INDEX IF NOT EXISTS idx_order_status_history_created ON order_status_history(created_at);

-- Durable, forward-only notification history. Existing orders are not backfilled.
CREATE TABLE IF NOT EXISTS admin_order_events (
  event_id TEXT PRIMARY KEY,
  order_id BIGINT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  transaction_id BIGINT NOT NULL DEFAULT txid_current()
);
ALTER TABLE admin_order_events ADD COLUMN IF NOT EXISTS transaction_id BIGINT NOT NULL DEFAULT txid_current();
CREATE INDEX IF NOT EXISTS idx_admin_order_events_created ON admin_order_events(created_at DESC,order_id DESC);
CREATE TABLE IF NOT EXISTS admin_order_event_reads (
  admin_user_id BIGINT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES admin_order_events(event_id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(admin_user_id,event_id)
);
INSERT INTO app_migrations(key) VALUES ('2026-10-28-order-notification-history') ON CONFLICT DO NOTHING;
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['admin_audit_log','order_status_history'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='admin_change' AND tgrelid=table_name::regclass) THEN
      EXECUTE format('CREATE TRIGGER admin_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION notify_admin_change()',table_name);
    END IF;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION notify_admin_order_created() RETURNS TRIGGER AS $$
DECLARE occurred_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  INSERT INTO admin_order_events(event_id,order_id,created_at) VALUES ('order:'||NEW.id,NEW.id,occurred_at) ON CONFLICT DO NOTHING;
  PERFORM pg_notify('admin_order_created',json_build_object('eventId','order:'||NEW.id,'orderId',NEW.id,'orderNumber',NEW.order_number,'createdAt',occurred_at)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
