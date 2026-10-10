"use client";

import { useEffect, useState } from "react";

export default function useAdminLiveUpdates(apiUrl: string, authenticated: boolean, refresh: () => Promise<void>) {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!authenticated) return;
    let stopped = false;
    let running = false;
    let pending = false;
    let timer: number | undefined;
    const flush = async () => {
      if (stopped || running || document.visibilityState === "hidden") return;
      running = true;
      pending = false;
      try { await refresh(); }
      finally {
        running = false;
        if (pending && !stopped) timer = window.setTimeout(() => void flush(), 150);
      }
    };
    const schedule = () => {
      pending = true;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void flush(), 150);
    };
    const events = new EventSource(`${apiUrl}/admin/events`, { withCredentials: true });
    events.onopen = () => { setConnected(true); schedule(); };
    events.onerror = () => setConnected(false);
    events.addEventListener("change", schedule);
    const fallback = window.setInterval(() => {
      if (events.readyState !== EventSource.OPEN) schedule();
    }, 15_000);
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("focus", schedule);
    return () => {
      stopped = true;
      events.close();
      window.clearTimeout(timer);
      window.clearInterval(fallback);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("focus", schedule);
    };
  }, [apiUrl, authenticated, refresh]);
  return authenticated && connected;
}
