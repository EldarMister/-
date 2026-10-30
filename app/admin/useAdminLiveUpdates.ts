"use client";

import { useEffect, useRef, useState } from "react";
import { parseOrderEvent } from "./notification-dedupe";
import type { NewOrderEvent } from "./AdminNotifications";

type LiveOptions = {
  onOrder?: (event: NewOrderEvent) => void | Promise<void>;
  onAccessChanged?: () => unknown;
  onReconnect?: () => unknown;
};
export default function useAdminLiveUpdates(
  apiUrl: string,
  authenticated: boolean,
  refresh: () => Promise<void>,
  options: LiveOptions = {},
) {
  const [connected, setConnected] = useState(false);
  const callbacks = useRef({ refresh, ...options });
  useEffect(() => {
    callbacks.current = { refresh, ...options };
  });
  useEffect(() => {
    if (!authenticated) return;
    let stopped = false;
    let running = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastHeartbeat = Date.now();
    const flush = async () => {
      if (stopped || running || document.visibilityState === "hidden") return;
      running = true;
      pending = false;
      try {
        await callbacks.current.refresh();
      } catch {
        /* The workspace displays its own request error. */
      } finally {
        running = false;
        if (pending && !stopped) timer = setTimeout(() => void flush(), 150);
      }
    };
    const schedule = () => {
      pending = true;
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), 150);
    };
    const synchronize = () => {
      void Promise.resolve(callbacks.current.onReconnect?.()).catch(() => {});
      schedule();
    };
    const events = new EventSource(`${apiUrl}/admin/events`, {
      withCredentials: true,
    });
    events.onopen = () => {
      lastHeartbeat = Date.now();
      setConnected(true);
      synchronize();
    };
    events.onerror = () => {
      setConnected(false);
      void Promise.resolve(callbacks.current.onAccessChanged?.()).catch(
        () => {},
      );
    };
    events.addEventListener("heartbeat", () => {
      lastHeartbeat = Date.now();
      setConnected(true);
    });
    events.addEventListener("change", schedule);
    events.addEventListener("notification-read", () => {
      void Promise.resolve(callbacks.current.onReconnect?.()).catch(() => {});
    });
    events.addEventListener("access-changed", () => {
      void Promise.resolve(callbacks.current.onAccessChanged?.())
        .then(synchronize)
        .catch(() => {});
    });
    events.addEventListener("order-created", (event) => {
      const parsed = parseOrderEvent((event as MessageEvent).data);
      if (!parsed) return;
      let createdAt: string | undefined;
      try {
        const raw = JSON.parse((event as MessageEvent).data);
        if (
          typeof raw.createdAt === "string" &&
          Number.isFinite(Date.parse(raw.createdAt))
        )
          createdAt = raw.createdAt;
      } catch {
        /* parseOrderEvent already validated the public fields. */
      }
      void Promise.resolve(
        callbacks.current.onOrder?.({
          ...parsed,
          ...(createdAt ? { createdAt } : {}),
        }),
      ).catch(() => {});
      schedule();
    });
    const wake = () => {
      if (document.visibilityState === "visible") synchronize();
    };
    const fallback = setInterval(() => {
      if (
        events.readyState !== EventSource.OPEN ||
        Date.now() - lastHeartbeat > 45000
      ) {
        setConnected(false);
        synchronize();
      }
    }, 15000);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", synchronize);
    return () => {
      stopped = true;
      events.close();
      clearTimeout(timer);
      clearInterval(fallback);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", synchronize);
    };
  }, [apiUrl, authenticated]);
  return authenticated && connected;
}
