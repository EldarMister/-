CREATE TABLE IF NOT EXISTS location_schedules (
  location_id INTEGER PRIMARY KEY REFERENCES pickup_locations(id) ON DELETE RESTRICT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Bishkek' CHECK (timezone = 'Asia/Bishkek'),
  weekly JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='admin_change' AND tgrelid='location_schedules'::regclass) THEN
    CREATE TRIGGER admin_change AFTER INSERT OR UPDATE OR DELETE ON location_schedules FOR EACH STATEMENT EXECUTE FUNCTION notify_admin_change();
  END IF;
END $$;
