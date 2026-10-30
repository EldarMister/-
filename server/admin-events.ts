import type { Request, Response } from "express";
import { sql } from "./db";
import { authenticatedAdmin } from "./auth";
import { hasPermission } from "./admin-permissions";
import { sendOrderPush } from "./admin-push";

const streams = new Map<Response, Request>();
const tablePermissions: Record<string, string[]> = {
  orders: ["orders.view", "dashboard.view", "analytics.view", "users.view"],
  order_items: ["orders.view", "analytics.view"],
  products: [
    "products.view",
    "dashboard.view",
    "analytics.view",
    "loyalty.view",
  ],
  categories: [
    "categories.view",
    "products.view",
    "dashboard.view",
    "analytics.view",
  ],
  pickup_locations: [
    "locations.view",
    "schedules.view",
    "orders.view",
    "analytics.view",
  ],
  location_schedules: ["schedules.view", "locations.view"],
  promotions: ["promotions.view"],
  site_settings: ["settings.view", "loyalty.view"],
  customers: ["users.view", "analytics.view"],
  nakta_coin_transactions: ["loyalty.view", "users.view"],
  nakta_coin_withdrawals: ["loyalty.view", "users.view"],
  account_nfts: ["loyalty.view", "users.view"],
  customer_reward_adjustments: ["loyalty.view", "users.view"],
  admin_audit_log: ["audit.view", "analytics.view"],
  order_status_history: ["audit.view", "analytics.view", "orders.view"],
};
async function send(
  response: Response,
  request: Request,
  event: string,
  data: unknown,
  required: string[] = [],
  recipientId?: number,
) {
  const user = await authenticatedAdmin(request);
  if (!user) {
    response.write("event: access-changed\ndata: {}\n\n");
    response.end();
    return;
  }
  if (required.length && !required.some((p) => hasPermission(user, p))) return;
  if (recipientId !== undefined && user.id !== recipientId) return;
  const id =
    event === "order-created" && data && typeof data === "object"
      ? String((data as { eventId: string }).eventId)
      : "";
  if (
    !response.write(
      `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    )
  )
    response.end();
}
export async function startAdminEvents() {
  await sql.listen("admin_changes", async (table) => {
    await Promise.allSettled(
      [...streams].map(([response, request]) =>
        send(
          response,
          request,
          table === "admin_users" ? "access-changed" : "change",
          {},
          table === "admin_users"
            ? []
            : tablePermissions[table] || ["__denied__"],
        ),
      ),
    );
  });
  await sql.listen("admin_order_created", async (payload) => {
    let event: {
      orderId: string | number;
      orderNumber: string;
      eventId: string;
    };
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    await Promise.allSettled(
      [...streams].map(([response, request]) =>
        send(response, request, "order-created", event, ["orders.view"]),
      ),
    );
    void sendOrderPush(event).catch(() =>
      console.warn("Order push dispatch failed"),
    );
  });
  await sql.listen("admin_notification_reads", async (recipient) => {
    const recipientId = Number(recipient);
    if (!Number.isSafeInteger(recipientId) || recipientId < 1) return;
    await Promise.allSettled(
      [...streams].map(([response, request]) =>
        send(
          response,
          request,
          "notification-read",
          {},
          ["orders.view"],
          recipientId,
        ),
      ),
    );
  });
}
export function streamAdminEvents(request: Request, response: Response) {
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();
  streams.set(response, request);
  response.write("retry: 2000\nevent: change\ndata: {}\n\n");
  const heartbeat = setInterval(() => {
    void send(response, request, "heartbeat", {}).catch(() => response.end());
  }, 10_000);
  response.on("close", () => {
    streams.delete(response);
    clearInterval(heartbeat);
  });
}
export function closeAdminEvents() {
  for (const response of streams.keys()) response.end();
  streams.clear();
}
