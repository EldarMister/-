"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Category, PickupLocation, Product, Promotion } from "../types";
import LocationsSection from "./LocationsSection";

const API_URL = process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:4000/api");

type Tab = "orders" | "products" | "categories" | "locations" | "promotions" | "users" | "loyalty" | "settings";
type Order = { id: number; orderNumber: string; customerName: string; customerPhone: string; status: string; total: number; createdAt: string; locationName: string; locationAddress: string; comment: string; items: Array<{ productName: string; unitPrice: number; quantity: number; lineTotal: number }> };
type Dashboard = { ordersToday: number; revenueToday: number; products: number; activeOrders: number };
type GeneralSettings = { legalName: string; telegram: string };
type RewardSettings = { coinNetwork: string; nftRewardEveryOrders: number; nftRewardName: string; nftRewardImage: string; nftRewardDescription: string; nftRewardNetwork: string; nftContractAddress: string; nftMetadataUri: string };
type AdminRequest = <T = unknown>(path: string, options?: RequestInit) => Promise<T>;
type CustomerSummary = { phone: string; customerName?: string | null; name?: string | null; ordersCount: number; completedOrders: number; revenue: number; naktaCoins: number; nftCount: number; pendingNftCount: number; availableNftCount?: number; lastOrderAt?: string | null };
type CustomerDetail = CustomerSummary & { availableNftCount: number; adjustments: Array<{ id: string; asset: "coin" | "nft"; delta: number; reason: string; balanceAfter: number; createdAt: string }> };
type CustomerList = { items: CustomerSummary[]; total: number; limit: number; offset: number };
type WithdrawalStatus = "pending" | "submitted" | "withdrawn" | "failed" | "cancelled";
type CoinWithdrawal = { id: string; phone: string; customerName?: string | null; amount: number; network?: string | null; walletAddress: string; status: WithdrawalStatus; txHash?: string | null; error?: string | null; createdAt: string };
type NftWithdrawal = { id: string; phone: string; customerName?: string | null; name: string; network: string; walletAddress: string | null; status: WithdrawalStatus | "owned"; txHash?: string | null; tokenId?: string | null; withdrawalError?: string | null; withdrawalRequestedAt?: string | null; createdAt: string };
type RewardAction = { asset: "coin" | "nft"; direction: "add" | "remove"; amount: string; reason: string };
type QueueAction = { kind: "coin" | "nft"; id: string; status: "submitted" | "withdrawn" | "failed"; txHash: string; tokenId: string; reason: string };

const statusLabels: Record<string, string> = { new: "Новый", confirmed: "Подтвержден", preparing: "Готовится", ready: "Готов", completed: "Выдан", cancelled: "Отменен" };
const withdrawalLabels: Record<string, string> = { owned: "Доступен", pending: "Ожидает", submitted: "В обработке", withdrawn: "Выведен", failed: "Ошибка", cancelled: "Отменён" };
const defaultRewards: RewardSettings = { coinNetwork: "polygon", nftRewardEveryOrders: 0, nftRewardName: "NFT DAANA", nftRewardImage: "", nftRewardDescription: "", nftRewardNetwork: "polygon", nftContractAddress: "", nftMetadataUri: "" };

const formatNumber = (value: number | undefined) => (Number(value) || 0).toLocaleString("ru-RU");
const formatMoney = (value: number | undefined) => `${formatNumber(Math.round(Number(value) || 0))} С`;
const displayName = (value: { customerName?: string | null; name?: string | null }) => value.customerName || value.name || "Без имени";
function formatDate(value?: string | null) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "—"; }
function asList<T>(value: T[] | { items?: T[] }) { return Array.isArray(value) ? value : value.items || []; }

function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setPending(true); setError(""); try { const response = await fetch(`${API_URL}/admin/login`, { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }); const result = await response.json().catch(() => ({})) as { ok?: boolean; user?: unknown; error?: string; message?: string }; if (!response.ok || (!result.ok && !result.user)) throw new Error(result.error || result.message || "Не удалось войти"); onLogin(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Сервер недоступен"); } finally { setPending(false); } };
  return <main className="admin-login"><form onSubmit={submit}><img src="/assets/icons/logo.svg" alt="ДААНА СУШИ" /><h1>Управление сайтом</h1><label>Пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <div className="admin-error">{error}</div>}<button disabled={pending}>{pending ? "Вход…" : "Войти"}</button><small>Пароль задаётся переменной ADMIN_PASSWORD.</small></form></main>;
}

