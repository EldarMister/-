"use client";

import {
  mdiAlertCircleOutline,
  mdiArrowLeft,
  mdiBankTransferOut,
  mdiChevronRight,
  mdiCogOutline,
  mdiFish,
  mdiFoodTakeoutBoxOutline,
  mdiHexagonMultipleOutline,
  mdiInformationOutline,
  mdiLogout,
  mdiMessageReplyTextOutline,
  mdiShoppingOutline,
  mdiStarFourPointsOutline,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Customer,
  CustomerProfile,
  CustomerSession,
  ProfileOrder,
} from "../types";
import RewardsWithdrawalDialog, { type RewardWithdrawalInput } from "./RewardsWithdrawalDialog";

type Props = {
  apiUrl: string;
  coinNetwork: string;
  onClose: () => void;
  onSessionChange?: (active: boolean) => void;
};

type AccountSection = "menu" | "rewards" | "orders" | "account";
type OrderSection = "active" | "history";
type CancelTarget = { kind: "coins" | "nft"; id: string; label: string };

const KYRGYZ_PHONE_PREFIX = "+996";
const numberFormat = new Intl.NumberFormat("ru-RU");
const networkLabels: Record<string, string> = {
  polygon: "Polygon",
  ethereum: "Ethereum",
  bsc: "BNB Smart Chain",
  solana: "Solana",
  ton: "TON",
};
const rewardStatusLabels: Record<string, string> = {
  owned: "Доступен",
  pending: "Ожидает обработки",
  submitted: "Отправлен в сеть",
  withdrawn: "Выведен",
  failed: "Ошибка",
  cancelled: "Отменён",
};
const orderStatusLabels: Record<string, string> = {
  new: "Новый",
  confirmed: "Подтверждён",
  preparing: "Готовится",
  ready: "Готов",
  completed: "Выдан",
  cancelled: "Отменён",
};

function MaterialIcon({ children }: { children: string }) {
  return <span className="material-icons" aria-hidden="true">{children}</span>;
}

function kyrgyzLocalDigits(value: string) {
  const digits = value.replace(/\D/g, "");
  return (digits.startsWith("996") ? digits.slice(3) : digits).slice(0, 9);
}

function formatKyrgyzLocalPhone(digits: string) {
  const groups = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)];
  if (!digits) return "";
  let formatted = groups[0].length === 3 ? `(${groups[0]})` : `(${groups[0]}`;
  if (groups[1]) formatted += ` ${groups[1]}`;
  if (groups[2]) formatted += `-${groups[2]}`;
  return formatted;
}

function fullKyrgyzPhone(digits: string) {
  return `${KYRGYZ_PHONE_PREFIX} ${formatKyrgyzLocalPhone(digits)}`;
}

function formatHistoryDate(value?: string | null) {
  if (!value) return "Дата не указана";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата не указана";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function normalizeProfile(value: Partial<CustomerProfile>, fallbackCustomer: Customer): CustomerProfile {
  return {
    customer: value.customer || fallbackCustomer,
    naktaCoins: Number(value.naktaCoins) || 0,
    coinNetwork: value.coinNetwork,
    naktaCoinHistory: Array.isArray(value.naktaCoinHistory) ? value.naktaCoinHistory : [],
    nfts: Array.isArray(value.nfts) ? value.nfts : [],
    naktaCoinWithdrawals: Array.isArray(value.naktaCoinWithdrawals) ? value.naktaCoinWithdrawals : [],
    currentOrders: Array.isArray(value.currentOrders) ? value.currentOrders : [],
    orderHistory: Array.isArray(value.orderHistory) ? value.orderHistory : [],
  };
}

function OrderCard({ order }: { order: ProfileOrder }) {
  return <article className="customer-order-card">
    <span className={`customer-order-status status-${order.status}`}>{orderStatusLabels[order.status] || order.status}</span>
    <span className="customer-order-main"><span><b>Заказ №{order.orderNumber || order.id}</b><small>{formatHistoryDate(order.createdAt)} · самовывоз</small></span><strong>{numberFormat.format(Number(order.total) || 0)} С</strong></span>
    <span className="customer-order-delivery"><i aria-hidden="true"><Icon path={mdiShoppingOutline} size={0.8} /></i><span><b>Самовывоз</b><small>{order.locationAddress || order.locationName || "Адрес уточняется"}</small></span></span>
  </article>;
}

