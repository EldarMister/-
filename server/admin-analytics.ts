import { Router } from "express";
import { sql } from "./db";

const DAY_MS = 86_400_000;
const BISHKEK_OFFSET_MS = 6 * 60 * 60 * 1_000;
export const ANALYTICS_TIMEZONE = "Asia/Bishkek";
export type AnalyticsPeriod = { from: string; to: string; start: Date; end: Date; previousStart: Date; previousEnd: Date; days: number; locationId: number | null };

function dateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Укажите дату в формате ГГГГ-ММ-ДД");
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new Error("Указана несуществующая дата");
  return timestamp;
}

export function parseAnalyticsPeriod(query: Record<string, unknown>, now = new Date()): AnalyticsPeriod {
  const today = new Date(now.getTime() + BISHKEK_OFFSET_MS).toISOString().slice(0, 10);
  const to = typeof query.to === "string" ? query.to : today;
  const toTimestamp = dateOnly(to);
  const from = typeof query.from === "string" ? query.from : new Date(toTimestamp - 29 * DAY_MS).toISOString().slice(0, 10);
  const fromTimestamp = dateOnly(from);
  const days = (toTimestamp - fromTimestamp) / DAY_MS + 1;
  if (days < 1 || days > 366) throw new Error("Выберите период от 1 до 366 дней");
  const locationValue = query.locationId;
  const locationId = locationValue === undefined || locationValue === "" ? null : Number(locationValue);
  if (locationId !== null && (!Number.isSafeInteger(locationId) || locationId < 1)) throw new Error("Выберите точку самовывоза из списка");
  const start = new Date(fromTimestamp - BISHKEK_OFFSET_MS);
  const end = new Date(toTimestamp + DAY_MS - BISHKEK_OFFSET_MS);
  return { from, to, start, end, previousStart: new Date(start.getTime() - days * DAY_MS), previousEnd: start, days, locationId };
}

export function percentageChange(current: number, previous: number): number | null {
  return previous === 0 ? (current === 0 ? 0 : null) : (current - previous) / previous * 100;
}

export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function numericRows(rows: Record<string, unknown>[], keys: string[]) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, keys.includes(key) ? Number(value) : value])));
}

export async function loadAnalytics(period: AnalyticsPeriod) {
  return sql.begin("isolation level repeatable read read only", async (tx) => {
    const locationClause = period.locationId === null ? tx`` : tx`AND o.location_id = ${period.locationId}`;
    const totals = await tx`
      SELECT CASE WHEN o.created_at >= ${period.start} THEN 'current' ELSE 'previous' END AS period,
        COUNT(*)::int AS orders,
        COUNT(*) FILTER (WHERE o.status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled,
        COUNT(*) FILTER (WHERE o.status NOT IN ('completed', 'cancelled'))::int AS active,
        COALESCE(SUM(o.total) FILTER (WHERE o.status = 'completed'), 0)::bigint AS revenue,
        COALESCE(AVG(o.total) FILTER (WHERE o.status = 'completed'), 0)::numeric AS "averageOrder"
      FROM orders o WHERE o.created_at >= ${period.previousStart} AND o.created_at < ${period.end} ${locationClause}
      GROUP BY 1`;
    const zero = { orders: 0, completed: 0, cancelled: 0, active: 0, revenue: 0, averageOrder: 0 };
    const normalizedTotals = numericRows(totals, Object.keys(zero));
    const current = { ...zero, ...normalizedTotals.find((item) => item.period === "current") };
    const previous = { ...zero, ...normalizedTotals.find((item) => item.period === "previous") };
    const daily = await tx`
      SELECT to_char(dates.day, 'YYYY-MM-DD') AS date, COUNT(o.id)::int AS orders,
        COALESCE(SUM(o.total) FILTER (WHERE o.status = 'completed'), 0)::bigint AS revenue
      FROM generate_series(${period.from}::date, ${period.to}::date, '1 day') AS dates(day)
      LEFT JOIN orders o ON (o.created_at AT TIME ZONE 'Asia/Bishkek')::date = dates.day::date
        AND o.created_at >= ${period.start} AND o.created_at < ${period.end} ${locationClause}
      GROUP BY dates.day ORDER BY dates.day`;
    const hourly = await tx`
      SELECT hours.hour, COUNT(o.id)::int AS orders,
        COALESCE(SUM(o.total) FILTER (WHERE o.status = 'completed'), 0)::bigint AS revenue
      FROM generate_series(0, 23) AS hours(hour)
      LEFT JOIN orders o ON EXTRACT(HOUR FROM o.created_at AT TIME ZONE 'Asia/Bishkek') = hours.hour
        AND o.created_at >= ${period.start} AND o.created_at < ${period.end} ${locationClause}
      GROUP BY hours.hour ORDER BY hours.hour`;
    const statuses = await tx`SELECT o.status, COUNT(*)::int AS count FROM orders o
      WHERE o.created_at >= ${period.start} AND o.created_at < ${period.end} ${locationClause} GROUP BY o.status ORDER BY o.status`;
    const products = await tx`
      SELECT oi.product_name AS name, SUM(oi.quantity)::bigint AS quantity, SUM(oi.line_total)::bigint AS revenue
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= ${period.start} AND o.created_at < ${period.end} AND o.status = 'completed' ${locationClause}
      GROUP BY oi.product_name ORDER BY quantity DESC, name LIMIT 20`;
    // The category snapshot is recorded for new orders; older orders remain explicitly unclassified.
    const categories = await tx`
      SELECT COALESCE(oi.category_name_snapshot, 'Категория не записана') AS name,
        (oi.category_name_snapshot IS NULL) AS "categoryMissing",
        SUM(oi.quantity)::bigint AS quantity, SUM(oi.line_total)::bigint AS revenue
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= ${period.start} AND o.created_at < ${period.end} AND o.status = 'completed' ${locationClause}
      GROUP BY oi.category_name_snapshot ORDER BY quantity DESC, name`;
    const [customers] = await tx`
      WITH first_orders AS (SELECT customer_phone, MIN(created_at) AS first_at FROM orders GROUP BY customer_phone),
      selected AS (SELECT DISTINCT o.customer_phone FROM orders o
        WHERE o.created_at >= ${period.start} AND o.created_at < ${period.end} ${locationClause})
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE f.first_at >= ${period.start})::int AS new,
        COUNT(*) FILTER (WHERE f.first_at < ${period.start})::int AS returning
      FROM selected s JOIN first_orders f USING (customer_phone)`;
    const locations = await tx`SELECT id, name FROM pickup_locations ORDER BY name`;
    const [coverage] = await tx`SELECT (SELECT MIN(created_at) FROM orders) AS "ordersSince",
      (SELECT applied_at FROM app_migrations WHERE key = '2026-10-25-admin-v2-access') AS "employeeActionsSince"`;
    const employees = await tx`
      SELECT COALESCE(h.actor_name, 'Сотрудник') AS name, COUNT(*)::int AS "statusChanges",
        COUNT(*) FILTER (WHERE h.to_status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE h.to_status = 'cancelled')::int AS cancelled
      FROM order_status_history h JOIN orders o ON o.id = h.order_id
      WHERE h.created_at >= ${period.start} AND h.created_at < ${period.end}
        AND h.admin_user_id IS NOT NULL ${locationClause}
      GROUP BY h.admin_user_id, h.actor_name ORDER BY "statusChanges" DESC, name`;
    return {
      filters: { from: period.from, to: period.to, locationId: period.locationId, timezone: ANALYTICS_TIMEZONE },
      comparison: { from: new Date(period.previousStart.getTime() + BISHKEK_OFFSET_MS).toISOString().slice(0, 10), to: new Date(period.previousEnd.getTime() + BISHKEK_OFFSET_MS - DAY_MS).toISOString().slice(0, 10) },
      current, previous,
      changes: Object.fromEntries(Object.keys(zero).map((key) => [key, percentageChange(Number(current[key as keyof typeof current]), Number(previous[key as keyof typeof previous]))])),
      daily: numericRows(daily, ["orders", "revenue"]), hourly: numericRows(hourly, ["hour", "orders", "revenue"]),
      statuses, products: numericRows(products, ["quantity", "revenue"]), categories: numericRows(categories, ["quantity", "revenue"]),
      customers, locations, coverage, employees,
      unavailable: [
        { key: "modifiers", label: "Модификаторы", reason: "В исходной модели модификаторы не учитываются." },
        { key: "configurations", label: "Комплектации", reason: "В исходной модели комплектации не учитываются." },
        { key: "refunds", label: "Возвраты", reason: "Отдельного учёта возвратов и оплат в исходной модели нет." },
      ],
    };
  });
}

