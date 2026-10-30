export type WorkInterval = { start: string; end: string };
export type WorkDay = { day: number; intervals: WorkInterval[] };
export type WeeklySchedule = WorkDay[];
export const scheduleTimezone = "Asia/Bishkek";
const DAY = 1440;
const WEEK = 7 * DAY;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const invalid = (message: string): never => { throw Object.assign(new Error(message), { status: 400 }); };

export function defaultWeeklySchedule(): WeeklySchedule {
  return Array.from({ length: 7 }, (_, day) => ({ day, intervals: [{ start: "10:00", end: "21:00" }] }));
}

function spans(schedule: WeeklySchedule) {
  return schedule.flatMap(({ day, intervals }) => intervals.map(({ start, end }) => {
    const from = day * DAY + minutes(start);
    const duration = minutes(end) - minutes(start);
    return { from, to: from + (duration <= 0 ? duration + DAY : duration) };
  }));
}

export function validateWeeklySchedule(value: unknown): WeeklySchedule {
  if (!Array.isArray(value) || value.length !== 7) invalid("Укажите расписание для всех семи дней недели.");
  const supplied = value as unknown[];
  const seen = new Set<number>();
  const result = supplied.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid("Проверьте день недели.");
    const item = raw as Record<string, unknown>;
    if (!Number.isInteger(item.day) || Number(item.day) < 0 || Number(item.day) > 6 || seen.has(Number(item.day))) invalid("Каждый день недели должен быть указан один раз.");
    const day = Number(item.day); seen.add(day);
    if (!Array.isArray(item.intervals) || item.intervals.length > 6) invalid("Укажите не более шести рабочих интервалов в день.");
    const intervals = (item.intervals as unknown[]).map((rawInterval) => {
      if (!rawInterval || typeof rawInterval !== "object" || Array.isArray(rawInterval)) invalid("Проверьте рабочий интервал.");
      const interval = rawInterval as Record<string, unknown>;
      if (typeof interval.start !== "string" || typeof interval.end !== "string" || !timePattern.test(interval.start) || !timePattern.test(interval.end)) invalid("Укажите время в формате ЧЧ:ММ.");
      return { start: interval.start as string, end: interval.end as string };
    });
    return { day, intervals };
  }).sort((left, right) => left.day - right.day);
  const normalized = spans(result).flatMap((span) => span.to <= WEEK ? [span] : [{ from: span.from, to: WEEK }, { from: 0, to: span.to - WEEK }]).sort((a, b) => a.from - b.from);
  for (let index = 1; index < normalized.length; index++) {
    if (normalized[index].from < normalized[index - 1].to) invalid("Рабочие интервалы пересекаются. Учитывайте переход через полночь и начало следующего дня.");
  }
  return result;
}

export function scheduleOpenAt(schedule: WeeklySchedule, at = new Date()) {
  if (Number.isNaN(at.getTime())) throw new Error("Некорректная дата проверки расписания");
  const values = new Intl.DateTimeFormat("en-GB", { timeZone: scheduleTimezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => values.find((value) => value.type === type)?.value || "";
  const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(part("weekday"));
  const point = day * DAY + Number(part("hour")) * 60 + Number(part("minute"));
  return spans(schedule).some(({ from, to }) => point >= from && point < to || point + WEEK >= from && point + WEEK < to);
}