function CrudSection({ title, rows, fields, empty, endpoint, request, onRefresh }: { title: string; rows: Array<Record<string, unknown>>; fields: Array<{ key: string; label: string; type?: "text" | "number" | "textarea" | "checkbox" }>; empty: Record<string, unknown>; endpoint: string; request: AdminRequest; onRefresh: () => Promise<void> }) {
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null); const [saving, setSaving] = useState(false);
  const save = async (event: FormEvent) => { event.preventDefault(); if (!editing) return; setSaving(true); try { const id = editing.id; await request(id ? `${endpoint}/${id}` : endpoint, { method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing) }); setEditing(null); await onRefresh(); } finally { setSaving(false); } };
  const remove = async (row: Record<string, unknown>) => { if (!window.confirm(`Удалить «${row.name || row.title}»?`)) return; await request(`${endpoint}/${row.id}`, { method: "DELETE" }); await onRefresh(); };
  return <section className="admin-section"><div className="section-title"><h2>{title}</h2><button className="admin-primary" onClick={() => setEditing({ ...empty })}>+ Добавить</button></div>{editing && <form className="editor-form" onSubmit={save}><h3>{editing.id ? "Редактирование" : "Новая запись"}</h3><div className="editor-grid">{fields.map((field) => field.type === "checkbox" ? <label className="check-field" key={field.key}><input type="checkbox" checked={Boolean(editing[field.key])} onChange={(event) => setEditing({ ...editing, [field.key]: event.target.checked })} />{field.label}</label> : <label key={field.key}>{field.label}{field.type === "textarea" ? <textarea value={String(editing[field.key] ?? "")} onChange={(event) => setEditing({ ...editing, [field.key]: event.target.value })} /> : <input type={field.type || "text"} value={String(editing[field.key] ?? "")} onChange={(event) => setEditing({ ...editing, [field.key]: field.type === "number" ? Number(event.target.value) : event.target.value })} required={field.key === "name" || field.key === "title"} />}</label>)}</div><div className="editor-actions"><button type="button" onClick={() => setEditing(null)}>Отмена</button><button className="admin-primary" disabled={saving}>Сохранить</button></div></form>}<div className="admin-table-wrap"><table><thead><tr>{fields.slice(0, 4).map((field) => <th key={field.key}>{field.label}</th>)}<th /></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}>{fields.slice(0, 4).map((field) => <td key={field.key}>{field.type === "checkbox" ? (row[field.key] ? "Да" : "Нет") : String(row[field.key] ?? "")}</td>)}<td className="row-actions"><button onClick={() => setEditing({ ...row })}>Изменить</button><button className="danger" onClick={() => void remove(row)}>Удалить</button></td></tr>)}</tbody></table></div></section>;
}

