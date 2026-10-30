import assert from "node:assert/strict";
import test from "node:test";
import { analyticsCsv, csvCell, parseAnalyticsPeriod, percentageChange } from "../server/admin-analytics";

test("analytics uses inclusive local dates with an exclusive next-day boundary", () => {
  const period = parseAnalyticsPeriod({ from: "2026-10-01", to: "2026-10-25", locationId: "4" });
  assert.equal(period.start.toISOString(), "2026-09-30T18:00:00.000Z");
  assert.equal(period.end.toISOString(), "2026-10-25T18:00:00.000Z");
  assert.equal(period.days, 25);
  assert.equal(period.locationId, 4);
  assert.equal(period.previousStart.toISOString(), "2026-09-05T18:00:00.000Z");
  assert.equal(period.previousEnd.toISOString(), period.start.toISOString());
});

test("default reporting day follows Bishkek, including UTC date rollover", () => {
  const period = parseAnalyticsPeriod({}, new Date("2026-10-24T20:00:00.000Z"));
  assert.equal(period.to, "2026-10-25");
  assert.equal(period.from, "2026-09-26");
  assert.equal(period.days, 30);
});

test("previous comparison preserves the number of days across leap day", () => {
  const period = parseAnalyticsPeriod({ from: "2024-02-29", to: "2024-03-01" });
  assert.equal(period.days, 2);
  assert.equal(period.previousStart.toISOString(), "2024-02-26T18:00:00.000Z");
  assert.equal(period.end.getTime() - period.start.getTime(), period.previousEnd.getTime() - period.previousStart.getTime());
});

test("invalid dates, inverted dates and unbounded analytics are rejected", () => {
  for (const query of [
    { from: "2026-02-29", to: "2026-03-01" },
    { from: "2026-13-01", to: "2026-13-02" },
    { from: "2026-10-26", to: "2026-10-25" },
    { from: "2024-01-01", to: "2026-10-25" },
    { from: "01/10/2026", to: "2026-10-25" },
  ]) assert.throws(() => parseAnalyticsPeriod(query));
});

test("location filters cannot inject SQL or include fractional and negative identifiers", () => {
  for (const locationId of ["1 OR 1=1", "0", "-1", "1.5", "Infinity", "not-a-location"]) {
    assert.throws(() => parseAnalyticsPeriod({ from: "2026-10-01", to: "2026-10-25", locationId }));
  }
  assert.equal(parseAnalyticsPeriod({ locationId: "" }).locationId, null);
});

test("comparison distinguishes a zero baseline from zero growth", () => {
  assert.equal(percentageChange(150, 100), 50);
  assert.equal(percentageChange(50, 100), -50);
  assert.equal(percentageChange(0, 0), 0);
  assert.equal(percentageChange(100, 0), null);
  assert.equal(percentageChange(0, 100), -100);
});

test("CSV preserves Russian text, quotes and separators and prevents spreadsheet formulas", () => {
  assert.equal(csvCell('Ролл "Филадельфия"; сет'), '"Ролл ""Филадельфия""; сет"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(125), '"125"');
  assert.equal(csvCell('=HYPERLINK("https://invalid.example")'), '"\'=HYPERLINK(""https://invalid.example"")"');
  assert.equal(csvCell("  +SUM(A1:A2)"), '"\'  +SUM(A1:A2)"');
});

test("export contains the same totals and daily records as the displayed server report", () => {
  const current = { orders: 3, completed: 1, cancelled: 1, active: 1, revenue: 525, averageOrder: 525 };
  const previous = { orders: 2, completed: 2, cancelled: 0, active: 0, revenue: 800, averageOrder: 400 };
  const report = {
    filters: { from: "2026-10-25", to: "2026-10-25", timezone: "Asia/Bishkek" }, current, previous,
    customers: { new: 1, returning: 2 }, daily: [{ date: "2026-10-25", orders: 3, revenue: 525 }],
    hourly: [{ hour: 10, orders: 3, revenue: 525 }], statuses: [{ status: "completed", count: 1 }], products: [], categories: [], employees: [],
  } as unknown as Parameters<typeof analyticsCsv>[0];
  const output = analyticsCsv(report);
  assert.ok(output.startsWith("\uFEFF"));
  assert.ok(output.includes('"Выручка, С";"525";"800"'));
  assert.ok(output.includes('"Средний чек, С";"525";"400"'));
  assert.ok(output.includes('"2026-10-25";"3";"525"'));
});
