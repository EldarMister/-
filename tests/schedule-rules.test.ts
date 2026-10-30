import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduleOpenAt, validateWeeklySchedule, type WeeklySchedule } from "../server/schedule-rules";

const week = (): WeeklySchedule => Array.from({ length: 7 }, (_, day) => ({ day, intervals: [] }));
test("weekly schedule uses Bishkek timezone and an exclusive closing boundary", () => {
  const schedule = week(); schedule[0].intervals = [{ start: "10:00", end: "21:00" }];
  assert.equal(scheduleOpenAt(schedule, new Date("2026-10-26T03:59:59Z")), false);
  assert.equal(scheduleOpenAt(schedule, new Date("2026-10-26T04:00:00Z")), true);
  assert.equal(scheduleOpenAt(schedule, new Date("2026-10-26T15:00:00Z")), false);
});
test("overnight interval continues through the week boundary", () => {
  const schedule = week(); schedule[6].intervals = [{ start: "22:00", end: "02:00" }];
  validateWeeklySchedule(schedule);
  assert.equal(scheduleOpenAt(schedule, new Date("2026-10-25T19:30:00Z")), true);
  assert.equal(scheduleOpenAt(schedule, new Date("2026-10-25T20:00:00Z")), false);
});
test("overlap across midnight is rejected while adjacent intervals are valid", () => {
  const schedule = week(); schedule[6].intervals = [{ start: "22:00", end: "02:00" }];
  schedule[0].intervals = [{ start: "01:00", end: "03:00" }];
  assert.throws(() => validateWeeklySchedule(schedule), /пересекаются/);
  schedule[0].intervals = [{ start: "02:00", end: "03:00" }];
  assert.doesNotThrow(() => validateWeeklySchedule(schedule));
});
test("breaks, closed days and a 24-hour interval are handled explicitly", () => {
  const schedule = week(); schedule[0].intervals = [{ start: "10:00", end: "14:00" }, { start: "15:00", end: "21:00" }];
  schedule[1].intervals = [{ start: "00:00", end: "00:00" }];
  validateWeeklySchedule(schedule);
  assert.equal(scheduleOpenAt(schedule, new Date("2026-10-26T08:30:00Z")), false);
  assert.equal(scheduleOpenAt(schedule, new Date("2026-10-27T17:59:00Z")), true);
  assert.equal(scheduleOpenAt(schedule, new Date("2026-10-28T04:00:00Z")), false);
});
test("malformed days and times are rejected on the server", () => {
  assert.throws(() => validateWeeklySchedule([]), /семи/);
  const schedule = week(); schedule[1].day = 0;
  assert.throws(() => validateWeeklySchedule(schedule), /один раз/);
  const malformed = week(); malformed[0].intervals = [{ start: "25:00", end: "21:00" }];
  assert.throws(() => validateWeeklySchedule(malformed), /ЧЧ:ММ/);
});