function UsersSection({ request, refreshKey }: { request: AdminRequest; refreshKey: number }) {
  const [users, setUsers] = useState<CustomerSummary[]>([]); const [total, setTotal] = useState(0); const [searchDraft, setSearchDraft] = useState(""); const [search, setSearch] = useState("");
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null); const [detail, setDetail] = useState<CustomerDetail | null>(null); const [action, setAction] = useState<RewardAction | null>(null);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const loadUsers = useCallback(async () => { setLoading(true); setError(""); try { const query = new URLSearchParams({ search, limit: "100", offset: "0" }); const result = await request<CustomerList | CustomerSummary[]>(`customers?${query}`); const items = asList(result); setUsers(items); setTotal(Array.isArray(result) ? items.length : result.total ?? items.length); } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить пользователей"); } finally { setLoading(false); } }, [request, search]);
  const loadDetail = useCallback(async (phone: string) => { setLoading(true); setError(""); try { const result = await request<CustomerDetail>(`customers/${encodeURIComponent(phone)}`); setDetail({ ...result, adjustments: result.adjustments || [] }); } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить карточку"); } finally { setLoading(false); } }, [request]);
  useEffect(() => { const timer = window.setTimeout(() => void loadUsers(), 0); return () => window.clearTimeout(timer); }, [loadUsers, refreshKey]);
  const submitAdjustment = async (event: FormEvent) => { event.preventDefault(); if (!action || !selectedPhone || saving) return; const amount = Number(action.amount); if (!Number.isInteger(amount) || amount < 1 || !action.reason.trim()) return; setSaving(true); setError(""); try { const updated = await request<CustomerDetail>(`customers/${encodeURIComponent(selectedPhone)}/rewards/adjust`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asset: action.asset, delta: action.direction === "add" ? amount : -amount, reason: action.reason.trim() }) }); if (updated?.adjustments) setDetail(updated); else await loadDetail(selectedPhone); setAction(null); setNotice("Баланс пользователя обновлён"); await loadUsers(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось изменить баланс"); } finally { setSaving(false); } };
  if (selectedPhone) return <div className="admin-users-workspace"><div className="admin-workspace-toolbar"><button onClick={() => { setSelectedPhone(null); setDetail(null); setError(""); }}>← К списку</button><button onClick={() => void loadDetail(selectedPhone)}>Обновить</button></div>{error && <div className="admin-error banner">{error}</div>}{notice && <div className="admin-success banner">{notice}</div>}{loading && !detail ? <div className="admin-loading-card">Загружаем карточку…</div> : detail && <><section className="admin-customer-profile"><header><div><small>Карточка пользователя</small><h2>{displayName(detail)}</h2><a href={`tel:${detail.phone}`}>{detail.phone}</a></div><span>Последний заказ: {formatDate(detail.lastOrderAt)}</span></header><dl><div><dt>Заказы</dt><dd>{formatNumber(detail.ordersCount)}</dd><small>Завершено: {formatNumber(detail.completedOrders)}</small></div><div><dt>Покупки</dt><dd>{formatMoney(detail.revenue)}</dd><small>Завершённые заказы</small></div><div className="coin"><dt>NAKTA Coin</dt><dd>{formatNumber(detail.naktaCoins)}</dd><small>Доступный баланс</small></div><div className="nft"><dt>NFT</dt><dd>{formatNumber(detail.nftCount)}</dd><small>Доступно: {formatNumber(detail.availableNftCount)} · На выводе: {formatNumber(detail.pendingNftCount)}</small></div></dl></section><div className="admin-reward-controls"><section><h3>NAKTA Coin</h3><p>Начисление и корректировка баланса.</p><div><button className="admin-primary" onClick={() => setAction({ asset: "coin", direction: "add", amount: "1", reason: "" })}>+ Начислить</button><button disabled={detail.naktaCoins <= 0} onClick={() => setAction({ asset: "coin", direction: "remove", amount: "1", reason: "" })}>− Списать</button></div></section><section><h3>NFT</h3><p>Выведенные и ожидающие NFT не списываются.</p><div><button className="admin-primary" onClick={() => setAction({ asset: "nft", direction: "add", amount: "1", reason: "" })}>+ Начислить</button><button disabled={detail.availableNftCount <= 0} onClick={() => setAction({ asset: "nft", direction: "remove", amount: "1", reason: "" })}>− Списать</button></div></section></div><section className="admin-customer-history"><header><h3>История ручных изменений</h3><span>{detail.adjustments.length}</span></header>{detail.adjustments.length ? <div>{detail.adjustments.map((item) => <article key={item.id}><div><strong className={item.delta < 0 ? "negative" : ""}>{item.delta > 0 ? "+" : ""}{formatNumber(item.delta)} {item.asset === "coin" ? "NAKTA Coin" : "NFT"}</strong><p>{item.reason}</p><small>{formatDate(item.createdAt)}</small></div><span>Остаток: {formatNumber(item.balanceAfter)}</span></article>)}</div> : <p className="empty-admin">Изменений ещё нет.</p>}</section></>}{action && detail && <div className="admin-modal-backdrop"><section className="admin-action-dialog"><header><h2>{action.direction === "add" ? "Начислить" : "Списать"} {action.asset === "coin" ? "NAKTA Coin" : "NFT"}</h2><p>{displayName(detail)} · {detail.phone}</p></header><form onSubmit={submitAdjustment}><label>Количество<input type="number" min="1" required value={action.amount} onChange={(event) => setAction({ ...action, amount: event.target.value })} /></label><label>Причина<textarea required maxLength={240} value={action.reason} onChange={(event) => setAction({ ...action, reason: event.target.value })} placeholder="Например: компенсация" /></label><div><button type="button" onClick={() => setAction(null)}>Отмена</button><button className={action.direction === "remove" ? "danger-solid" : "admin-primary"} disabled={saving}>{saving ? "Сохраняем…" : "Сохранить"}</button></div></form></section></div>}</div>;
  return <div className="admin-users-workspace"><section className="admin-workspace-search"><form onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); }}><input type="search" placeholder="Имя или телефон" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} /><button className="admin-primary">Найти</button></form><span>Найдено: {total}</span></section>{error && <div className="admin-error banner">{error}</div>}{loading && !users.length ? <div className="admin-loading-card">Загружаем пользователей…</div> : users.length ? <section className="admin-customers-list"><div className="admin-table-wrap"><table><thead><tr><th>Пользователь</th><th>Заказы</th><th>Покупки</th><th>NAKTA Coin</th><th>NFT</th><th /></tr></thead><tbody>{users.map((user) => <tr key={user.phone}><td><strong>{displayName(user)}</strong><small>{user.phone}</small></td><td>{formatNumber(user.ordersCount)}<small>Завершено: {formatNumber(user.completedOrders)}</small></td><td>{formatMoney(user.revenue)}</td><td><b>{formatNumber(user.naktaCoins)}</b></td><td><b>{formatNumber(user.nftCount)}</b>{user.pendingNftCount > 0 && <small>На выводе: {user.pendingNftCount}</small>}</td><td><button onClick={() => { setSelectedPhone(user.phone); setDetail(null); void loadDetail(user.phone); }}>Открыть</button></td></tr>)}</tbody></table></div><div className="admin-customer-mobile-list">{users.map((user) => <article key={user.phone}><header><div><strong>{displayName(user)}</strong><span>{user.phone}</span></div><b>{formatMoney(user.revenue)}</b></header><dl><div><dt>Заказы</dt><dd>{formatNumber(user.ordersCount)}</dd></div><div><dt>Coin</dt><dd>{formatNumber(user.naktaCoins)}</dd></div><div><dt>NFT</dt><dd>{formatNumber(user.nftCount)}</dd></div></dl><button className="admin-primary" onClick={() => { setSelectedPhone(user.phone); setDetail(null); void loadDetail(user.phone); }}>Открыть карточку</button></article>)}</div></section> : <div className="admin-loading-card">Пользователи не найдены.</div>}</div>;
}

function QueueCard({ kind, item, onAction }: { kind: "coin" | "nft"; item: CoinWithdrawal | NftWithdrawal; onAction: (status: QueueAction["status"]) => void }) {
  const isCoin = kind === "coin"; const coin = item as CoinWithdrawal; const nft = item as NftWithdrawal; const error = isCoin ? coin.error : nft.withdrawalError; const date = isCoin ? item.createdAt : nft.withdrawalRequestedAt || item.createdAt; const walletAddress = item.walletAddress || ""; const network = isCoin ? coin.network : nft.network;
  return <article className="withdrawal-card"><header><div><strong>{isCoin ? `${formatNumber(coin.amount)} NAKTA Coin` : `NFT «${nft.name}»`}</strong><span>{network ? `${network} · ` : ""}{displayName(item)} · {item.phone}</span></div><em className={`withdrawal-status status-${item.status}`}>{withdrawalLabels[item.status]}</em></header><div className="withdrawal-wallet"><span>Кошелёк</span><b title={walletAddress}>{walletAddress || "Не указан"}</b><button disabled={!walletAddress} onClick={() => void navigator.clipboard?.writeText(walletAddress)}>Копировать</button></div><dl><div><dt>Создана</dt><dd>{formatDate(date)}</dd></div>{item.txHash && <div><dt>Хеш</dt><dd title={item.txHash}>{item.txHash}</dd></div>}{!isCoin && nft.tokenId && <div><dt>Token ID</dt><dd>{nft.tokenId}</dd></div>}{error && <div className="error"><dt>Причина</dt><dd>{error}</dd></div>}</dl><footer>{item.status === "pending" && <><button className="admin-primary" onClick={() => onAction("submitted")}>Взять в обработку</button><button className="danger" onClick={() => onAction("failed")}>Отклонить</button></>}{item.status === "submitted" && <button className="admin-primary" onClick={() => onAction("withdrawn")}>Завершить</button>}</footer></article>;
}

