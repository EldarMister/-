"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  claimNotificationBatch,
  claimNotificationBatchInDatabase,
  mergeOrderNotices,
  parseOrderEvent,
  readNotificationPrefix,
  type NotificationLedger,
  type OrderNotice,
} from "./notification-dedupe";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui";
import { useAdminLanguage } from "./i18n";

export type NewOrderEvent = {
  eventId: string;
  orderId: number;
  orderNumber: string;
  createdAt?: string;
};
type Preferences = { enabled: boolean; volume: number };
type Requester = <T = unknown>(
  path: string,
  options?: RequestInit,
) => Promise<T>;
type Feed = {
  items: OrderNotice[];
  unread: number;
  total: number;
  collectedSince: string | null;
  snapshot?: string;
  deltaTotal?: number;
};
type Inbox = Feed & { recipientId: number | undefined };
const emptyInbox: Inbox = {
  items: [],
  unread: 0,
  total: 0,
  collectedSince: null,
  recipientId: undefined,
};

export function useOrderNotifications(
  userId: number | undefined,
  allowed: boolean,
  request?: Requester,
) {
  const { t } = useAdminLanguage();
  const audio = useRef<AudioContext | null>(null);
  const identity = useRef({ userId, allowed, epoch: 0 });
  const [preferences, setPreferences] = useState<Preferences>({
    enabled: false,
    volume: 0.5,
  });
  const preferenceRef = useRef(preferences);
  const [audioState, setAudioState] = useState("Звук выключен");
  const [audioReady, setAudioReady] = useState(false);
  const [notification, setNotification] = useState<
    (NewOrderEvent & { recipientId: number }) | null
  >(null);
  const [inbox, setInbox] = useState<Inbox>(emptyInbox);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bootstrapped = useRef(false);
  const seen = useRef(new Set<string>());
  const syncing = useRef(false);
  const rerun = useRef(false);
  const requestRef = useRef(request);
  const snapshotRef = useRef<string | null>(null);
  const desiredPrefix = useRef(100);
  useEffect(() => {
    requestRef.current = request;
  }, [request]);
  useEffect(() => {
    identity.current = { userId, allowed, epoch: identity.current.epoch + 1 };
    bootstrapped.current = false;
    snapshotRef.current = null;
    desiredPrefix.current = 100;
    seen.current = new Set();
    syncing.current = false;
    rerun.current = false;
    let saved: Preferences = { enabled: false, volume: 0.5 };
    if (userId)
      try {
        const value = JSON.parse(
          localStorage.getItem(`daana-admin-sound:${userId}`) || "null",
        );
        if (value)
          saved = {
            enabled: value.enabled === true,
            volume: Math.max(0, Math.min(1, Number(value.volume) || 0)),
          };
      } catch {
        /* Default to silent. */
      }
    preferenceRef.current = saved;
    const timer = window.setTimeout(() => {
      setInbox(emptyInbox);
      setNotification(null);
      setPreferences(saved);
      setError("");
      setAudioReady(false);
      setAudioState(
        saved.enabled
          ? "Нажмите «Включить звук» для активации в этой вкладке"
          : "Звук выключен",
      );
    }, 0);
    const storage = (event: StorageEvent) => {
      if (event.key !== `daana-admin-sound:${userId}`) return;
      try {
        const value = JSON.parse(event.newValue || "null");
        if (value) {
          const next = {
            enabled: value.enabled === true,
            volume: Math.max(0, Math.min(1, Number(value.volume) || 0)),
          };
          preferenceRef.current = next;
          setPreferences(next);
          if (!next.enabled) setAudioState("Звук выключен");
        }
      } catch {
        /* Ignore malformed preferences from another tab. */
      }
    };
    window.addEventListener("storage", storage);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("storage", storage);
      identity.current.epoch++;
      void audio.current?.close();
      audio.current = null;
    };
  }, [userId, allowed]);
  const save = useCallback(
    (value: Preferences) => {
      const next = {
        enabled: value.enabled,
        volume: Math.max(0, Math.min(1, Number(value.volume) || 0)),
      };
      preferenceRef.current = next;
      setPreferences(next);
      try {
        localStorage.setItem(
          `daana-admin-sound:${userId}`,
          JSON.stringify(next),
        );
      } catch {
        /* Session audio remains available. */
      }
    },
    [userId],
  );
  const play = useCallback(async (activate = false) => {
    try {
      if (!identity.current.allowed || !identity.current.userId) return false;
      if (!audio.current && activate) {
        if (typeof AudioContext === "undefined") {
          setAudioState("Браузер не поддерживает звуковые уведомления");
          return false;
        }
        audio.current = new AudioContext();
        audio.current.onstatechange = () =>
          setAudioReady(audio.current?.state === "running");
      }
      if (!audio.current) {
        setAudioState("Нужна активация: нажмите «Включить звук»");
        return false;
      }
      if (activate) await audio.current.resume();
      if (audio.current.state !== "running") {
        setAudioReady(false);
        setAudioState("Браузер приостановил звук. Нажмите «Включить звук»");
        return false;
      }
      const context = audio.current;
      const gain = context.createGain();
      gain.gain.setValueAtTime(
        preferenceRef.current.volume * 0.22,
        context.currentTime,
      );
      gain.connect(context.destination);
      for (const [index, frequency] of [659.25, 880].entries()) {
        const oscillator = context.createOscillator();
        oscillator.frequency.value = frequency;
        oscillator.type = "sine";
        oscillator.connect(gain);
        oscillator.start(context.currentTime + index * 0.17);
        oscillator.stop(context.currentTime + index * 0.17 + 0.13);
      }
      setTimeout(() => gain.disconnect(), 450);
      setAudioReady(true);
      setAudioState("Звук активирован в этой вкладке");
      return true;
    } catch {
      setAudioReady(false);
      setAudioState(
        "Звук заблокирован браузером. Попробуйте активировать ещё раз",
      );
      return false;
    }
  }, []);
  const alarm = useCallback(
    async (events: NewOrderEvent[]) => {
      const current = identity.current;
      const epoch = current.epoch;
      if (
        !current.allowed ||
        !current.userId ||
        !preferenceRef.current.enabled ||
        audio.current?.state !== "running" ||
        !events.length
      )
        return;
      const key = `daana-admin-events:${current.userId}`;
      const ids = events.map((event) => event.eventId);
      try {
        const claim = () => {
          let ledger: NotificationLedger = { ids: [] };
          const stored = JSON.parse(localStorage.getItem(key) || "null");
          if (stored && Array.isArray(stored.ids)) ledger = stored;
          const acquired = claimNotificationBatch(ledger, ids);
          if (acquired.length)
            localStorage.setItem(key, JSON.stringify(ledger));
          return acquired;
        };
        const acquired = navigator.locks
          ? await navigator.locks.request(key, claim)
          : await claimNotificationBatchInDatabase(key, ids);
        if (acquired.length && identity.current.epoch === epoch) await play();
      } catch {
        setAudioState(
          "Для защиты от повторов звука разрешите локальное хранилище браузера",
        );
      }
    },
    [play],
  );
  const sync = useCallback(async () => {
    const current = identity.current;
    const epoch = current.epoch;
    const transport = requestRef.current;
    if (!current.userId || !current.allowed || !transport) return;
    if (syncing.current) {
      rerun.current = true;
      return;
    }
    syncing.current = true;
    setLoading(true);
    try {
      do {
        rerun.current = false;
        const baseline = snapshotRef.current;
        let feed: Feed;
        let changes: OrderNotice[] = [];
        if (baseline) {
          const first = await transport<Feed>(
            `notifications?${new URLSearchParams({ limit: "100", offset: "0", sinceSnapshot: baseline })}`,
          );
          if (identity.current.epoch !== epoch) return;
          changes = [...first.items];
          for (
            let offset = 100;
            offset < (first.deltaTotal || 0);
            offset += 100
          ) {
            const page = await transport<Feed>(
              `notifications?${new URLSearchParams({ limit: "100", offset: String(offset), sinceSnapshot: baseline, untilSnapshot: first.snapshot! })}`,
            );
            if (identity.current.epoch !== epoch) return;
            changes.push(...page.items);
          }
          feed = await readNotificationPrefix(
            transport,
            first.snapshot,
            desiredPrefix.current,
          );
        } else
          feed = await readNotificationPrefix(
            transport,
            undefined,
            desiredPrefix.current,
          );
        if (identity.current.epoch !== epoch) return;
        const fresh = changes.filter((item) => !seen.current.has(item.eventId));
        for (const item of [...feed.items, ...changes])
          seen.current.add(item.eventId);
        snapshotRef.current = feed.snapshot || null;
        setInbox((previous) => ({
          ...feed,
          recipientId: current.userId,
          items: mergeOrderNotices(
            previous.recipientId === current.userId ? previous.items : [],
            [...changes, ...feed.items],
            desiredPrefix.current,
          ).map((item) => (feed.unread === 0 ? { ...item, read: true } : item)),
        }));
        setError("");
        if (bootstrapped.current && fresh.length) {
          setNotification({ ...fresh[0], recipientId: current.userId });
          await alarm(fresh);
        }
        bootstrapped.current = true;
      } while (rerun.current && identity.current.epoch === epoch);
    } catch (reason) {
      if (identity.current.epoch === epoch)
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось загрузить уведомления",
        );
    } finally {
      if (identity.current.epoch === epoch) {
        syncing.current = false;
        setLoading(false);
      }
    }
  }, [alarm]);
  useEffect(() => {
    if (!userId || !allowed) return;
    const timer = window.setTimeout(() => void sync(), 0);
    const interval = window.setInterval(() => void sync(), 30000);
    const wake = () => {
      if (document.visibilityState === "visible") void sync();
    };
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [userId, allowed, sync]);
  const receive = useCallback(
    async (event: NewOrderEvent) => {
      const current = identity.current;
      if (
        !current.allowed ||
        !current.userId ||
        !parseOrderEvent(JSON.stringify(event))
      )
        return;
      const fresh = !seen.current.has(event.eventId);
      if (!fresh) {
        void sync();
        return;
      }
      seen.current.add(event.eventId);
      const item: OrderNotice = {
        ...event,
        createdAt: event.createdAt || new Date().toISOString(),
        read: false,
      };
      setInbox((previous) => ({
        ...previous,
        recipientId: current.userId,
        items: mergeOrderNotices(
          previous.recipientId === current.userId ? previous.items : [],
          [item],
          desiredPrefix.current,
        ),
        unread:
          (previous.recipientId === current.userId ? previous.unread : 0) +
          (fresh ? 1 : 0),
        total:
          (previous.recipientId === current.userId ? previous.total : 0) +
          (fresh ? 1 : 0),
      }));
      if (fresh) {
        setNotification({ ...event, recipientId: current.userId });
        await alarm([event]);
      }
      void sync();
    },
    [alarm, sync],
  );
  const read = useCallback(
    async (eventId?: string) => {
      const current = identity.current;
      const transport = requestRef.current;
      if (!current.allowed || !current.userId || !transport) return;
      const epoch = current.epoch;
      const captured = snapshotRef.current;
      if (!eventId && !captured) return;
      try {
        await transport("notifications/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            eventId
              ? { eventIds: [eventId] }
              : { all: true, snapshot: captured },
          ),
        });
        if (identity.current.epoch !== epoch) return;
        if (eventId)
          setInbox((previous) => ({
            ...previous,
            items: previous.items.map((item) =>
              item.eventId === eventId ? { ...item, read: true } : item,
            ),
            unread: Math.max(
              0,
              previous.unread -
                (previous.items.some(
                  (item) => item.eventId === eventId && !item.read,
                )
                  ? 1
                  : 0),
            ),
          }));
        void sync();
      } catch (reason) {
        if (identity.current.epoch === epoch)
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось отметить уведомления",
          );
      }
    },
    [sync],
  );
  const loadMore = useCallback(async () => {
    const current = identity.current;
    if (!current.userId || !current.allowed || loading) return;
    desiredPrefix.current = Math.min(200, desiredPrefix.current + 50);
    await sync();
  }, [loading, sync]);
  const visible = allowed && inbox.recipientId === userId;
  return {
    preferences,
    audioState: t(audioState),
    audioReady,
    allowed,
    notification:
      allowed && notification?.recipientId === userId ? notification : null,
    dismiss: () => setNotification(null),
    receive,
    sync,
    items: visible ? inbox.items : [],
    unread: visible ? inbox.unread : 0,
    total: visible ? inbox.total : 0,
    collectedSince: visible ? inbox.collectedSince : null,
    loading,
    error: t(error),
    read,
    markAllRead: () => read(),
    loadMore,
    enable: async () => {
      if (await play(true)) save({ ...preferenceRef.current, enabled: true });
    },
    disable: () => {
      save({ ...preferenceRef.current, enabled: false });
      setAudioState("Звук выключен");
    },
    test: () => play(true),
    volume: (volume: number) => save({ ...preferenceRef.current, volume }),
  };
}

