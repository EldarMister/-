"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Customer,
  CustomerProfile,
  CustomerSession,
  NaktaCoinWithdrawal,
  ProfileOrder,
} from "../types";
import RewardsWithdrawalDialog, { type RewardWithdrawalInput } from "./RewardsWithdrawalDialog";

type Props = {
  apiUrl: string;
  coinNetwork: string;
  onClose: () => void;
  onSessionChange?: (active: boolean) => void;
};

type AccountSection = "rewards" | "orders" | "account";
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

function formatDate(value?: string | null) {
  if (!value) return "Дата не указана";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата не указана";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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
    <div><strong>Заказ №{order.orderNumber || order.id}</strong><span className={`customer-status status-${order.status}`}>{orderStatusLabels[order.status] || order.status}</span></div>
    <p>{formatDate(order.createdAt)}{order.locationName ? ` · ${order.locationName}` : ""}</p>
    <footer><strong>{numberFormat.format(Number(order.total) || 0)} С</strong>{(order.earnedNaktaCoins || order.naktaCoins) ? <span>+{numberFormat.format(order.earnedNaktaCoins || order.naktaCoins || 0)} NAKTA Coin</span> : null}</footer>
  </article>;
}

export default function CustomerAccountModal({ apiUrl, coinNetwork, onClose, onSessionChange }: Props) {
  const sessionGenerationRef = useRef(0);
  const profileRequestGenerationRef = useRef(0);
  const [checked, setChecked] = useState(false);
  const [session, setSession] = useState<CustomerSession | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [section, setSection] = useState<AccountSection>("rewards");
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
    setSection("rewards");
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
  const rewardTransactions = profile?.naktaCoinHistory.filter((entry) => !entry.withdrawalId) || [];
  const allOrders = useMemo(() => [...(profile?.currentOrders || []), ...(profile?.orderHistory || [])], [profile]);
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

  return <div className="customer-account-overlay" role="dialog" aria-modal="true" aria-labelledby="customer-account-title">
    <button className="customer-account-dismiss" type="button" aria-label="Закрыть личный кабинет" disabled={pending} onClick={onClose} />
    <section className={`customer-account-modal${session ? " is-authenticated" : ""}`}>
      <button className="customer-account-close" type="button" onClick={onClose} aria-label="Закрыть"><MaterialIcon>close</MaterialIcon></button>

      {!checked ? <div className="customer-account-loading">Проверяем сессию…</div> : !session ? <div className="customer-login-view">
        <div className="login-circle"><MaterialIcon>key</MaterialIcon></div>
        <h2 id="customer-account-title">Личный кабинет</h2>
        <div className="login-caption">{codeSent ? <>Мы отправили SMS с кодом на номер <strong>{KYRGYZ_PHONE_PREFIX} {formatKyrgyzLocalPhone(phone)}</strong>.<button className="login-change-phone" type="button" onClick={() => { setCodeSent(false); setCode(""); setMessage(""); }}>Изменить номер</button></> : <>Введите номер телефона. В течение минуты мы отправим вам <strong>SMS с одноразовым кодом</strong>.</>}</div>
        <label className="login-phone-field"><span className="visually-hidden">{codeSent ? "Код из SMS" : "Номер телефона"}</span>{!codeSent && <span aria-hidden="true">+996</span>}<input value={codeSent ? code : formatKyrgyzLocalPhone(phone)} onChange={(event) => codeSent ? setCode(event.target.value.replace(/\D/g, "").slice(0, 8)) : setPhone(kyrgyzLocalDigits(event.target.value))} placeholder={codeSent ? "Код из SMS" : "(___) ___-___"} inputMode={codeSent ? "numeric" : "tel"} autoComplete={codeSent ? "one-time-code" : "tel"} /></label>
        <div className="login-submit-row"><button type="button" onClick={codeSent ? verifyCode : requestCode} disabled={pending || (codeSent ? code.length < 4 : phone.length !== 9)}>{pending ? "Подождите…" : codeSent ? "Войти" : "Получить код"}</button></div>
        <div className="login-consent">Продолжая, вы принимаете <a href="/legal">правовую информацию</a>, <a href="/privacy">политику конфиденциальности</a> и <a href="/terms">условия использования</a>.</div>
        {message && <small className="form-message" aria-live="polite">{message}</small>}
      </div> : <>
        <header className="customer-account-header">
          <div><small>Личный кабинет</small><h2 id="customer-account-title">{profile?.customer.name || session.customer.name || "Гость ДААНА"}</h2><span>{session.phone}</span></div>
          <button type="button" disabled={logoutBusy} onClick={() => void logout()}>{logoutBusy ? "Выходим…" : <>Выйти <MaterialIcon>logout</MaterialIcon></>}</button>
        </header>
        <nav className="customer-account-tabs" aria-label="Разделы личного кабинета">
          <button type="button" className={section === "rewards" ? "active" : ""} onClick={() => setSection("rewards")}><MaterialIcon>stars</MaterialIcon><span>Награды</span></button>
          <button type="button" className={section === "orders" ? "active" : ""} onClick={() => setSection("orders")}><MaterialIcon>receipt_long</MaterialIcon><span>Заказы</span></button>
          <button type="button" className={section === "account" ? "active" : ""} onClick={() => setSection("account")}><MaterialIcon>person</MaterialIcon><span>Профиль</span></button>
        </nav>

        <div className="customer-account-content">
          {profileError && <div className="customer-account-error" role="alert"><span>{profileError}</span><button type="button" onClick={() => void loadProfile(session)}>Повторить</button></div>}
          {profileLoading && !profile && <div className="customer-account-loading">Загружаем профиль…</div>}

          {profile && section === "rewards" && <div className="customer-rewards-view">
            <div className="customer-reward-balances">
              <section className="customer-coin-card"><div><span>Ваш баланс</span><strong>{numberFormat.format(profile.naktaCoins)}</strong><small>NAKTA Coin</small></div><i>NC</i></section>
              <section className="customer-nft-card"><div><span>Ваши NFT</span><strong>{numberFormat.format(profile.nfts.length)}</strong><small>цифровых наград</small></div><i><MaterialIcon>hexagon</MaterialIcon></i></section>
            </div>
            <button className="customer-withdraw-button" type="button" disabled={profile.naktaCoins <= 0 && !availableNfts.length} onClick={() => setWithdrawalOpen(true)}><MaterialIcon>account_balance_wallet</MaterialIcon>Вывести на криптокошелёк</button>
            <section className="customer-reward-explainer"><MaterialIcon>info</MaterialIcon><div><h3>Как работают награды</h3><p>NAKTA Coin начисляются после завершённых заказов. Награды не тратятся внутри сайта — их можно вывести на свой криптокошелёк.</p></div></section>

            <section className="customer-reward-section">
              <header><div><h3>NFT</h3><p>Цифровые награды в вашем профиле</p></div><b>{profile.nfts.length}</b></header>
              {profile.nfts.length ? <div className="customer-nft-list">{profile.nfts.map((nft) => <article className="customer-nft-item" key={nft.id}>
                <div className="customer-nft-art">{nft.image ? <img src={nft.image} alt="" /> : <MaterialIcon>hexagon</MaterialIcon>}</div>
                <div><span><strong>{nft.name}</strong><em className={`status-${nft.status}`}>{rewardStatusLabels[nft.status] || nft.status}</em></span><small>{networkLabels[nft.network] || nft.network} · {formatDate(nft.createdAt)}</small>{nft.walletAddress && <p title={nft.walletAddress}>Кошелёк: {nft.walletAddress}</p>}{nft.withdrawalError && <p className="error">Причина: {nft.withdrawalError}</p>}{nft.status === "pending" && <button type="button" onClick={() => { setCancelError(""); setCancelTarget({ kind: "nft", id: nft.id, label: `NFT «${nft.name}»` }); }}>Отменить вывод</button>}</div>
              </article>)}</div> : <p className="customer-empty-state">NFT появятся здесь после начисления.</p>}
            </section>

            <section className="customer-reward-section">
              <header><div><h3>Заявки на вывод</h3><p>Статусы переводов NAKTA Coin и NFT</p></div></header>
              {profile.naktaCoinWithdrawals.length || nftOperations.length ? <div className="customer-operation-list">
                {profile.naktaCoinWithdrawals.map((item: NaktaCoinWithdrawal) => <article key={item.id}><div><strong>Вывод {numberFormat.format(item.amount)} NAKTA Coin</strong><span>{formatDate(item.createdAt)} · {rewardStatusLabels[item.status] || item.status} · сеть {networkLabels[item.network || effectiveCoinNetwork] || item.network || effectiveCoinNetwork}</span><small title={item.walletAddress}>{item.walletAddress}</small>{item.error && <p>Причина: {item.error}</p>}</div><aside><em className={`status-${item.status}`}>{rewardStatusLabels[item.status] || item.status}</em>{item.status === "pending" && <button type="button" onClick={() => { setCancelError(""); setCancelTarget({ kind: "coins", id: item.id, label: `${item.amount} NAKTA Coin` }); }}>Отменить</button>}</aside></article>)}
                {nftOperations.map((nft) => <article key={`nft-${nft.id}`}><div><strong>Вывод NFT «{nft.name}»</strong><span>{networkLabels[nft.network] || nft.network} · {rewardStatusLabels[nft.status] || nft.status}</span>{nft.walletAddress && <small title={nft.walletAddress}>{nft.walletAddress}</small>}{nft.withdrawalError && <p>Причина: {nft.withdrawalError}</p>}</div><aside><em className={`status-${nft.status}`}>NFT</em>{nft.status === "pending" && <button type="button" onClick={() => { setCancelError(""); setCancelTarget({ kind: "nft", id: nft.id, label: `NFT «${nft.name}»` }); }}>Отменить</button>}</aside></article>)}
              </div> : <p className="customer-empty-state">Заявок на вывод пока нет.</p>}
            </section>

            <section className="customer-reward-section">
              <header><div><h3>История начислений</h3><p>Награды за заказы и ручные корректировки</p></div></header>
              {rewardTransactions.length ? <div className="customer-coin-history">{rewardTransactions.map((entry) => <article key={entry.id}><div><strong>{entry.description}</strong><span>{formatDate(entry.createdAt)}</span></div><b className={entry.amount < 0 ? "negative" : ""}>{entry.amount > 0 ? "+" : ""}{numberFormat.format(entry.amount)}</b></article>)}</div> : <p className="customer-empty-state">Начислений пока нет.</p>}
            </section>
          </div>}

          {profile && section === "orders" && <div className="customer-orders-view">
            <section><header><h3>Активные заказы</h3><b>{profile.currentOrders.length}</b></header>{profile.currentOrders.length ? <div>{profile.currentOrders.map((order) => <OrderCard order={order} key={order.id} />)}</div> : <p className="customer-empty-state">Активных заказов сейчас нет.</p>}</section>
            <section><header><h3>История заказов</h3><b>{profile.orderHistory.length}</b></header>{profile.orderHistory.length ? <div>{profile.orderHistory.map((order) => <OrderCard order={order} key={order.id} />)}</div> : <p className="customer-empty-state">История заказов пока пуста.</p>}</section>
          </div>}

          {profile && section === "account" && <div className="customer-profile-view">
            <section><span>Имя</span><strong>{profile.customer.name || "Не указано"}</strong></section>
            <section><span>Телефон</span><strong>{profile.customer.phone || session.phone}</strong></section>
            <section><span>Всего заказов</span><strong>{numberFormat.format(allOrders.length)}</strong></section>
            <nav><a href="/legal">Правовая информация <MaterialIcon>chevron_right</MaterialIcon></a><a href="/privacy">Конфиденциальность <MaterialIcon>chevron_right</MaterialIcon></a><a href="/terms">Условия использования <MaterialIcon>chevron_right</MaterialIcon></a></nav>
            <button type="button" className="customer-profile-logout" disabled={logoutBusy} onClick={() => void logout()}>{logoutBusy ? "Выходим…" : "Выйти из профиля"}</button>
          </div>}
        </div>
      </>}
    </section>

    {session && profile && withdrawalOpen && <RewardsWithdrawalDialog coins={profile.naktaCoins} coinNetwork={effectiveCoinNetwork} nfts={profile.nfts} onClose={() => setWithdrawalOpen(false)} onSubmit={submitWithdrawal} />}

    {cancelTarget && <div className="customer-cancel-overlay" role="dialog" aria-modal="true" aria-labelledby="customer-cancel-title">
      <button className="customer-cancel-dismiss" type="button" aria-label="Закрыть подтверждение" disabled={cancelBusy} onClick={() => setCancelTarget(null)} />
      <section className="customer-cancel-dialog"><span><MaterialIcon>warning_amber</MaterialIcon></span><h2 id="customer-cancel-title">Отменить вывод?</h2><p>{cancelTarget.kind === "coins" ? `${cancelTarget.label} вернутся на баланс.` : `${cancelTarget.label} снова станет доступен для вывода.`} Отмена возможна только до начала обработки.</p>{cancelError && <div className="customer-account-error" role="alert">{cancelError}</div>}<div><button type="button" disabled={cancelBusy} onClick={() => setCancelTarget(null)}>Не отменять</button><button type="button" disabled={cancelBusy} onClick={() => void cancelWithdrawal()}>{cancelBusy ? "Отменяем…" : "Отменить вывод"}</button></div></section>
    </div>}
  </div>;
}
