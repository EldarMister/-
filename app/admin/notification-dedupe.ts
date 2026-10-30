export type NotificationLedger = { ids: string[] };
export function claimNotification(
  ledger: NotificationLedger,
  eventId: string,
  limit = 200,
): boolean {
  if (!eventId || ledger.ids.includes(eventId)) return false;
  ledger.ids = [...ledger.ids, eventId].slice(-limit);
  return true;
}

export function parseOrderEvent(
  raw: string,
): { eventId: string; orderId: number; orderNumber: string } | null {
  try {
    const event = JSON.parse(raw);
    if (
      !Number.isSafeInteger(Number(event.orderId)) ||
      Number(event.orderId) < 1 ||
      event.eventId !== `order:${Number(event.orderId)}` ||
      typeof event.orderNumber !== "string" ||
      !event.orderNumber ||
      event.orderNumber.length > 100
    )
      return null;
    return {
      eventId: event.eventId,
      orderId: Number(event.orderId),
      orderNumber: event.orderNumber,
    };
  } catch {
    return null;
  }
}

export function claimNotificationBatch(
  ledger: NotificationLedger,
  eventIds: string[],
  limit = 2000,
) {
  return [...new Set(eventIds)].filter((id) =>
    claimNotification(ledger, id, limit),
  );
}

export type OrderNotice = {
  eventId: string;
  orderId: number;
  orderNumber: string;
  createdAt: string;
  read: boolean;
  status?: string;
};
export type NotificationFeed = {
  items: OrderNotice[];
  unread: number;
  total: number;
  collectedSince: string | null;
  snapshot: string;
  deltaTotal: number;
};
export async function readNotificationPrefix(
  request: <T = unknown>(path: string) => Promise<T>,
  untilSnapshot: string | undefined,
  desiredCount: number,
): Promise<NotificationFeed> {
  const first = await request<NotificationFeed>(
    `notifications?${new URLSearchParams({ limit: "100", offset: "0", ...(untilSnapshot ? { untilSnapshot } : {}) })}`,
  );
  const items = [...first.items];
  for (
    let offset = 100;
    offset < Math.min(desiredCount, first.total);
    offset += 100
  ) {
    const page = await request<NotificationFeed>(
      `notifications?${new URLSearchParams({ limit: String(Math.min(100, desiredCount - offset)), offset: String(offset), untilSnapshot: first.snapshot })}`,
    );
    items.push(...page.items);
  }
  return { ...first, items };
}
export function mergeOrderNotices(
  existing: OrderNotice[],
  incoming: OrderNotice[],
  limit = 200,
) {
  const merged = new Map(existing.map((item) => [item.eventId, item]));
  for (const item of incoming)
    if (parseOrderEvent(JSON.stringify(item)))
      merged.set(item.eventId, { ...merged.get(item.eventId), ...item });
  return [...merged.values()]
    .sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        b.orderId - a.orderId,
    )
    .slice(0, limit);
}

// IndexedDB read/write transactions serialize claims across tabs when Web Locks
// are unavailable. An unavailable store means silence rather than duplicate sound.
export function claimNotificationInDatabase(
  key: string,
  eventId: string,
): Promise<boolean> {
  return claimNotificationBatchInDatabase(key, [eventId]).then(
    (ids) => ids.length > 0,
  );
}
export function claimNotificationBatchInDatabase(
  key: string,
  eventIds: string[],
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Device storage unavailable"));
      return;
    }
    const open = indexedDB.open("daana-admin-device-events", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("ledgers");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      let claimed: string[] = [];
      const transaction = database.transaction("ledgers", "readwrite");
      const store = transaction.objectStore("ledgers");
      const read = store.get(key);
      read.onsuccess = () => {
        const ledger =
          read.result && Array.isArray(read.result.ids)
            ? (read.result as NotificationLedger)
            : { ids: [] };
        claimed = claimNotificationBatch(ledger, eventIds);
        if (claimed.length) store.put(ledger, key);
      };
      transaction.oncomplete = () => {
        database.close();
        resolve(claimed);
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}