export function analyticsCsv(report: Awaited<ReturnType<typeof loadAnalytics>>) {
  const statuses: Record<string, string> = { new: "Новый", confirmed: "Подтверждён", preparing: "Готовится", ready: "Готов", completed: "Выдан", cancelled: "Отменён" };
  const rows: unknown[][] = [["ДААНА СУШИ — аналитика", report.filters.from, report.filters.to, report.filters.timezone],
    ["Показатель", "Текущий период", "Предыдущий период"],
    ...([['orders', 'Все заказы'], ['completed', 'Завершено'], ['cancelled', 'Отменено'], ['active', 'В работе'], ['revenue', 'Выручка, С'], ['averageOrder', 'Средний чек, С']] as const).map(([key, label]) => [label, report.current[key], report.previous[key]]),
    [], ["Клиенты", "Количество"], ["Новые", report.customers.new], ["Повторные", report.customers.returning],
    [], ["Дата", "Заказы", "Выручка, С"], ...report.daily.map((row) => [row.date, row.orders, row.revenue]),
    [], ["Час", "Заказы", "Выручка, С"], ...report.hourly.map((row) => [row.hour, row.orders, row.revenue]),
    [], ["Статус", "Заказы"], ...report.statuses.map((row) => [statuses[String(row.status)] || "Неизвестный статус", row.count]),
    [], ["Товар (20 популярных)", "Количество", "Выручка, С"], ...report.products.map((row) => [row.name, row.quantity, row.revenue]),
    [], ["Категория", "Количество", "Выручка, С"], ...report.categories.map((row) => [row.name, row.quantity, row.revenue]),
    [], ["Сотрудник", "Изменений статуса", "Выдано", "Отменено"], ...report.employees.map((row) => [row.name, row.statusChanges, row.completed, row.cancelled]),
  ];
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}

const router = Router();
router.get(["/", "/export"], async (request, response) => {
  let period: AnalyticsPeriod;
  try { period = parseAnalyticsPeriod(request.query); }
  catch (error) { return response.status(400).json({ error: error instanceof Error ? error.message : "Проверьте параметры отчёта" }); }
  response.setHeader("Cache-Control", "no-store");
  const report = await loadAnalytics(period);
  if (request.path === "/export") {
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="daana-analytics-${period.from}-${period.to}.csv"`);
    return response.send(analyticsCsv(report));
  }
  response.json(report);
});
export default router;