export default function CustomerAccountModal({ apiUrl, coinNetwork, onClose, onSessionChange }: Props) {
  const sessionGenerationRef = useRef(0);
  const profileRequestGenerationRef = useRef(0);
  const [checked, setChecked] = useState(false);
  const [session, setSession] = useState<CustomerSession | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [section, setSection] = useState<AccountSection>("menu");
  const [orderSection, setOrderSection] = useState<OrderSection>("active");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [withdrawalOpen, setWithdrawalOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);

  const clearSession = useCallback((notice = "") => {
    sessionGenerationRef.current += 1;
    profileRequestGenerationRef.current += 1;
    setSession(null);
    setProfile(null);
    setProfileLoading(false);
    setProfileError("");
    setLogoutBusy(false);
    setCodeSent(false);
    setCode("");
    setMessage(notice);
    setSection("menu");
    setChecked(true);
    onSessionChange?.(false);
  }, [onSessionChange]);

  const loadProfile = useCallback(async (activeSession?: CustomerSession, restoring = false) => {
    const sessionGeneration = sessionGenerationRef.current;
    const requestGeneration = ++profileRequestGenerationRef.current;
    const isCurrentRequest = () => sessionGenerationRef.current === sessionGeneration
      && profileRequestGenerationRef.current === requestGeneration;
    setProfileLoading(true);
    setProfileError("");
    try {
      const response = await fetch(`${apiUrl}/auth/profile`, {
        credentials: "include",
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as Partial<CustomerProfile> & { error?: string; message?: string | string[] };
      if (response.status === 401) {
        if (isCurrentRequest()) clearSession(restoring ? "" : "Сессия истекла. Войдите ещё раз.");
        return;
      }
      if (!response.ok) {
        const detail = Array.isArray(body.message) ? body.message.join(", ") : body.message;
        throw new Error(body.error || detail || "Не удалось загрузить профиль");
      }
      const fallbackCustomer = body.customer || activeSession?.customer;
      if (!fallbackCustomer) throw new Error("Сервер не вернул данные пользователя");
      const nextProfile = normalizeProfile(body, fallbackCustomer);
      if (isCurrentRequest()) {
        setProfile(nextProfile);
        setSession({
          customer: nextProfile.customer,
          phone: nextProfile.customer.phone || activeSession?.phone || "",
          expiresAt: activeSession?.expiresAt,
        });
        setPhone(kyrgyzLocalDigits(nextProfile.customer.phone || activeSession?.phone || ""));
        setMessage("");
        setChecked(true);
        onSessionChange?.(true);
      }
    } catch (reason) {
      if (isCurrentRequest()) {
        const detail = reason instanceof Error ? reason.message : "Не удалось загрузить профиль";
        setProfileError(detail);
        if (restoring) {
          setSession(null);
          setProfile(null);
          setMessage(detail);
          onSessionChange?.(false);
        }
      }
    } finally {
      if (isCurrentRequest()) {
        setProfileLoading(false);
        setChecked(true);
      }
    }
  }, [apiUrl, clearSession, onSessionChange]);

  useEffect(() => {
    sessionGenerationRef.current += 1;
    const timer = window.setTimeout(() => void loadProfile(undefined, true), 0);
    return () => {
      window.clearTimeout(timer);
      sessionGenerationRef.current += 1;
      profileRequestGenerationRef.current += 1;
    };
  }, [loadProfile]);

  useEffect(() => {
    if (!session) return;
    const refreshTimer = window.setInterval(() => void loadProfile(), 15_000);
    return () => window.clearInterval(refreshTimer);
  }, [loadProfile, session]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending && !cancelBusy && !logoutBusy && !withdrawalOpen) onClose();
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [cancelBusy, logoutBusy, onClose, pending, withdrawalOpen]);

  const finishLogin = async (customer: Customer, expiresInSeconds: number, formattedPhone: string) => {
    const nextSession: CustomerSession = {
      customer,
      phone: customer.phone || formattedPhone,
      expiresAt: Date.now() + Math.max(60, expiresInSeconds) * 1_000,
    };
    sessionGenerationRef.current += 1;
    profileRequestGenerationRef.current += 1;
    setSession(nextSession);
    setCodeSent(false);
    setCode("");
    setMessage("");
    setSection("menu");
    onSessionChange?.(true);
    await loadProfile(nextSession);
  };

  const requestCode = async () => {
    setMessage("");
    setPending(true);
    try {
      const response = await fetch(`${apiUrl}/auth/request-code`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: fullKyrgyzPhone(phone) }),
      });
      const result = await response.json().catch(() => ({})) as {
        customer?: Customer;
        expiresInSeconds?: number;
        error?: string;
        message?: string;
        devCode?: string;
      };
      if (!response.ok) throw new Error(result.error || result.message || "Не удалось отправить код");
      if (result.customer) {
        const expiresInSeconds = Number(result.expiresInSeconds);
        if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) throw new Error("Сервер не вернул срок сессии");
        await finishLogin(result.customer, expiresInSeconds, fullKyrgyzPhone(phone));
        return;
      }
      setCodeSent(true);
      setMessage(result.devCode ? `Код отправлен. Код для локального запуска: ${result.devCode}.` : "Код отправлен.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось отправить код");
    } finally {
      setPending(false);
    }
  };

  const verifyCode = async () => {
    setMessage("");
    setPending(true);
    try {
      const formattedPhone = fullKyrgyzPhone(phone);
      const response = await fetch(`${apiUrl}/auth/verify-code`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: formattedPhone, code }),
      });
      const result = await response.json().catch(() => ({})) as {
        customer?: Customer;
        expiresInSeconds?: number;
        error?: string;
        message?: string | string[];
      };
      const expiresInSeconds = Number(result.expiresInSeconds);
      if (!response.ok || !result.customer || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
        const detail = Array.isArray(result.message) ? result.message.join(", ") : result.message;
        throw new Error(result.error || detail || "Не удалось войти");
      }
      await finishLogin(result.customer, expiresInSeconds, formattedPhone);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось войти");
    } finally {
      setPending(false);
    }
  };

  const authorizedRequest = useCallback(async (path: string, options: RequestInit = {}) => {
    if (!session) throw new Error("Сессия истекла. Войдите ещё раз.");
    const requestSessionGeneration = sessionGenerationRef.current;
    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({})) as { error?: string; message?: string | string[] } & Partial<CustomerProfile>;
    if (response.status === 401) {
      if (sessionGenerationRef.current === requestSessionGeneration) clearSession("Сессия истекла. Войдите ещё раз.");
      throw new Error("Сессия истекла. Войдите ещё раз.");
    }
    if (!response.ok) {
      const detail = Array.isArray(body.message) ? body.message.join(", ") : body.message;
      throw new Error(body.error || detail || "Не удалось выполнить запрос");
    }
    return body;
  }, [apiUrl, clearSession, session]);

  const submitWithdrawal = async (input: RewardWithdrawalInput) => {
    const requestSessionGeneration = sessionGenerationRef.current;
    const endpoint = input.kind === "coins"
      ? "/auth/coins/withdraw"
      : `/auth/nfts/${encodeURIComponent(input.nftId || "")}/withdraw`;
    await authorizedRequest(endpoint, {
      method: "POST",
      body: JSON.stringify(input.kind === "coins"
        ? { amount: input.amount, walletAddress: input.walletAddress, requestId: input.requestId }
        : { walletAddress: input.walletAddress }),
    });
    if (session && sessionGenerationRef.current === requestSessionGeneration) await loadProfile(session);
  };

  const cancelWithdrawal = async () => {
    if (!cancelTarget || !session || cancelBusy) return;
    const requestSessionGeneration = sessionGenerationRef.current;
    setCancelBusy(true);
    setCancelError("");
    try {
      const endpoint = cancelTarget.kind === "coins"
        ? `/auth/coins/withdrawals/${encodeURIComponent(cancelTarget.id)}/cancel`
        : `/auth/nfts/${encodeURIComponent(cancelTarget.id)}/withdrawal/cancel`;
      const body = await authorizedRequest(endpoint, { method: "POST" });
      if (sessionGenerationRef.current !== requestSessionGeneration) return;
      if (body.customer && typeof body.naktaCoins === "number") setProfile(normalizeProfile(body, session.customer));
      else await loadProfile(session);
      setCancelTarget(null);
    } catch (reason) {
      setCancelError(reason instanceof Error ? reason.message : "Не удалось отменить вывод");
    } finally {
      setCancelBusy(false);
    }
  };

  const availableNfts = profile?.nfts.filter((nft) => nft.status === "owned" || nft.status === "failed") || [];
  const nftOperations = profile?.nfts.filter((nft) => nft.status !== "owned" || nft.withdrawalError) || [];
  const coinHistory = profile?.naktaCoinHistory || [];
  const effectiveCoinNetwork = profile?.coinNetwork || coinNetwork;
  const logout = async () => {
    if (!session || logoutBusy) return;
    const requestSessionGeneration = sessionGenerationRef.current;
    setLogoutBusy(true);
    setProfileError("");
    try {
      const response = await fetch(`${apiUrl}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      const body = await response.json().catch(() => ({})) as { error?: string; message?: string | string[] };
      if (!response.ok) {
        const detail = Array.isArray(body.message) ? body.message.join(", ") : body.message;
        throw new Error(body.error || detail || "Не удалось завершить сессию");
      }
      if (sessionGenerationRef.current === requestSessionGeneration) clearSession();
    } catch (reason) {
      if (sessionGenerationRef.current === requestSessionGeneration) {
        setProfileError(reason instanceof Error ? reason.message : "Не удалось выйти из профиля");
      }
    } finally {
      if (sessionGenerationRef.current === requestSessionGeneration) setLogoutBusy(false);
    }
  };

  const screenTitle = section === "rewards"
    ? "Баланс"
    : section === "account"
      ? "Настройки"
      : "";
  const visibleOrders = orderSection === "active" ? profile?.currentOrders || [] : profile?.orderHistory || [];
  const hasRewardOperations = coinHistory.length > 0 || nftOperations.length > 0;

  return <div className="customer-account-overlay" role="dialog" aria-modal="true" aria-label={session ? "Личный кабинет" : undefined} aria-labelledby={session ? undefined : "customer-account-title"}>
    <button className="customer-account-dismiss" type="button" tabIndex={-1} aria-label="Закрыть личный кабинет" disabled={pending} onClick={onClose} />
    <section className={`customer-account-modal${session ? " is-authenticated" : ""}${section === "orders" ? " is-orders" : ""}`}>
      {!session && <button className="customer-account-close" type="button" onClick={onClose} aria-label="Закрыть"><MaterialIcon>close</MaterialIcon></button>}

      {!checked ? <div className="customer-account-loading">Проверяем сессию…</div> : !session ? <div className="customer-login-view">
        <div className="login-circle"><MaterialIcon>key</MaterialIcon></div>
        <h2 id="customer-account-title">Личный кабинет</h2>
        <div className="login-caption">{codeSent ? <>Мы отправили SMS с кодом на номер <strong>{KYRGYZ_PHONE_PREFIX} {formatKyrgyzLocalPhone(phone)}</strong>.<button className="login-change-phone" type="button" onClick={() => { setCodeSent(false); setCode(""); setMessage(""); }}>Изменить номер</button></> : <>Введите номер телефона. В течение минуты мы отправим вам <strong>SMS с одноразовым кодом</strong>.</>}</div>
        <label className="login-phone-field"><span className="visually-hidden">{codeSent ? "Код из SMS" : "Номер телефона"}</span>{!codeSent && <span aria-hidden="true">+996</span>}<input value={codeSent ? code : formatKyrgyzLocalPhone(phone)} onChange={(event) => codeSent ? setCode(event.target.value.replace(/\D/g, "").slice(0, 8)) : setPhone(kyrgyzLocalDigits(event.target.value))} placeholder={codeSent ? "Код из SMS" : "(___) ___-___"} inputMode={codeSent ? "numeric" : "tel"} autoComplete={codeSent ? "one-time-code" : "tel"} /></label>
        <div className="login-submit-row"><button type="button" onClick={codeSent ? verifyCode : requestCode} disabled={pending || (codeSent ? code.length < 4 : phone.length !== 9)}>{pending ? "Подождите…" : codeSent ? "Войти" : "Получить код"}</button></div>
        <div className="login-consent">Продолжая, вы принимаете <a href="/legal">правовую информацию</a>, <a href="/privacy">политику конфиденциальности</a> и <a href="/terms">условия использования</a>.</div>
        {message && <small className="form-message" aria-live="polite">{message}</small>}
      </div> : <>
        <header className={`customer-account-screen-header${section === "menu" ? " is-menu" : ""}${section === "orders" ? " is-orders" : ""}`}>
          <button type="button" onClick={() => { if (section === "menu") onClose(); else setSection("menu"); }} aria-label={section === "menu" ? "Закрыть личный кабинет" : "Вернуться в меню"}><Icon path={mdiArrowLeft} size={1} aria-hidden="true" /></button>
          <h2 id="customer-account-title">{screenTitle}</h2>
          <span aria-hidden="true" />
        </header>

        <div className={`customer-account-content section-${section}`}>
          {profileError && <div className="customer-account-error" role="alert"><span>{profileError}</span><button type="button" onClick={() => void loadProfile(session)}>Повторить</button></div>}
          {profileLoading && !profile && <div className="customer-account-loading">Загружаем профиль…</div>}

          {section === "menu" && <div className="customer-account-menu-view">
            <section className="customer-account-summary">
              <div><small>Привет!</small><strong>{session.phone}</strong></div>
              <button type="button" disabled={logoutBusy} onClick={() => void logout()}>{logoutBusy ? "Выходим…" : <>Выйти <Icon path={mdiLogout} size={0.72} aria-hidden="true" /></>}</button>
            </section>
            <nav className="customer-account-menu" aria-label="Разделы личного кабинета">
              <button type="button" onClick={() => { setOrderSection("active"); setSection("orders"); }}><Icon path={mdiShoppingOutline} size={1} aria-hidden="true" /><b>Мои заказы</b><Icon path={mdiChevronRight} size={0.95} aria-hidden="true" /></button>
              <button type="button" onClick={() => setSection("rewards")}><Icon path={mdiStarFourPointsOutline} size={1} aria-hidden="true" /><b>NAKTA Coin и NFT</b><em><span>{numberFormat.format(profile?.naktaCoins || 0)}</span><small>{profile?.nfts.length || 0} NFT</small></em><Icon path={mdiChevronRight} size={0.95} aria-hidden="true" /></button>
              <button type="button" onClick={() => setSection("account")}><Icon path={mdiCogOutline} size={1} aria-hidden="true" /><b>Настройки</b><Icon path={mdiChevronRight} size={0.95} aria-hidden="true" /></button>
              <a href="/support"><Icon path={mdiMessageReplyTextOutline} size={1} aria-hidden="true" /><b>Поддержка</b><Icon path={mdiChevronRight} size={0.95} aria-hidden="true" /></a>
              <a href="/about"><Icon path={mdiInformationOutline} size={1} aria-hidden="true" /><b>О нас</b><Icon path={mdiChevronRight} size={0.95} aria-hidden="true" /></a>
            </nav>
            <footer className="customer-account-menu-footer"><Image src="/assets/icons/logo.svg" alt="Daana Sushi" width={106} height={64} /><a href="/legal">Правовая информация</a><small>Версия 0.1.0</small></footer>
          </div>}

          {profile && section === "rewards" && <div className="customer-rewards-view">
            <section className="profile-balance-card"><div><span>Ваш баланс</span><strong>{numberFormat.format(profile.naktaCoins)}</strong></div><Image src="/nakta-coin.png" alt="NAKTA Coin" width={78} height={78} /></section>
            <section className="profile-nft-balance-card"><div><span>Ваши NFT</span><strong>{numberFormat.format(profile.nfts.length)}</strong><small>цифровых наград</small></div><i aria-hidden="true"><Icon path={mdiHexagonMultipleOutline} size={1.5} /></i></section>
            <button className="profile-reward-withdraw-button" type="button" disabled={profile.naktaCoins <= 0 && !availableNfts.length} onClick={() => setWithdrawalOpen(true)}><Icon path={mdiBankTransferOut} size={1} aria-hidden="true" />Вывести</button>
            <section className="profile-info-card profile-reward-explainer"><h3>Как работают NAKTA Coin и NFT</h3><p>Награды не тратятся внутри сайта. Накопленные коины и NFT можно вывести на свой криптокошелёк.</p></section>

            <section className="profile-info-card profile-reward-history">
              <h3>История операций</h3>
              {hasRewardOperations ? <div className="profile-coin-history">
                {coinHistory.map((entry) => <article className="profile-history-row" key={entry.id}>
                  <div className="profile-history-main"><span><b>{entry.description}</b><small>{formatHistoryDate(entry.createdAt)}</small></span><strong className={entry.amount < 0 ? "negative" : ""}>{entry.amount > 0 ? "+" : ""}{numberFormat.format(entry.amount)}</strong></div>
                  {entry.withdrawalReason ? <p className="profile-withdrawal-reason">Причина: {entry.withdrawalReason}</p> : null}
                  {entry.withdrawalStatus === "pending" && entry.withdrawalId ? <button type="button" className="profile-cancel-withdrawal" onClick={() => { setCancelError(""); setCancelTarget({ kind: "coins", id: entry.withdrawalId!, label: `${Math.abs(entry.amount)} NAKTA Coin` }); }}>Отменить вывод</button> : null}
                </article>)}
                {nftOperations.map((nft) => <article className="profile-history-row profile-nft-operation" key={`nft-${nft.id}`}>
                  <div className="profile-history-main"><span><b>Вывод NFT «{nft.name}»</b><small>{networkLabels[nft.network] || nft.network} · {rewardStatusLabels[nft.status] || nft.status}</small></span><strong className={`nft-status status-${nft.status}`}>NFT</strong></div>
                  {nft.walletAddress ? <p className="profile-withdrawal-address" title={nft.walletAddress}>Кошелёк: {nft.walletAddress}</p> : null}
                  {nft.withdrawalError ? <p className="profile-withdrawal-reason">Причина: {nft.withdrawalError}</p> : null}
                  {nft.status === "pending" ? <button type="button" className="profile-cancel-withdrawal" onClick={() => { setCancelError(""); setCancelTarget({ kind: "nft", id: nft.id, label: `NFT «${nft.name}»` }); }}>Отменить вывод</button> : null}
                </article>)}
              </div> : <p>Операций пока нет.</p>}
            </section>
          </div>}

          {profile && section === "orders" && <div className="customer-orders-view">
            <h2>Мои заказы</h2>
            <div className="customer-order-tabs" role="tablist" aria-label="Заказы">
              <button className={orderSection === "active" ? "active" : ""} type="button" role="tab" aria-selected={orderSection === "active"} onClick={() => setOrderSection("active")}>Активные</button>
              <button className={orderSection === "history" ? "active" : ""} type="button" role="tab" aria-selected={orderSection === "history"} onClick={() => setOrderSection("history")}>История</button>
            </div>
            <div className="customer-order-list">{visibleOrders.length ? visibleOrders.map((order) => <OrderCard order={order} key={order.id} />) : <div className="customer-orders-empty"><span className="customer-orders-empty-art" aria-hidden="true"><Icon path={mdiFoodTakeoutBoxOutline} size={3.15} /><Icon path={mdiFish} size={1.55} /></span><p>{orderSection === "active" ? <>Пока здесь пусто,<br />пора сделать первый заказ!</> : "История заказов пока пуста."}</p><button type="button" onClick={onClose}>Меню</button></div>}</div>
          </div>}

          {profile && section === "account" && <div className="customer-profile-view">
            <section className="profile-settings-field"><span>Телефон аккаунта</span><strong>{profile.customer.phone || session.phone}</strong></section>
            <section className="profile-settings-field"><span>Баланс NAKTA Coin</span><strong>{numberFormat.format(profile.naktaCoins)}</strong></section>
            <section className="profile-settings-field"><span>Получено NFT</span><strong>{numberFormat.format(profile.nfts.length)}</strong></section>
            <a className="profile-settings-link" href="/legal">Правовая информация <span>›</span></a>
            <button type="button" className="profile-logout" disabled={logoutBusy} onClick={() => void logout()}>{logoutBusy ? "Выходим…" : <>Выйти из профиля <span><Icon path={mdiLogout} size={0.9} aria-hidden="true" /></span></>}</button>
          </div>}
        </div>
      </>}
    </section>

    {session && profile && withdrawalOpen && <RewardsWithdrawalDialog coins={profile.naktaCoins} coinNetwork={effectiveCoinNetwork} nfts={profile.nfts} onClose={() => setWithdrawalOpen(false)} onSubmit={submitWithdrawal} />}

    {cancelTarget && <div className="customer-cancel-overlay reward-cancel-overlay" role="dialog" aria-modal="true" aria-labelledby="customer-cancel-title">
      <button className="customer-cancel-dismiss" type="button" aria-label="Закрыть подтверждение" disabled={cancelBusy} onClick={() => setCancelTarget(null)} />
      <section className="customer-cancel-dialog reward-cancel-dialog"><span className="reward-cancel-icon"><Icon path={mdiAlertCircleOutline} size={1.1} aria-hidden="true" /></span><h2 id="customer-cancel-title">Отменить вывод?</h2><p>{cancelTarget.kind === "coins" ? `${cancelTarget.label} вернутся на баланс.` : `${cancelTarget.label} снова станет доступен для вывода.`} Отмена возможна только до начала обработки.</p>{cancelError && <div className="customer-account-error" role="alert">{cancelError}</div>}<div><button type="button" disabled={cancelBusy} onClick={() => setCancelTarget(null)}>Не отменять</button><button type="button" disabled={cancelBusy} onClick={() => void cancelWithdrawal()}>{cancelBusy ? "Отменяем…" : "Отменить вывод"}</button></div></section>
    </div>}
  </div>;
}
