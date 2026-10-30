import { Router } from "express";
import { sql } from "./db";
import { defaultWeeklySchedule, scheduleOpenAt, scheduleTimezone, validateWeeklySchedule } from "./schedule-rules";

const router = Router();
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };

export async function isLocationOpen(connection: Pick<typeof sql, "unsafe">, locationId: number, at = new Date()): Promise<boolean | null> {
  const rows = await connection.unsafe("SELECT enabled,weekly FROM location_schedules WHERE location_id = $1 FOR SHARE", [locationId]);
  const row = rows[0];
  if (!row || row.enabled !== true) return null;
  return scheduleOpenAt(validateWeeklySchedule(row.weekly), at);
}

router.get("/", async (request, response) => {
  const requestedLimit = Number(request.query.limit ?? 24);
  const offset = Number(request.query.offset ?? 0);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || !Number.isSafeInteger(offset) || offset < 0) fail(400, "Проверьте номер и размер страницы.");
  const limit = Math.min(100, requestedLimit);
  const search = String(request.query.search || "").trim().slice(0, 200);
  const rows = await sql`SELECT l.id AS "locationId", l.name, l.address, l.hours AS "legacyHours", COALESCE(s.enabled,FALSE) AS enabled,
    COALESCE(s.timezone,'Asia/Bishkek') AS timezone, COALESCE(s.version,0) AS version, s.weekly, s.updated_at AS "updatedAt"
    FROM pickup_locations l LEFT JOIN location_schedules s ON s.location_id=l.id
    WHERE l.deleted_at IS NULL AND (${search}='' OR l.name ILIKE ${`%${search}%`} OR l.address ILIKE ${`%${search}%`})
    ORDER BY l.name,l.id LIMIT ${limit} OFFSET ${offset}`;
  const [count] = await sql`SELECT COUNT(*)::int AS total FROM pickup_locations WHERE deleted_at IS NULL AND (${search}='' OR name ILIKE ${`%${search}%`} OR address ILIKE ${`%${search}%`})`;
  response.json({ items: rows.map((row) => ({ ...row, weekly: Array.isArray(row.weekly) && row.weekly.length === 7 ? row.weekly : defaultWeeklySchedule() })), total: count.total, limit, offset });
});

router.put("/:locationId", async (request, response) => {
  const locationId = Number(request.params.locationId);
  if (!Number.isSafeInteger(locationId) || locationId < 1 || locationId > 2_147_483_647) fail(400, "Выберите точку самовывоза.");
  if (typeof request.body.enabled !== "boolean") fail(400, "Укажите, включено ли недельное расписание.");
  if (!Number.isSafeInteger(request.body.version) || request.body.version < 0) fail(400, "Обновите расписание перед сохранением.");
  if (request.body.timezone !== undefined && request.body.timezone !== scheduleTimezone) fail(400, "Расписание использует часовой пояс Бишкек.");
  const weekly = validateWeeklySchedule(request.body.weekly);
  const result = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(82725,${locationId})`;
    const [location] = await tx`SELECT id FROM pickup_locations WHERE id=${locationId} AND deleted_at IS NULL FOR UPDATE`;
    if (!location) fail(404, "Точка самовывоза не найдена.");
    const [current] = await tx`SELECT version FROM location_schedules WHERE location_id=${locationId} FOR UPDATE`;
    if (Number(current?.version || 0) !== request.body.version) fail(409, "Расписание уже изменил другой сотрудник. Закройте редактор и обновите список.");
    const [saved] = await tx`INSERT INTO location_schedules(location_id,enabled,timezone,weekly,updated_by)
      VALUES (${locationId},${request.body.enabled},${scheduleTimezone},${tx.json(weekly)},${response.locals.admin.id})
      ON CONFLICT(location_id) DO UPDATE SET enabled=EXCLUDED.enabled,weekly=EXCLUDED.weekly,version=location_schedules.version+1,updated_by=EXCLUDED.updated_by,updated_at=NOW()
      RETURNING location_id AS "locationId",enabled,timezone,weekly,version,updated_at AS "updatedAt"`;
    await tx`INSERT INTO admin_audit_log(admin_user_id,actor_name,action,target,details) VALUES (${response.locals.admin.id},${response.locals.admin.name},'schedules.edit',${String(locationId)},${tx.json({ enabled: request.body.enabled, weekly })})`;
    return saved;
  });
  response.json(result);
});

export default router;