function LoyaltySection({ request, rewards, onRewardsChange, refreshKey }: { request: AdminRequest; rewards: RewardSettings; onRewardsChange: (value: RewardSettings) => void; refreshKey: number }) {
  const [draft, setDraft] = useState({ ...rewards }); const [coins, setCoins] = useState<CoinWithdrawal[]>([]); const [nfts, setNfts] = useState<NftWithdrawal[]>([]); const [customerTotal, setCustomerTotal] = useState(0);
  const [asset, setAsset] = useState<"coin" | "nft">("coin"); const [status, setStatus] = useState<"all" | WithdrawalStatus>("all"); const [action, setAction] = useState<QueueAction | null>(null); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const loadQueues = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const coinStatuses: WithdrawalStatus[] = ["pending", "submitted", "withdrawn", "failed", "cancelled"];
      const nftStatuses: Array<Exclude<WithdrawalStatus, "cancelled">> = ["pending", "submitted", "withdrawn", "failed"];
      const [coinGroups, nftGroups, customerData] = await Promise.all([
        Promise.all(coinStatuses.map((queueStatus) => request<CoinWithdrawal[] | { items?: CoinWithdrawal[] }>(`coin-withdrawals?status=${queueStatus}`))),
        Promise.all(nftStatuses.map((queueStatus) => request<NftWithdrawal[] | { items?: NftWithdrawal[] }>(`nft-withdrawals?status=${queueStatus}`))),
        request<CustomerList | CustomerSummary[]>("customers?limit=1&offset=0"),
      ]);
      setCoins(coinGroups.flatMap(asList));
      setNfts(nftGroups.flatMap(asList));
      const customerItems = asList(customerData);
      setCustomerTotal(Array.isArray(customerData) ? customerItems.length : customerData.total ?? customerItems.length);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить заявки"); }
    finally { setLoading(false); }
  }, [request]);
  useEffect(() => { const timer = window.setTimeout(() => void loadQueues(), 0); return () => window.clearTimeout(timer); }, [loadQueues, refreshKey]);
  const saveRewards = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { const value = { ...draft, nftRewardEveryOrders: Number(draft.nftRewardEveryOrders) || 0 }; await request("settings/rewards", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) }); onRewardsChange(value); setNotice("Настройки вознаграждений сохранены"); } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить настройки"); } finally { setSaving(false); } };
  const submitAction = async (event: FormEvent) => { event.preventDefault(); if (!action || saving) return; if (action.status === "withdrawn" && !action.txHash.trim()) { setError("Укажите хеш транзакции"); return; } if (action.status === "failed" && !action.reason.trim()) { setError("Укажите причину отклонения"); return; } setSaving(true); setError(""); try { const body: Record<string, string> = { status: action.status }; if (action.status === "withdrawn") { body.txHash = action.txHash.trim(); if (action.kind === "nft" && action.tokenId.trim()) body.tokenId = action.tokenId.trim(); } if (action.status === "failed") body.error = action.reason.trim(); await request(`${action.kind === "coin" ? "coin-withdrawals" : "nft-withdrawals"}/${encodeURIComponent(action.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); setAction(null); setNotice(action.status === "submitted" ? "Заявка взята в обработку" : action.status === "withdrawn" ? "Вывод завершён" : "Заявка отклонена"); await loadQueues(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось обновить заявку"); } finally { setSaving(false); } };
  const beginAction = (kind: "coin" | "nft", item: CoinWithdrawal | NftWithdrawal, next: QueueAction["status"]) => setAction({ kind, id: item.id, status: next, txHash: item.txHash || "", tokenId: "tokenId" in item ? item.tokenId || "" : "", reason: "" });
  const pendingCoins = coins.filter((item) => item.status === "pending"); const pendingNfts = nfts.filter((item) => item.status === "pending"); const visibleCoins = coins.filter((item) => status === "all" || item.status === status); const visibleNfts = nfts.filter((item) => status === "all" || item.status === status);
  return (
    <div className="admin-loyalty-workspace">
      {error && <div className="admin-error banner">{error}</div>}
      {notice && <div className="admin-success banner">{notice}</div>}
      <div className="loyalty-stat-grid">
        <div><span>Пользователей</span><strong>{customerTotal}</strong></div>
        <div className="coin"><span>Coin ожидают</span><strong>{formatNumber(pendingCoins.reduce((sum, item) => sum + item.amount, 0))}</strong><small>{pendingCoins.length} заявок</small></div>
        <div className="nft"><span>NFT ожидают</span><strong>{pendingNfts.length}</strong></div>
        <div><span>Авто-NFT</span><strong>{draft.nftRewardEveryOrders > 0 ? `Каждые ${draft.nftRewardEveryOrders}` : "Выкл."}</strong><small>завершённых заказов</small></div>
      </div>

      <section className="admin-loyalty-settings">
        <div className="section-title"><div><h2>Программа наград</h2><p>0 отключает автоматическую выдачу NFT.</p></div></div>
        <form onSubmit={saveRewards}>
          <div className="editor-grid">
            <label>Сеть NAKTA Coin<select value={draft.coinNetwork} onChange={(event) => setDraft({ ...draft, coinNetwork: event.target.value })}><option value="polygon">Polygon</option><option value="ethereum">Ethereum</option><option value="bsc">BNB Smart Chain</option><option value="solana">Solana</option><option value="ton">TON</option></select></label>
            <label>За каждые N заказов<input type="number" min="0" max="10000" value={draft.nftRewardEveryOrders} onChange={(event) => setDraft({ ...draft, nftRewardEveryOrders: Number(event.target.value) })} /></label>
            <label>Название NFT<input required value={draft.nftRewardName} onChange={(event) => setDraft({ ...draft, nftRewardName: event.target.value })} /></label>
            <label>Сеть NFT<select value={draft.nftRewardNetwork} onChange={(event) => setDraft({ ...draft, nftRewardNetwork: event.target.value })}><option value="polygon">Polygon</option><option value="ethereum">Ethereum</option><option value="bsc">BNB Smart Chain</option><option value="solana">Solana</option><option value="ton">TON</option></select></label>
            <label>Адрес контракта<input value={draft.nftContractAddress} onChange={(event) => setDraft({ ...draft, nftContractAddress: event.target.value })} /></label>
            <label className="wide-field">Изображение NFT<input value={draft.nftRewardImage} onChange={(event) => setDraft({ ...draft, nftRewardImage: event.target.value })} placeholder="https://…" /></label>
            <label className="wide-field">Ссылка на метаданные<input value={draft.nftMetadataUri} onChange={(event) => setDraft({ ...draft, nftMetadataUri: event.target.value })} placeholder="ipfs://…" /></label>
            <label className="wide-field">Описание<textarea value={draft.nftRewardDescription} onChange={(event) => setDraft({ ...draft, nftRewardDescription: event.target.value })} /></label>
          </div>
          <button className="admin-primary" disabled={saving}>{saving ? "Сохраняем…" : "Сохранить программу"}</button>
        </form>
      </section>

      <section className="admin-withdrawals">
        <div className="section-title"><div><h2>Заявки на вывод</h2><p>Сначала возьмите заявку в обработку, затем выполните перевод и сохраните хеш транзакции.</p></div></div>
        <div className="withdrawal-toolbar">
          <div>
            <button className={asset === "coin" ? "active" : ""} onClick={() => setAsset("coin")}>NAKTA Coin <b>{coins.length}</b></button>
            <button className={asset === "nft" ? "active" : ""} onClick={() => setAsset("nft")}>NFT <b>{nfts.length}</b></button>
          </div>
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="all">Все статусы</option><option value="pending">Ожидают</option><option value="submitted">В обработке</option><option value="withdrawn">Выведены</option><option value="failed">Ошибки</option><option value="cancelled">Отменены</option>
          </select>
        </div>
        {loading ? <div className="admin-loading-card">Загружаем заявки…</div> : <div className="withdrawal-list">{asset === "coin" ? visibleCoins.map((item) => <QueueCard kind="coin" item={item} key={item.id} onAction={(next) => beginAction("coin", item, next)} />) : visibleNfts.map((item) => <QueueCard kind="nft" item={item} key={item.id} onAction={(next) => beginAction("nft", item, next)} />)}</div>}
        {!loading && (asset === "coin" ? visibleCoins : visibleNfts).length === 0 && <div className="empty-admin">Заявок нет.</div>}
      </section>

      {action && (
        <div className="admin-modal-backdrop">
          <section className="admin-action-dialog" role="dialog" aria-modal="true" aria-labelledby="withdrawal-action-title">
            <header>
              <h2 id="withdrawal-action-title">{action.status === "submitted" ? "Взять в обработку" : action.status === "withdrawn" ? "Завершить вывод" : "Отклонить заявку"}</h2>
              <p>{action.kind === "coin" ? "NAKTA Coin" : "NFT"} · {action.id.slice(0, 8)}</p>
            </header>
            <form onSubmit={submitAction}>
              {action.status === "submitted" ? (
                <div className="admin-claim-warning">
                  <strong>Проверьте сеть и адрес кошелька</strong>
                  <p>После подтверждения клиент уже не сможет отменить заявку. Хеш транзакции потребуется на следующем шаге, после фактической отправки.</p>
                </div>
              ) : action.status === "failed" ? (
                <label>Причина<textarea required value={action.reason} onChange={(event) => setAction({ ...action, reason: event.target.value })} placeholder="Будет видна пользователю" /></label>
              ) : (
                <>
                  <label>Хеш транзакции<input required value={action.txHash} onChange={(event) => setAction({ ...action, txHash: event.target.value })} placeholder="0x…" /></label>
                  {action.kind === "nft" && <label>Token ID (необязательно)<input value={action.tokenId} onChange={(event) => setAction({ ...action, tokenId: event.target.value })} /></label>}
                </>
              )}
              <div>
                <button type="button" onClick={() => setAction(null)}>Отмена</button>
                <button className={action.status === "failed" ? "danger-solid" : "admin-primary"} disabled={saving}>{saving ? "Сохраняем…" : action.status === "submitted" ? "Взять в обработку" : action.status === "withdrawn" ? "Завершить" : "Отклонить"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default function AdminPanel() {
  const adminSessionGenerationRef = useRef(0); const adminLoadGenerationRef = useRef(0);
  const [authenticated, setAuthenticated] = useState(false); const [sessionChecked, setSessionChecked] = useState(false); const [logoutBusy, setLogoutBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("orders"); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [refreshKey, setRefreshKey] = useState(0);
  const [dashboard, setDashboard] = useState<Dashboard>({ ordersToday: 0, revenueToday: 0, products: 0, activeOrders: 0 }); const [orders, setOrders] = useState<Order[]>([]); const [selectedOrder, setSelectedOrder] = useState<Order | null>(null); const [products, setProducts] = useState<Product[]>([]); const [categories, setCategories] = useState<Category[]>([]); const [locations, setLocations] = useState<PickupLocation[]>([]); const [promotions, setPromotions] = useState<Promotion[]>([]); const [productEditing, setProductEditing] = useState<Partial<Product> | null>(null);
  const [settings, setSettings] = useState<GeneralSettings>({ legalName: "ИП Мусаев Жаныбек Кочкорбаевич", telegram: "https://t.me/BIG_REST_TEAM" }); const [rewards, setRewards] = useState(defaultRewards);
  useEffect(() => {
    localStorage.removeItem("sushi-admin-token");
    const sessionGeneration = ++adminSessionGenerationRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${API_URL}/admin/session`, { credentials: "include", cache: "no-store", signal: controller.signal });
        if (adminSessionGenerationRef.current !== sessionGeneration) return;
        setAuthenticated(response.ok);
        if (!response.ok) setLoading(false);
      } catch {
        if (controller.signal.aborted || adminSessionGenerationRef.current !== sessionGeneration) return;
        setAuthenticated(false);
        setLoading(false);
      } finally {
        if (adminSessionGenerationRef.current === sessionGeneration) setSessionChecked(true);
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (adminSessionGenerationRef.current === sessionGeneration) adminSessionGenerationRef.current += 1;
      adminLoadGenerationRef.current += 1;
    };
  }, []);
  const request = useCallback(async <T = unknown,>(path: string, options: RequestInit = {}): Promise<T> => { const requestSessionGeneration = adminSessionGenerationRef.current; const response = await fetch(`${API_URL}/admin/${path.replace(/^\/+/, "")}`, { ...options, credentials: "include", cache: "no-store", headers: { ...(options.headers || {}) } }); if (response.status === 401) { if (adminSessionGenerationRef.current === requestSessionGeneration) { adminSessionGenerationRef.current += 1; adminLoadGenerationRef.current += 1; setAuthenticated(false); setSessionChecked(true); setLoading(false); } throw new Error("Сессия истекла"); } if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string; message?: string | string[] }; const detail = Array.isArray(body.message) ? body.message.join(", ") : body.message; throw new Error(body.error || detail || "Ошибка запроса"); } if (response.status === 204) return null as T; return response.json() as Promise<T>; }, []);
  const loadAll = useCallback(async () => { if (!authenticated) return; const sessionGeneration = adminSessionGenerationRef.current; const loadGeneration = ++adminLoadGenerationRef.current; const isCurrentLoad = () => authenticated && adminSessionGenerationRef.current === sessionGeneration && adminLoadGenerationRef.current === loadGeneration; setLoading(true); setError(""); try { const [dashboardData, orderData, productData, categoryData, locationData, promotionData, rows] = await Promise.all([request<Dashboard>("dashboard"), request<Order[]>("orders"), request<Product[]>("products"), request<Category[]>("categories"), request<PickupLocation[]>("locations"), request<Promotion[]>("promotions"), request<Array<{ key: string; value: unknown }>>("settings")]); if (!isCurrentLoad()) return; setDashboard(dashboardData); setOrders(orderData); setProducts(productData); setCategories(categoryData); setLocations(locationData); setPromotions(promotionData); const general = rows.find((row) => row.key === "general")?.value as Partial<GeneralSettings> | undefined; const rewardProgram = rows.find((row) => row.key === "rewards")?.value as Partial<RewardSettings> | undefined; if (general) setSettings((current) => ({ ...current, ...general })); if (rewardProgram) setRewards({ ...defaultRewards, ...rewardProgram, nftRewardEveryOrders: Number(rewardProgram.nftRewardEveryOrders) || 0 }); } catch (reason) { if (isCurrentLoad()) setError(reason instanceof Error ? reason.message : "Не удалось загрузить данные"); } finally { if (isCurrentLoad()) setLoading(false); } }, [authenticated, request]);
  useEffect(() => { const timer = window.setTimeout(() => void loadAll(), 0); return () => window.clearTimeout(timer); }, [loadAll]);
  useEffect(() => { if (!selectedOrder) return; const previous = document.body.style.overflow; const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedOrder(null); }; document.body.style.overflow = "hidden"; document.addEventListener("keydown", close); return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", close); }; }, [selectedOrder]);
  const productSave = async (event: FormEvent) => { event.preventDefault(); if (!productEditing) return; await request(productEditing.id ? `products/${productEditing.id}` : "products", { method: productEditing.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...productEditing, naktaCoins: Number(productEditing.naktaCoins) || 0 }) }); setProductEditing(null); await loadAll(); };
  const uploadProductImage = async (file: File) => { const body = new FormData(); body.append("file", file); const result = await request<{ url: string }>("upload", { method: "POST", body }); setProductEditing((current) => current ? { ...current, image: `${API_URL.replace(/\/api$/, "")}${result.url}` } : current); };
  const deleteProduct = async (product: Product) => { if (!window.confirm(`Удалить «${product.name}»?`)) return; await request(`products/${product.id}`, { method: "DELETE" }); await loadAll(); };
  const updateStatus = async (order: Order, status: string) => { await request(`orders/${order.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); await loadAll(); };
  const cancelOrder = async (order: Order) => { if (!window.confirm(`Отменить заказ №${order.orderNumber}?`)) return; try { await updateStatus(order, "cancelled"); setSelectedOrder(null); } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось отменить заказ"); } };
  const saveSettings = async (event: FormEvent) => { event.preventDefault(); await request("settings/general", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: settings }) }); setNotice("Настройки сохранены"); };
  const handleLogin = useCallback(() => { adminSessionGenerationRef.current += 1; adminLoadGenerationRef.current += 1; setAuthenticated(true); setSessionChecked(true); setLoading(true); setError(""); setNotice(""); }, []);
  const logout = async () => {
    if (logoutBusy) return;
    const sessionGeneration = adminSessionGenerationRef.current;
    setLogoutBusy(true); setError("");
    try {
      const response = await fetch(`${API_URL}/admin/logout`, { method: "POST", credentials: "include", cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { error?: string; message?: string | string[] };
      if (!response.ok) { const detail = Array.isArray(body.message) ? body.message.join(", ") : body.message; throw new Error(body.error || detail || "Не удалось выйти из админки"); }
      if (adminSessionGenerationRef.current === sessionGeneration) {
        setLogoutBusy(false);
        adminSessionGenerationRef.current += 1; adminLoadGenerationRef.current += 1;
        setAuthenticated(false); setLoading(false); setNotice(""); setSelectedOrder(null); setProductEditing(null);
      }
    } catch (reason) {
      if (adminSessionGenerationRef.current === sessionGeneration) setError(reason instanceof Error ? reason.message : "Не удалось выйти из админки");
    } finally {
      if (adminSessionGenerationRef.current === sessionGeneration) setLogoutBusy(false);
    }
  };
  const menu = useMemo(() => [["orders", "Заказы"], ["products", "Товары"], ["categories", "Категории"], ["locations", "Точки"], ["promotions", "Акции"], ["users", "Пользователи"], ["loyalty", "Лояльность"], ["settings", "Настройки"]] as Array<[Tab, string]>, []);
  if (!sessionChecked) return <main className="admin-login"><div className="admin-session-check"><img src="/assets/icons/logo.svg" alt="ДААНА СУШИ" /><p>Проверяем сессию…</p></div></main>;
  if (!authenticated) return <Login onLogin={handleLogin} />;
  return <div className="admin-shell"><aside className="admin-sidebar"><img src="/assets/icons/logo.svg" alt="ДААНА СУШИ" /><nav>{menu.map(([id, label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => { setTab(id); setNotice(""); setError(""); }}>{label}</button>)}</nav><Link href="/catalog/1">Открыть сайт</Link><button className="logout" disabled={logoutBusy} onClick={() => void logout()}>{logoutBusy ? "Выходим…" : "Выйти"}</button></aside><main className="admin-main"><header><div><h1>{menu.find(([id]) => id === tab)?.[1]}</h1><p>{tab === "loyalty" ? "NAKTA Coin, NFT и выводы" : "Управление «ДААНА СУШИ»"}</p></div><button onClick={() => { setRefreshKey((value) => value + 1); void loadAll(); }}>Обновить</button></header>{error && <div className="admin-error banner">{error}</div>}{notice && <div className="admin-success banner">{notice}</div>}{loading && <div className="admin-loading">Загрузка…</div>}
    {!loading && tab === "orders" && <section><div className="stat-grid"><div><strong>{dashboard.ordersToday}</strong><span>Заказов сегодня</span></div><div><strong>{dashboard.revenueToday} С</strong><span>Выручка сегодня</span></div><div><strong>{dashboard.activeOrders}</strong><span>Активных заказов</span></div><div><strong>{dashboard.products}</strong><span>Товаров на сайте</span></div></div><div className="order-list">{orders.length === 0 && <div className="empty-admin">Заказов пока нет</div>}{orders.map((order) => <article className={`order-card status-${order.status}`} key={order.id}><div className="order-head"><div><strong>#{order.orderNumber}</strong><span>{new Date(order.createdAt).toLocaleString("ru-RU")}</span></div><div className="order-head-actions"><select value={order.status} onChange={(event) => event.target.value === "cancelled" ? void cancelOrder(order) : void updateStatus(order, event.target.value)}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button onClick={() => setSelectedOrder(order)}>Подробнее</button><button className="danger" disabled={order.status === "cancelled" || order.status === "completed"} onClick={() => void cancelOrder(order)}>Отменить</button></div></div><div className="order-info"><span><b>{order.customerName}</b><br />{order.customerPhone}</span><span><b>{order.locationName}</b><br />{order.comment || "Без комментария"}</span><strong>{order.total} С</strong></div><div className="order-items">{order.items.map((item, index) => <span key={`${item.productName}-${index}`}>{item.productName} × {item.quantity}</span>)}</div></article>)}</div></section>}
    {!loading && tab === "products" && <section className="admin-section"><div className="section-title"><h2>Каталог товаров</h2><button className="admin-primary" onClick={() => setProductEditing({ name: "", price: 0, categoryId: categories[0]?.id || 1, image: "", active: true, sortOrder: 0, naktaCoins: 0 })}>+ Добавить</button></div>{productEditing && <form className="editor-form" onSubmit={productSave}><h3>{productEditing.id ? "Редактирование товара" : "Новый товар"}</h3><div className="editor-grid"><label>Название<input value={productEditing.name || ""} onChange={(event) => setProductEditing({ ...productEditing, name: event.target.value })} required /></label><label>Категория<select value={productEditing.categoryId} onChange={(event) => setProductEditing({ ...productEditing, categoryId: Number(event.target.value) })}>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label>Цена, С<input type="number" min="0" value={productEditing.price || 0} onChange={(event) => setProductEditing({ ...productEditing, price: Number(event.target.value) })} /></label><label>NAKTA Coin за товар<input type="number" min="0" value={productEditing.naktaCoins || 0} onChange={(event) => setProductEditing({ ...productEditing, naktaCoins: Number(event.target.value) })} /><small>Начисляются после завершения заказа.</small></label><label>Порядок<input type="number" value={productEditing.sortOrder || 0} onChange={(event) => setProductEditing({ ...productEditing, sortOrder: Number(event.target.value) })} /></label><label className="wide-field">URL изображения<input value={productEditing.image || ""} onChange={(event) => setProductEditing({ ...productEditing, image: event.target.value })} /></label><label>Загрузить файл<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => event.target.files?.[0] && void uploadProductImage(event.target.files[0])} /></label><label className="check-field"><input type="checkbox" checked={productEditing.active ?? true} onChange={(event) => setProductEditing({ ...productEditing, active: event.target.checked })} />Показывать на сайте</label></div><div className="editor-actions"><button type="button" onClick={() => setProductEditing(null)}>Отмена</button><button className="admin-primary">Сохранить</button></div></form>}<div className="product-admin-grid">{products.map((product) => <article key={product.id}><img src={product.image} alt="" /><div><strong>{product.name}</strong><span>{categories.find((category) => category.id === product.categoryId)?.name} · {product.price} С</span><small>{product.active ? "На сайте" : "Скрыт"} · <b>{formatNumber(product.naktaCoins)} NAKTA Coin</b></small></div><button onClick={() => setProductEditing(product)}>Изменить</button><button className="danger" onClick={() => void deleteProduct(product)}>Удалить</button></article>)}</div></section>}
    {!loading && tab === "categories" && <CrudSection title="Категории меню" rows={categories as unknown as Array<Record<string, unknown>>} fields={[{ key: "name", label: "Название" }, { key: "slug", label: "Slug" }, { key: "sortOrder", label: "Порядок", type: "number" }, { key: "active", label: "Активна", type: "checkbox" }]} empty={{ name: "", slug: "", sortOrder: 0, active: true }} endpoint="categories" request={request} onRefresh={loadAll} />}
    {!loading && tab === "locations" && <LocationsSection locations={locations} request={request} onRefresh={loadAll} />}
    {!loading && tab === "promotions" && <CrudSection title="Акции" rows={promotions as unknown as Array<Record<string, unknown>>} fields={[{ key: "title", label: "Заголовок" }, { key: "description", label: "Описание", type: "textarea" }, { key: "image", label: "Изображение" }, { key: "sortOrder", label: "Порядок", type: "number" }, { key: "active", label: "Активна", type: "checkbox" }]} empty={{ title: "", description: "", image: "", sortOrder: 0, active: true }} endpoint="promotions" request={request} onRefresh={loadAll} />}
    {!loading && tab === "users" && <UsersSection request={request} refreshKey={refreshKey} />}{!loading && tab === "loyalty" && <LoyaltySection request={request} rewards={rewards} onRewardsChange={setRewards} refreshKey={refreshKey} />}
    {!loading && tab === "settings" && <section className="admin-section"><div className="section-title"><h2>Общие настройки</h2></div><form className="settings-form" onSubmit={saveSettings}><label>Юридическое название<input value={settings.legalName} onChange={(event) => setSettings({ ...settings, legalName: event.target.value })} /></label><label>Ссылка Telegram<input value={settings.telegram} onChange={(event) => setSettings({ ...settings, telegram: event.target.value })} /></label><button className="admin-primary">Сохранить настройки</button></form></section>}
    {selectedOrder && <div className="admin-modal-backdrop"><button className="admin-modal-dismiss" onClick={() => setSelectedOrder(null)} aria-label="Закрыть" /><section className="admin-order-modal"><header><div><span>Заказ</span><h2>#{selectedOrder.orderNumber}</h2></div><button onClick={() => setSelectedOrder(null)}>×</button></header><div className="admin-order-status"><span className={`status-badge status-${selectedOrder.status}`}>{statusLabels[selectedOrder.status]}</span><time>{formatDate(selectedOrder.createdAt)}</time></div><div className="admin-order-details"><div><small>Клиент</small><strong>{selectedOrder.customerName}</strong><a href={`tel:${selectedOrder.customerPhone.replace(/\D/g, "")}`}>{selectedOrder.customerPhone}</a></div><div><small>Точка</small><strong>{selectedOrder.locationName}</strong><span>{selectedOrder.locationAddress}</span></div><div className="admin-order-comment"><small>Комментарий</small><span>{selectedOrder.comment || "Без комментария"}</span></div></div><div className="admin-order-lines"><h3>Состав заказа</h3>{selectedOrder.items.map((item, index) => <div key={`${item.productName}-${index}`}><span><b>{item.productName}</b><small>{item.unitPrice} С × {item.quantity}</small></span><strong>{item.lineTotal} С</strong></div>)}</div><footer><div><span>Итого</span><strong>{selectedOrder.total} С</strong></div><button className="danger" disabled={selectedOrder.status === "cancelled" || selectedOrder.status === "completed"} onClick={() => void cancelOrder(selectedOrder)}>Отменить заказ</button></footer></section></div>}
  </main></div>;
}
