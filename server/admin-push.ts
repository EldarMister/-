import { Router } from "express";
import webpush from "web-push";
import { sql } from "./db";
import {
  effectivePermissions,
  hasPermission,
  type AdminRole,
} from "./admin-permissions";
import { currentAdminSessionHash } from "./auth";

const router = Router();
const supportedLocales = new Set(["ru", "ky", "en", "kk", "uz"]);
const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || "";
const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
const subject = process.env.VAPID_SUBJECT?.trim() || "";
const configured = Boolean(
  publicKey && privateKey && /^(mailto:|https:\/\/)/.test(subject),
);
if (configured) webpush.setVapidDetails(subject, publicKey, privateKey);
router.get("/public-key", (_req, res) =>
  res.json({ publicKey: configured ? publicKey : "", configured }),
);
router.post("/subscriptions/status", async (req, res) => {
  if (!hasPermission(res.locals.admin, "orders.view"))
    return res
      .status(403)
      .json({ error: "Нет доступа к уведомлениям о заказах" });
  const endpoint = req.body.endpoint;
  if (typeof endpoint !== "string" || endpoint.length > 6000)
    return res.status(400).json({ error: "Укажите подписку этого устройства" });
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return res.status(400).json({ error: "Некорректная подписка устройства" });
  }
  if (url.protocol !== "https:" || url.username || url.password)
    return res.status(400).json({ error: "Некорректная подписка устройства" });
  if (req.body.locale !== undefined && !supportedLocales.has(req.body.locale))
    return res.status(400).json({ error: "Выберите поддерживаемый язык" });
  if (req.body.locale)
    await sql`UPDATE admin_push_subscriptions SET locale=${req.body.locale} WHERE endpoint=${endpoint} AND admin_user_id=${res.locals.admin.id}`;
  const [binding] =
    await sql`SELECT endpoint FROM admin_push_subscriptions WHERE endpoint=${endpoint} AND admin_user_id=${res.locals.admin.id}`;
  res.json({ subscribed: Boolean(binding), configured });
});
router.post("/subscriptions", async (req, res) => {
  if (!hasPermission(res.locals.admin, "orders.view"))
    return res
      .status(403)
      .json({ error: "Нет доступа к уведомлениям о заказах" });
  if (!configured)
    return res
      .status(503)
      .json({ error: "Системные уведомления не настроены на сервере" });
  const subscription = req.body.subscription as webpush.PushSubscription;
  const locale = supportedLocales.has(req.body.locale) ? req.body.locale : "ru";
  let endpoint: URL;
  try {
    endpoint = new URL(subscription.endpoint);
  } catch {
    return res.status(400).json({ error: "Некорректная подписка" });
  }
  const pushHosts = [
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
    "web.push.apple.com",
    "push.services.mozilla.com",
    "wns.windows.com",
    "notify.windows.com",
  ];
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    !pushHosts.some(
      (host) =>
        endpoint.hostname === host || endpoint.hostname.endsWith(`.${host}`),
    ) ||
    !subscription.keys?.p256dh ||
    !subscription.keys?.auth ||
    JSON.stringify(subscription).length > 6000
  )
    return res.status(400).json({ error: "Некорректная подписка уведомлений" });
  await sql`INSERT INTO admin_push_subscriptions(endpoint,admin_user_id,subscription,session_token_hash,locale) VALUES (${endpoint.href},${res.locals.admin.id},${sql.json(subscription as never)},${currentAdminSessionHash(req)},${locale}) ON CONFLICT(endpoint) DO UPDATE SET admin_user_id=EXCLUDED.admin_user_id,subscription=EXCLUDED.subscription,session_token_hash=EXCLUDED.session_token_hash,locale=EXCLUDED.locale,updated_at=NOW()`;
  res.status(201).json({ subscribed: true });
});
router.delete("/subscriptions", async (req, res) => {
  await sql`DELETE FROM admin_push_subscriptions WHERE endpoint=${String(req.body.endpoint || "")} AND admin_user_id=${res.locals.admin.id}`;
  res.json({ subscribed: false });
});
export async function sendOrderPush(event: {
  orderId: string | number;
  orderNumber: string;
  eventId: string;
}) {
  if (!configured) return;
  const [claim] =
    await sql`INSERT INTO admin_push_deliveries(order_id) VALUES (${event.orderId}) ON CONFLICT DO NOTHING RETURNING order_id`;
  if (!claim) return;
  const subscriptions =
    await sql`SELECT p.endpoint,p.subscription,p.locale,u.id FROM admin_push_subscriptions p JOIN admin_users u ON u.id=p.admin_user_id WHERE u.active=TRUE`;
  for (const row of subscriptions) {
    const [user] =
      await sql`SELECT role,permission_overrides FROM admin_users WHERE id=${row.id} AND active=TRUE`;
    if (
      !user ||
      !effectivePermissions(
        user.role as AdminRole,
        user.permission_overrides,
      ).includes("orders.view")
    )
      continue;
    try {
      await webpush.sendNotification(
        row.subscription,
        JSON.stringify({
          eventId: event.eventId,
          orderId: event.orderId,
          locale: row.locale,
          tag: event.eventId,
        }),
        { TTL: 300 },
      );
    } catch (error) {
      if (
        [404, 410].includes(
          Number((error as { statusCode?: number }).statusCode),
        )
      )
        await sql`DELETE FROM admin_push_subscriptions WHERE endpoint=${row.endpoint}`;
      else
        console.warn(
          "Order push delivery failed",
          (error as { statusCode?: number }).statusCode || "network",
        );
    }
  }
}
export default router;
