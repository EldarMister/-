import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import test from "node:test";
import postgres from "postgres";

const controlUrl = process.env.ADMIN_NOTIFICATIONS_TEST_DATABASE_URL;
test(
  "durable notifications paginate missed orders, include late commits and keep read state private",
  { skip: !controlUrl, timeout: 180000 },
  async (context) => {
    const databaseUrl = new URL(controlUrl);
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname),
    );
    assert.match(
      databaseUrl.pathname,
      /^\/(?:sushi|daana)_admin_test_[a-z0-9_]+$/,
    );
    const name = `sushi_admin_test_notifications_${Date.now()}_${process.pid}`;
    const control = postgres(controlUrl, { max: 1, onnotice: () => {} });
    await control.unsafe(`CREATE DATABASE "${name}"`);
    databaseUrl.pathname = `/${name}`;
    const fixture = postgres(databaseUrl.toString(), {
      max: 3,
      onnotice: () => {},
    });
    const listener = createServer().listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const base = `http://127.0.0.1:${port}/api`;
    const password = "NotificationsFixturePassword2026!";
    const api = spawn(
      process.execPath,
      ["--import", "tsx", "server/index.ts"],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        windowsHide: true,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl.toString(),
          ADMIN_PASSWORD: password,
          JWT_SECRET: "notification-fixture-only-jwt-secret-2026",
          NODE_ENV: "production",
          API_HOST: "127.0.0.1",
          PORT: String(port),
          TRUST_PROXY: "loopback",
          CORS_ORIGIN: "",
          NIKITA_OTP_API_KEY: "",
          NFT_TRANSFER_WEBHOOK_URL: "",
          NFT_TRANSFER_WEBHOOK_TOKEN: "",
          VAPID_PRIVATE_KEY: "",
          VAPID_PUBLIC_KEY: "",
        },
      },
    );
    let logs = "";
    api.stdout.on("data", (chunk) => {
      logs += chunk;
    });
    api.stderr.on("data", (chunk) => {
      logs += chunk;
    });
    context.after(async () => {
      if (api.exitCode === null) {
        const stopped = once(api, "exit");
        api.kill("SIGTERM");
        await stopped;
      }
      await fixture.end({ timeout: 5 });
      await control.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      await control.end({ timeout: 5 });
    });
    const deadline = Date.now() + 60000;
    while (true) {
      assert.equal(api.exitCode, null, logs);
      try {
        if ((await fetch(`${base}/health`)).ok) break;
      } catch {
        /* Wait for the isolated schema. */
      }
      if (Date.now() > deadline) assert.fail(logs);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const client = () => {
      let cookie = "";
      return async (path, { expected = 200, ...options } = {}) => {
        const response = await fetch(`${base}${path}`, {
          ...options,
          headers: {
            ...(cookie ? { cookie } : {}),
            ...(options.body ? { "Content-Type": "application/json" } : {}),
          },
        });
        const next = response.headers.get("set-cookie");
        if (next) cookie = next.split(";", 1)[0];
        const body = await response.json().catch(() => ({}));
        assert.equal(
          response.status,
          expected,
          `${path}: ${JSON.stringify(body)}`,
        );
        if (path.startsWith("/admin/notifications"))
          assert.match(response.headers.get("cache-control"), /no-store/);
        return body;
      };
    };
    const owner = client();
    const manager = client();
    await owner("/admin/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    const employee = await owner("/admin/staff", {
      method: "POST",
      expected: 201,
      body: JSON.stringify({
        name: "Проверка уведомлений",
        email: "notification-manager@example.test",
        password,
        role: "MANAGER",
      }),
    });
    await manager("/admin/login", {
      method: "POST",
      body: JSON.stringify({ email: employee.email, password }),
    });
    const [location] =
      await fixture`SELECT id FROM pickup_locations WHERE active AND deleted_at IS NULL LIMIT 1`;
    let release;
    let ready;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const inserted = new Promise((resolve) => {
      ready = resolve;
    });
    let lateId;
    const late = fixture.begin(async (tx) => {
      const [row] =
        await tx`INSERT INTO orders(order_number,customer_name,customer_phone,location_id,total) VALUES ('NOTIFY-LATE','Проверка','996555000029',${location.id},100) RETURNING id`;
      lateId = Number(row.id);
      ready();
      await gate;
    });
    try {
      await inserted;
      const initial = await manager("/admin/notifications?limit=100");
      assert.equal(initial.total, 0, "an uncommitted order is never delivered");
      const batch =
        await fixture`INSERT INTO orders(order_number,customer_name,customer_phone,location_id,total) SELECT 'NOTIFY-'||g::text,'Проверка','996555000029',${location.id},100 FROM generate_series(1,150) g RETURNING id`;
      const first = await manager(
        `/admin/notifications?${new URLSearchParams({ limit: "100", sinceSnapshot: initial.snapshot })}`,
      );
      assert.equal(first.deltaTotal, 150);
      assert.equal(first.items.length, 100);
      const second = await manager(
        `/admin/notifications?${new URLSearchParams({ limit: "100", offset: "100", sinceSnapshot: initial.snapshot, untilSnapshot: first.snapshot })}`,
      );
      assert.equal(second.items.length, 50);
      const delivered = new Set(
        [...first.items, ...second.items].map((item) => item.orderId),
      );
      assert.equal(delivered.size, 150);
      for (const row of batch) assert.ok(delivered.has(Number(row.id)));
      for (const item of first.items) {
        assert.equal(item.eventId, `order:${item.orderId}`);
        assert.equal("customerPhone" in item, false);
        assert.equal("customerName" in item, false);
      }
      release();
      await late;
      const missed = await manager(
        `/admin/notifications?${new URLSearchParams({ sinceSnapshot: first.snapshot })}`,
      );
      assert.equal(missed.deltaTotal, 1);
      assert.equal(
        missed.items[0].orderId,
        lateId,
        "older IDs committed later must still be delivered",
      );
      await manager("/admin/notifications/read", {
        method: "POST",
        body: JSON.stringify({ all: true, snapshot: first.snapshot }),
      });
      const stillUnread = await manager(
        `/admin/notifications?${new URLSearchParams({ sinceSnapshot: first.snapshot })}`,
      );
      assert.equal(stillUnread.unread, 1);
      assert.equal(
        stillUnread.items[0].read,
        false,
        "read-all cannot consume an order outside the displayed snapshot",
      );
      await manager("/admin/notifications/read", {
        method: "POST",
        body: JSON.stringify({ eventIds: [`order:${lateId}`] }),
      });
      await manager("/admin/logout", { method: "POST" });
      await manager("/admin/login", {
        method: "POST",
        body: JSON.stringify({ email: employee.email, password }),
      });
      const restored = await manager("/admin/notifications");
      assert.equal(restored.unread, 0, "read state survives a new login");
      const ownerFeed = await owner("/admin/notifications");
      assert.equal(
        ownerFeed.unread,
        151,
        "another employee's read state remains independent",
      );
      await owner(`/admin/staff/${employee.id}/access`, {
        method: "PUT",
        body: JSON.stringify({
          role: "MANAGER",
          permissions: { "orders.view": false },
        }),
      });
      await manager("/admin/notifications", { expected: 403 });
      await manager("/admin/notifications/read", {
        method: "POST",
        expected: 403,
        body: JSON.stringify({ all: true, snapshot: first.snapshot }),
      });
    } finally {
      release();
      await late;
    }
  },
);
