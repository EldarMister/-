"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui";
import AdminDialog from "./AdminDialog";
import { useAdminLanguage } from "./i18n";

type Requester = <T = unknown>(
  path: string,
  options?: RequestInit,
) => Promise<T>;
type InstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
let availableInstall: InstallEvent | null = null;

export async function detachAdminPushLocally() {
  try {
    if (
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator) ||
      typeof window === "undefined" ||
      !("PushManager" in window)
    )
      return;
    const registration =
      await navigator.serviceWorker.getRegistration("/admin/");
    if (registration?.scope !== new URL("/admin/", location.origin).href)
      return;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
  } catch {
    /* Expired sessions and unsupported browsers still clear application state. */
  }
}

export async function clearAdminDevice(request: Requester) {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/admin/");
  const ownRegistration =
    registration?.scope === new URL("/admin/", location.origin).href
      ? registration
      : null;
  const subscription =
    ownRegistration && "PushManager" in window
      ? await ownRegistration.pushManager.getSubscription()
      : null;
  if (subscription) {
    await request("push/subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    await subscription.unsubscribe();
  }
  // Retain only explicitly public assets, so offline instructions survive logout.
  if ("caches" in window)
    for (const key of await caches.keys())
      if (
        key.startsWith("daana-admin") &&
        !key.startsWith("daana-admin-shell-") &&
        !key.startsWith("daana-admin-assets-")
      )
        await caches.delete(key);
}

export default function AdminPwa({
  request,
  canNotify,
  compact = false,
}: {
  request: Requester;
  canNotify: boolean;
  compact?: boolean;
}) {
  const { t, locale } = useAdminLanguage();
  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null);
  const [install, setInstall] = useState<InstallEvent | null>(
    () => availableInstall,
  );
  const [update, setUpdate] = useState<ServiceWorker | null>(null);
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState("");
  const [pushMessage, setPushMessage] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const pushGeneration = useRef(0);
  const invalidatePush = useCallback(() => {
    pushGeneration.current += 1;
  }, []);
  const [busy, setBusy] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [pushConfigured, setPushConfigured] = useState<boolean | null>(null);
  const [pushKey, setPushKey] = useState("");
  const [pushUnsupported, setPushUnsupported] = useState(false);
  useEffect(() => {
    let stopped = false;
    const status = () => setOnline(navigator.onLine);
    const media = matchMedia("(display-mode: standalone)");
    const installedStatus = () =>
      setInstalled(
        media.matches ||
          Boolean(
            (navigator as Navigator & { standalone?: boolean }).standalone,
          ),
      );
    const initial = setTimeout(() => {
      status();
      installedStatus();
      setPushUnsupported(
        !window.isSecureContext ||
          !("serviceWorker" in navigator) ||
          !("PushManager" in window) ||
          !("Notification" in window),
      );
    }, 0);
    const appInstalled = () => {
      availableInstall = null;
      setInstall(null);
      setInstalled(true);
    };
    const captureInstall = (event: Event) => {
      event.preventDefault();
      availableInstall = event as InstallEvent;
      setInstall(availableInstall);
    };
    window.addEventListener("online", status);
    window.addEventListener("offline", status);
    window.addEventListener("beforeinstallprompt", captureInstall);
    window.addEventListener("appinstalled", appInstalled);
    media.addEventListener("change", installedStatus);
    if ("serviceWorker" in navigator && window.isSecureContext) {
      void navigator.serviceWorker
        .register("/admin/sw.js", { scope: "/admin/", updateViaCache: "none" })
        .then((result) => {
          if (stopped) return;
          setRegistration(result);
          setUpdate(result.waiting);
          result.addEventListener("updatefound", () => {
            const worker = result.installing;
            worker?.addEventListener("statechange", () => {
              if (
                worker.state === "installed" &&
                navigator.serviceWorker.controller
              )
                setUpdate(worker);
            });
          });
        })
        .catch(() => {
          if (!stopped) setMessage("Установка приложения временно недоступна");
        });
    }
    return () => {
      stopped = true;
      clearTimeout(initial);
      window.removeEventListener("online", status);
      window.removeEventListener("offline", status);
      window.removeEventListener("beforeinstallprompt", captureInstall);
      window.removeEventListener("appinstalled", appInstalled);
      media.removeEventListener("change", installedStatus);
    };
  }, []);
  useEffect(() => {
    let stopped = false;
    const generation = ++pushGeneration.current;
    const timer = window.setTimeout(() => {
      if (!canNotify) {
        setSubscribed(false);
        setPushMessage("");
        setBusy(false);
        void detachAdminPushLocally();
        return;
      }
      if (!registration || !("PushManager" in window)) return;
      void (async () => {
        const configuration = await request<{
          publicKey: string;
          configured: boolean;
        }>("push/public-key");
        const subscription = await registration.pushManager.getSubscription();
        const result = subscription
          ? await request<{ subscribed: boolean; configured: boolean }>(
              "push/subscriptions/status",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  endpoint: subscription.endpoint,
                  locale,
                }),
              },
            )
          : null;
        if (!stopped && generation === pushGeneration.current) {
          setPushConfigured(configuration.configured);
          setPushKey(configuration.publicKey);
          setSubscribed(
            Boolean(
              subscription &&
              result?.subscribed &&
              result.configured &&
              "Notification" in window &&
              Notification.permission === "granted",
            ),
          );
          setPushMessage("");
          setBusy(false);
        }
      })().catch(() => {
        if (!stopped && generation === pushGeneration.current) {
          setSubscribed(false);
          setBusy(false);
          setPushMessage(
            "Не удалось проверить системные уведомления. Проверьте соединение и повторите действие.",
          );
        }
      });
    }, 0);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      invalidatePush();
    };
  }, [canNotify, registration, request, online, invalidatePush, locale]);
  useEffect(() => {
    if (!registration) return;
    const check = () => {
      if (navigator.onLine && document.visibilityState === "visible")
        void registration.update().catch(() => {});
    };
    const initial = setTimeout(check, 0);
    const interval = setInterval(check, 15 * 60 * 1000);
    window.addEventListener("focus", check);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      window.removeEventListener("focus", check);
    };
  }, [registration]);
  const subscribe = useCallback(async () => {
    if (!canNotify) return;
    const generation = ++pushGeneration.current;
    const current = () => generation === pushGeneration.current;
    if (
      !registration ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setPushMessage(
        "Этот браузер не поддерживает системные уведомления. На iPhone установите приложение через Safari → Поделиться → На экран «Домой».",
      );
      return;
    }
    setBusy(true);
    try {
      const publicKey = pushKey;
      if (!pushConfigured || !publicKey)
        throw new Error(
          "Системные уведомления ещё не настроены на сервере. Звук в открытой панели доступен отдельно.",
        );
      const permission = await Notification.requestPermission();
      if (!current()) return;
      if (permission !== "granted")
        throw new Error(
          permission === "denied"
            ? "Уведомления запрещены. Разрешите их в настройках браузера для этого сайта."
            : "Разрешение на уведомления не получено",
        );
      const padded = publicKey.replace(/-/g, "+").replace(/_/g, "/");
      const applicationServerKey = Uint8Array.from(atob(padded), (character) =>
        character.charCodeAt(0),
      );
      const subscription =
        (await registration.pushManager.getSubscription()) ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        }));
      if (!current()) {
        await detachAdminPushLocally();
        return;
      }
      await request("push/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON(), locale }),
      });
      if (current()) {
        setSubscribed(true);
        setPushMessage("Системные уведомления включены для этого устройства");
      }
    } catch (error) {
      if (current())
        setPushMessage(
          error instanceof Error
            ? error.message
            : "Не удалось включить уведомления",
        );
    } finally {
      if (current()) setBusy(false);
    }
  }, [registration, request, canNotify, pushKey, pushConfigured, locale]);
  const unsubscribe = async () => {
    const generation = ++pushGeneration.current;
    setBusy(true);
    try {
      await clearAdminDevice(request);
      if (generation === pushGeneration.current) {
        setSubscribed(false);
        setPushMessage("Системные уведомления выключены");
      }
    } catch (error) {
      if (generation === pushGeneration.current)
        setPushMessage(
          error instanceof Error
            ? error.message
            : "Не удалось выключить уведомления",
        );
    } finally {
      if (generation === pushGeneration.current) setBusy(false);
    }
  };
  const installApp = async () => {
    if (!window.isSecureContext) {
      setMessage("Для установки нужен HTTPS.");
      return;
    }
    if (!install) {
      setMessage(
        "Chrome/Edge: меню браузера → Установить приложение. iPhone/iPad: Safari → Поделиться → На экран «Домой». Если установка недоступна, панель продолжит работать в браузере.",
      );
      return;
    }
    await install.prompt();
    const choice = await install.userChoice;
    if (choice.outcome === "accepted") {
      availableInstall = null;
      setInstall(null);
    }
  };
  const applyUpdate = () => {
    if (!update) return;
    let reloaded = false;
    const reload = () => {
      if (!reloaded) {
        reloaded = true;
        location.reload();
      }
    };
    navigator.serviceWorker.addEventListener("controllerchange", reload, {
      once: true,
    });
    update.addEventListener("statechange", () => {
      if (update.state === "activated") reload();
    });
    update.postMessage({ type: "SKIP_WAITING" });
    setConfirmUpdate(false);
  };
  const controls = (
    <>
      {!online && (
        <div className="admin-error" role="alert">
          {t(
            "Нет соединения. Данные могут быть неактуальны. Для сохранения подключитесь к интернету.",
          )}
        </div>
      )}
      {update && (
        <div className="admin-update" role="status">
          <span>{t("Доступна новая версия")}</span>
          <Button onClick={() => setConfirmUpdate(true)}>
            {t("Обновить приложение")}
          </Button>
        </div>
      )}
      {confirmUpdate && update && (
        <AdminDialog
          title={t("Обновить приложение?")}
          description={t(
            "Приложение перезагрузится. Сохраните открытые формы перед обновлением.",
          )}
          onClose={() => setConfirmUpdate(false)}
        >
          <div className="editor-actions">
            <Button onClick={() => setConfirmUpdate(false)}>
              {t("Отмена")}
            </Button>
            <Button variant="default" onClick={applyUpdate}>
              {t("Обновить сейчас")}
            </Button>
          </div>
        </AdminDialog>
      )}
    </>
  );
  const installControl = installed ? (
    <span className="admin-pwa-installed">{t("Приложение установлено")}</span>
  ) : (
    <Button size="sm" onClick={() => void installApp()}>
      {t(install ? "Установить приложение" : "Как установить")}
    </Button>
  );
  if (compact)
    return (
      <>
        {controls}
        <div className="admin-pwa-bar">
          <span>{t("Установить панель на устройство")}</span>
          {installControl}
          {canNotify && (
            <span className="admin-muted">
              {t(
                subscribed
                  ? "Системные уведомления включены"
                  : pushConfigured === false
                    ? "Фоновые уведомления не настроены на сервере."
                    : "Системные уведомления выключены",
              )}
            </span>
          )}
        </div>
        {message && (
          <p className="admin-muted" role="status">
            {t(message)}
          </p>
        )}
      </>
    );
  return (
    <>
      {controls}
      <Card>
        <CardHeader>
          <CardTitle>{t("Приложение и уведомления")}</CardTitle>
          <CardDescription>
            {t(
              "Установите панель для быстрого доступа. Фоновые уведомления включаются отдельно от звука.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="admin-sound-controls">
            {installControl}
            {canNotify && (
              <Button
                disabled={
                  busy || !online || (!subscribed && pushConfigured !== true)
                }
                onClick={() => void (subscribed ? unsubscribe() : subscribe())}
              >
                {t(
                  subscribed
                    ? "Выключить системные уведомления"
                    : "Включить системные уведомления",
                )}
              </Button>
            )}
          </div>
          {canNotify && pushConfigured === false && (
            <p className="admin-muted">
              {t("Фоновые уведомления не настроены на сервере.")}
            </p>
          )}
          {canNotify && pushUnsupported && (
            <p className="admin-muted">
              {t(
                "Этот браузер не поддерживает системные уведомления. На iPhone установите приложение через Safari → Поделиться → На экран «Домой».",
              )}
            </p>
          )}
          {message && (
            <p role="status" className="admin-muted">
              {t(message)}
            </p>
          )}
          {canNotify && pushMessage && (
            <p role="status" className="admin-muted">
              {t(pushMessage)}
            </p>
          )}
          <p className="admin-muted">
            {t(
              "Доставка в фоне зависит от браузера, разрешений и настроек устройства.",
            )}
          </p>
        </CardContent>
      </Card>
    </>
  );
}
