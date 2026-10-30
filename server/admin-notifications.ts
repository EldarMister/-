import { Router } from "express";
import { sql } from "./db";
import { hasPermission } from "./admin-permissions";

const router = Router();
function snapshot(value: unknown) {
  if (value === undefined) return null;
  if (
    typeof value !== "string" ||
    value.length > 16000 ||
    !/^\d+:\d+:[\d,]*$/.test(value)
  ) {
    throw Object.assign(new Error("Обновите список уведомлений"), {
      status: 400,
    });
  }
  return value;
}
router.use((_request, response, next) => {
  if (!hasPermission(response.locals.admin, "orders.view"))
    return response
      .status(403)
      .json({ error: "Нет доступа к уведомлениям о заказах" });
  response.setHeader("Cache-Control", "no-store");
  next();
});
router.get("/", async (request, response) => {
  const limit = Math.min(
    100,
    Math.max(1, Math.trunc(Number(request.query.limit) || 50)),
  );
  const offset = Math.max(0, Math.trunc(Number(request.query.offset) || 0));
  if (!Number.isSafeInteger(offset))
    return response
      .status(400)
      .json({ error: "Некорректная страница уведомлений" });
  const since = snapshot(request.query.sinceSnapshot);
  const until = snapshot(request.query.untilSnapshot);
  const result = await sql.begin(
    "isolation level repeatable read read only",
    async (tx) => {
      const [current] = await tx`SELECT txid_current_snapshot()::text AS value`;
      const upper = until || current.value;
      // Visibility snapshots include in-flight transactions. A late commit is
      // delivered on the next sync even if its order ID predates the last page.
      const visible = tx`txid_visible_in_snapshot(e.transaction_id,${upper}::txid_snapshot)`;
      const delta = tx`${visible} AND (${since === null} OR NOT txid_visible_in_snapshot(e.transaction_id,${since || upper}::txid_snapshot))`;
      const items =
        await tx`SELECT e.event_id AS "eventId",e.order_id AS "orderId",o.order_number AS "orderNumber",o.status,e.created_at AS "createdAt",(r.event_id IS NOT NULL) AS read
      FROM admin_order_events e JOIN orders o ON o.id=e.order_id
      LEFT JOIN admin_order_event_reads r ON r.event_id=e.event_id AND r.admin_user_id=${response.locals.admin.id}
      WHERE ${delta} ORDER BY e.created_at DESC,e.order_id DESC LIMIT ${limit} OFFSET ${offset}`;
      const [counts] =
        await tx`SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM admin_order_event_reads r WHERE r.event_id=e.event_id AND r.admin_user_id=${response.locals.admin.id}))::int AS unread FROM admin_order_events e WHERE ${visible}`;
      const [changes] =
        await tx`SELECT COUNT(*)::int AS total FROM admin_order_events e WHERE ${delta}`;
      const [migration] =
        await tx`SELECT applied_at FROM app_migrations WHERE key='2026-10-28-order-notification-history'`;
      return {
        items: items.map((item) => ({
          ...item,
          orderId: Number(item.orderId),
        })),
        total: counts.total,
        unread: counts.unread,
        deltaTotal: changes.total,
        snapshot: upper,
        limit,
        offset,
        collectedSince: migration?.applied_at || null,
      };
    },
  );
  response.json(result);
});
router.post("/read", async (request, response) => {
  const all = request.body.all === true;
  const ids = request.body.eventIds;
  const captured = all ? snapshot(request.body.snapshot) : null;
  if (all && !captured)
    return response
      .status(400)
      .json({ error: "Обновите уведомления перед отметкой прочтения" });
  if (
    !all &&
    (!Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 100 ||
      ids.some((id) => typeof id !== "string" || !/^order:[1-9]\d*$/.test(id)))
  )
    return response
      .status(400)
      .json({ error: "Выберите уведомления для отметки прочтения" });
  await sql.begin(async (tx) => {
    if (all)
      await tx`INSERT INTO admin_order_event_reads(admin_user_id,event_id) SELECT ${response.locals.admin.id},event_id FROM admin_order_events WHERE txid_visible_in_snapshot(transaction_id,${captured}::txid_snapshot) ON CONFLICT DO NOTHING`;
    else
      await tx`INSERT INTO admin_order_event_reads(admin_user_id,event_id) SELECT ${response.locals.admin.id},event_id FROM admin_order_events WHERE event_id IN ${tx(ids)} ON CONFLICT DO NOTHING`;
    await tx`SELECT pg_notify('admin_notification_reads',${String(response.locals.admin.id)})`;
  });
  response.json({ ok: true });
});
export default router;
