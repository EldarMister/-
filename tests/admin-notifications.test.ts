import test from "node:test";
import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import {
  claimNotification,
  claimNotificationInDatabase,
  claimNotificationBatchInDatabase,
  mergeOrderNotices,
  parseOrderEvent,
  readNotificationPrefix,
  type NotificationFeed,
} from "../app/admin/notification-dedupe";

test("one stable order event is claimed once across render, reconnect and tabs", () => {
  const shared = { ids: [] as string[] };
  assert.equal(claimNotification(shared, "order:421"), true);
  assert.equal(claimNotification(shared, "order:421"), false);
  const otherTab = JSON.parse(JSON.stringify(shared));
  assert.equal(claimNotification(otherTab, "order:421"), false);
  assert.equal(claimNotification(otherTab, "order:422"), true);
});
test("notification storage is bounded", () => {
  const state = { ids: [] as string[] };
  for (let index = 0; index < 230; index++)
    claimNotification(state, `order:${index}`);
  assert.equal(state.ids.length, 200);
  assert.equal(claimNotification(state, "order:229"), false);
  assert.equal(claimNotification(state, ""), false);
});
test("malformed realtime events never produce an order notification", () => {
  for (const value of [
    "bad-json",
    "{}",
    '{"eventId":"order:x","orderId":-1,"orderNumber":"1"}',
    '{"eventId":"x","orderId":2.5,"orderNumber":"1"}',
  ])
    assert.equal(parseOrderEvent(value), null);
  assert.deepEqual(
    parseOrderEvent('{"eventId":"order:4","orderId":"4","orderNumber":"D-4"}'),
    { eventId: "order:4", orderId: 4, orderNumber: "D-4" },
  );
});

test("IndexedDB fallback atomically grants one sound across concurrent tabs", async () => {
  globalThis.indexedDB = indexedDB;
  const attempts = await Promise.all(
    Array.from({ length: 12 }, () =>
      claimNotificationInDatabase("employee:1", "order:801"),
    ),
  );
  assert.equal(attempts.filter(Boolean).length, 1);
  assert.equal(
    await claimNotificationInDatabase("employee:1", "order:801"),
    false,
  );
  assert.equal(
    await claimNotificationInDatabase("employee:1", "order:802"),
    true,
  );
  assert.equal(
    await claimNotificationInDatabase("employee:2", "order:801"),
    true,
  );
});

test("a reconnect batch is claimed atomically once, including every missed order", async () => {
  globalThis.indexedDB = indexedDB;
  const events = Array.from(
    { length: 150 },
    (_, index) => `order:${9000 + index}`,
  );
  const tabs = await Promise.all(
    Array.from({ length: 8 }, () =>
      claimNotificationBatchInDatabase("batch-employee:1", events),
    ),
  );
  assert.equal(tabs.filter((ids) => ids.length > 0).length, 1);
  assert.deepEqual(
    tabs.find((ids) => ids.length > 0),
    events,
  );
  assert.deepEqual(
    await claimNotificationBatchInDatabase("batch-employee:1", events),
    [],
  );
  assert.deepEqual(
    await claimNotificationBatchInDatabase("batch-employee:2", events),
    events,
  );
});

test("notification history updates read state without duplicates and validates order identity", () => {
  const original = {
    eventId: "order:71",
    orderId: 71,
    orderNumber: "D-71",
    createdAt: "2026-10-28T01:00:00Z",
    read: false,
  };
  const merged = mergeOrderNotices(
    [original],
    [
      { ...original, read: true },
      {
        eventId: "order:72",
        orderId: 72,
        orderNumber: "D-72",
        createdAt: "2026-10-28T02:00:00Z",
        read: false,
      },
    ],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].orderId, 72);
  assert.equal(merged[1].read, true);
  assert.equal(
    parseOrderEvent(
      '{"eventId":"order:999","orderId":71,"orderNumber":"D-71"}',
    ),
    null,
  );
});

test("history refresh pins the full loaded prefix despite live insertions and remote reads", async () => {
  const original = Array.from({ length: 200 }, (_, index) => ({
    eventId: `order:${200 - index}`,
    orderId: 200 - index,
    orderNumber: `D-${200 - index}`,
    createdAt: new Date(Date.UTC(2026, 9, 28, 0, index)).toISOString(),
    read: false,
  }));
  // This SSE row is present in the browser, but lies outside the pinned page.
  const outside = {
    ...original[0],
    eventId: "order:201",
    orderId: 201,
    orderNumber: "D-201",
    createdAt: "2026-10-29T00:00:00Z",
  };
  const paths: string[] = [];
  const server = async <T>(path: string): Promise<T> => {
    paths.push(path);
    const query = new URL(path, "https://example.test/").searchParams;
    assert.equal(query.get("untilSnapshot"), "1:2:");
    const offset = Number(query.get("offset"));
    const limit = Number(query.get("limit"));
    const data: NotificationFeed = {
      items: original
        .slice(offset, offset + limit)
        .map((item) => (item.orderId === 70 ? { ...item, read: true } : item)),
      total: 200,
      unread: 199,
      collectedSince: null,
      snapshot: "1:2:",
      deltaTotal: 200,
    };
    return data as T;
  };
  const refreshed = await readNotificationPrefix(server, "1:2:", 150);
  assert.equal(paths.length, 2);
  assert.equal(
    new URL(paths[1], "https://example.test/").searchParams.get("offset"),
    "100",
  );
  assert.equal(refreshed.items.length, 150);
  assert.equal(refreshed.items[100].orderId, 100);
  assert.equal(refreshed.items.find((item) => item.orderId === 70)?.read, true);
  const merged = mergeOrderNotices(
    [outside, ...original.slice(0, 149)],
    refreshed.items,
    150,
  );
  assert.equal(merged.find((item) => item.orderId === 70)?.read, true);
});