type Controller = ReturnType<typeof useOrderNotifications>;
export function SoundToggle({ controller }: { controller: Controller }) {
  const { t } = useAdminLanguage();
  if (!controller.allowed) return null;
  const active = controller.preferences.enabled && controller.audioReady;
  return (
    <>
      <Button
        className={`admin-sound-toggle ${active ? "is-on" : ""}`}
        aria-pressed={active}
        title={controller.audioState}
        aria-label={t(active ? "Выключить звук" : "Включить звук")}
        onClick={() =>
          void (active ? controller.disable() : controller.enable())
        }
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path d="M11 5 6 9H3v6h3l5 4V5Z" />
          {active ? (
            <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
          ) : (
            <path d="m16 9 5 6m0-6-5 6" />
          )}
        </svg>
        <span>{t(active ? "Звук включён" : "Включить звук")}</span>
      </Button>
      <Button
        className="admin-sound-test"
        size="icon"
        variant="ghost"
        aria-label={t("Проверить звук")}
        title={t("Проверить звук")}
        onClick={() => void controller.test()}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path d="m9 5 11 7-11 7V5Z" />
          <path d="M4 7v10" />
        </svg>
      </Button>
    </>
  );
}
export function OrderNotificationCenter({
  controller,
  onOpenOrder,
}: {
  controller: Controller;
  onOpenOrder: (id: number) => void;
}) {
  const { t, formatNumber, formatDate } = useAdminLanguage();
  const details = useRef<HTMLDetailsElement>(null);
  if (!controller.allowed) return null;
  return (
    <details
      ref={details}
      className="admin-notification-center"
      onToggle={(event) => {
        if (event.currentTarget.open) void controller.sync();
      }}
    >
      <summary
        className="admin-notification-trigger"
        aria-label={t("Уведомления")}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {controller.unread > 0 && (
          <span className="admin-notification-count">
            {controller.unread > 99 ? "99+" : formatNumber(controller.unread)}
          </span>
        )}
        <span className="sr-only">{t("Уведомления")}</span>
      </summary>
      <section
        className="admin-notification-panel"
        aria-label={t("Центр уведомлений")}
      >
        <header className="admin-notification-header">
          <div>
            <strong>{t("Уведомления")}</strong>
            <small>
              {t("Непрочитанных: {count}", {
                count: formatNumber(controller.unread),
              })}
            </small>
          </div>
          <Button
            size="sm"
            disabled={!controller.unread || controller.loading}
            onClick={() => void controller.markAllRead()}
          >
            {t("Прочитать все")}
          </Button>
        </header>
        {controller.error && (
          <p className="admin-error" role="alert">
            {controller.error}
          </p>
        )}
        <div className="admin-notification-list">
          {controller.items.length ? (
            controller.items.map((item) => (
              <button
                type="button"
                className={`admin-notification-item ${item.read ? "" : "is-unread"}`}
                key={item.eventId}
                onClick={() => {
                  void controller.read(item.eventId);
                  if (details.current) details.current.open = false;
                  onOpenOrder(item.orderId);
                }}
              >
                <span className="admin-notification-dot" />
                <span>
                  <strong>
                    {t("Заказ №{number}", { number: item.orderNumber })}
                  </strong>
                  <small>
                    {formatDate(item.createdAt, {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </span>
                <span aria-hidden="true">↗</span>
              </button>
            ))
          ) : (
            <p className="admin-notification-empty" role="status">
              {t(
                controller.loading
                  ? "Загружаем уведомления…"
                  : "Уведомлений пока нет",
              )}
            </p>
          )}
        </div>
        {controller.items.length < Math.min(controller.total, 200) && (
          <Button
            disabled={controller.loading}
            onClick={() => void controller.loadMore()}
          >
            {t("Показать ещё")}
          </Button>
        )}
        <footer className="admin-notification-footer">
          {t("История и прочтение сохраняются для вашей учётной записи.")}
        </footer>
      </section>
    </details>
  );
}
export function SoundSettings({ controller }: { controller: Controller }) {
  const { t, formatNumber } = useAdminLanguage();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Звук нового заказа")}</CardTitle>
        <CardDescription>
          {t("Персональная настройка для этого сотрудника и браузера.")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="admin-sound-controls">
          <Button onClick={() => void controller.enable()}>
            {t("Включить звук")}
          </Button>
          <Button
            onClick={controller.disable}
            disabled={!controller.preferences.enabled}
          >
            {t("Выключить звук")}
          </Button>
          <Button onClick={() => void controller.test()}>
            {t("Проверить звук")}
          </Button>
          <label>
            {t("Громкость")}{" "}
            {formatNumber(Math.round(controller.preferences.volume * 100))}%
            <input
              aria-label={t("Громкость")}
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={controller.preferences.volume}
              onChange={(event) =>
                controller.volume(Number(event.target.value))
              }
            />
          </label>
        </div>
        <p role="status" className="admin-muted">
          {controller.audioState}
        </p>
      </CardContent>
    </Card>
  );
}
