"use client";

import { useAdminLanguage } from "./i18n";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAdminAccess } from "./AdminAccess";
import AdminDialog from "./AdminDialog";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui";

type Request = <T = unknown>(path: string, options?: RequestInit) => Promise<T>;
type Customer = { phone: string; customerName?: string | null; name?: string | null; ordersCount?: number; completedOrders?: number; revenue?: number; naktaCoins?: number; nftCount?: number; pendingNftCount?: number; availableNftCount?: number; lastOrderAt?: string | null };
type CustomerDetail = Customer & { adjustments?: { id: string; asset: "coin" | "nft"; delta: number; reason: string; balanceAfter: number; createdAt: string }[] };
type Order = { orderNumber: string; status: string; total: number; createdAt: string };
type Page<T> = { items: T[]; total: number; limit: number; offset: number };
type Adjustment = { phone: string; asset: "coin" | "nft"; direction: 1 | -1; amount: string; reason: string };
const LIMIT = 25;

const statuses: Record<string, string> = { new: "Новый", confirmed: "Подтверждён", preparing: "Готовится", ready: "Готов", completed: "Выдан", cancelled: "Отменён" };

export default function CustomerWorkspace({ request, refreshKey = 0 }: { request: Request; refreshKey?: number }) {
  const { t, formatNumber, formatDate } = useAdminLanguage();
  const number = (value?: number) => formatNumber(value || 0); const money = (value?: number) => `${number(value)} С`; const date = (value?: string | null) => value ? formatDate(value, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  const name = (customer: Customer) => customer.name?.trim() || customer.customerName?.trim() || t("Без имени");
  const { can } = useAdminAccess();
  const canViewOrders = can("orders.view");
  const [customers, setCustomers] = useState<Page<Customer>>({ items: [], total: 0, limit: LIMIT, offset: 0 });
  const [searchDraft, setSearchDraft] = useState(""); const [search, setSearch] = useState(""); const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null); const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [orders, setOrders] = useState<Page<Order>>({ items: [], total: 0, limit: 20, offset: 0 }); const [orderOffset, setOrderOffset] = useState(0);
  const [listLoading, setListLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false); const [ordersLoading, setOrdersLoading] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState(false); const [nameDraft, setNameDraft] = useState("");
  const [adjustment, setAdjustment] = useState<Adjustment | null>(null);
  const selection = useRef<string | null>(null); const listGeneration = useRef(0); const detailGeneration = useRef(0); const orderGeneration = useRef(0); const operation = useRef(false);
  const invalidateList = useCallback(() => { listGeneration.current++; }, []);
  const invalidateDetail = useCallback(() => { detailGeneration.current++; }, []);
  const invalidateOrders = useCallback(() => { orderGeneration.current++; }, []);
  const loadList = useCallback(async () => {
    const generation = ++listGeneration.current; setListLoading(true);
    try {
      const result = await request<Page<Customer>>(`customers?${new URLSearchParams({ search, limit: String(LIMIT), offset: String(offset) })}`);
      if (generation === listGeneration.current) { setCustomers(result); setError(""); }
    } catch (reason) { if (generation === listGeneration.current) setError(reason instanceof Error ? reason.message : "Не удалось загрузить клиентов"); }
    finally { if (generation === listGeneration.current) setListLoading(false); }
  }, [request, search, offset]);
  const loadDetail = useCallback(async (phone: string) => {
    const generation = ++detailGeneration.current; setDetailLoading(true);
    try {
      const result = await request<CustomerDetail>(`customers/${encodeURIComponent(phone)}`);
      if (generation === detailGeneration.current && selection.current === phone) { setDetail(result); setError(""); }
    } catch (reason) { if (generation === detailGeneration.current && selection.current === phone) setError(reason instanceof Error ? reason.message : "Не удалось загрузить карточку"); }
    finally { if (generation === detailGeneration.current && selection.current === phone) setDetailLoading(false); }
  }, [request]);
  const loadOrders = useCallback(async (phone: string) => {
    if (!canViewOrders) return;
    const generation = ++orderGeneration.current; setOrdersLoading(true);
    try {
      const result = await request<Page<Order>>(`customers/${encodeURIComponent(phone)}/orders?limit=20&offset=${orderOffset}`);
      if (generation === orderGeneration.current && selection.current === phone) setOrders(result);
    } catch (reason) { if (generation === orderGeneration.current && selection.current === phone) setError(reason instanceof Error ? reason.message : "Не удалось загрузить историю заказов"); }
    finally { if (generation === orderGeneration.current && selection.current === phone) setOrdersLoading(false); }
  }, [request, orderOffset, canViewOrders]);
  useEffect(() => { const timer = window.setTimeout(() => void loadList(), 0); return () => { window.clearTimeout(timer); invalidateList(); }; }, [loadList, refreshKey, invalidateList]);
  useEffect(() => { if (!selected) return; const timer = window.setTimeout(() => void loadDetail(selected), 0); return () => { window.clearTimeout(timer); invalidateDetail(); }; }, [selected, loadDetail, refreshKey, invalidateDetail]);
  useEffect(() => { if (!selected || !canViewOrders) return; const timer = window.setTimeout(() => void loadOrders(selected), 0); return () => { window.clearTimeout(timer); invalidateOrders(); }; }, [selected, canViewOrders, loadOrders, refreshKey, invalidateOrders]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (editingName || adjustment) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [editingName, adjustment]);
  const open = (phone: string) => { selection.current = phone; setSelected(phone); setDetail(null); setOrderOffset(0); setOrders({ items: [], total: 0, limit: 20, offset: 0 }); setEditingName(false); setAdjustment(null); setError(""); setNotice(""); };
  const back = () => { if (busy || ((editingName || adjustment) && !window.confirm(t("Закрыть карточку без сохранения изменений?")))) return; selection.current = null; detailGeneration.current++; orderGeneration.current++; setSelected(null); setDetail(null); setEditingName(false); setAdjustment(null); setError(""); setNotice(""); };
  const saveName = async (event: FormEvent) => {
    event.preventDefault(); if (!selected || operation.current) return; const phone = selected; operation.current = true; setBusy(true); setError("");
    try {
      await request(`customers/${encodeURIComponent(phone)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nameDraft.trim() }) });
      if (selection.current === phone) { setEditingName(false); setNotice("Имя клиента сохранено"); await Promise.all([loadDetail(phone), loadList()]); }
    } catch (reason) { if (selection.current === phone) setError(reason instanceof Error ? reason.message : "Не удалось сохранить имя"); }
    finally { operation.current = false; setBusy(false); }
  };
  const saveAdjustment = async (event: FormEvent) => {
    event.preventDefault(); if (!adjustment || operation.current || !detail || detail.phone !== adjustment.phone || selection.current !== adjustment.phone) return;
    const amount = Number(adjustment.amount); const available = adjustment.asset === "coin" ? detail.naktaCoins || 0 : detail.availableNftCount || 0;
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > (adjustment.asset === "nft" ? 100 : 1_000_000)) { setError("Укажите допустимое целое количество наград"); return; }
    if (!adjustment.reason.trim()) { setError("Укажите причину изменения"); return; }
    if (adjustment.direction === -1 && amount > available) { setError("Недостаточно доступных наград для списания"); return; }
    const phone = adjustment.phone; operation.current = true; setBusy(true); setError("");
    try {
      await request(`customers/${encodeURIComponent(phone)}/rewards/adjust`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asset: adjustment.asset, delta: amount * adjustment.direction, reason: adjustment.reason.trim() }) });
      if (selection.current === phone) { setAdjustment(null); setNotice("Баланс наград обновлён"); await Promise.all([loadDetail(phone), loadList()]); }
    } catch (reason) { if (selection.current === phone) setError(reason instanceof Error ? reason.message : "Не удалось изменить баланс"); }
    finally { operation.current = false; setBusy(false); }
  };
  const beginAdjustment = (asset: "coin" | "nft", direction: 1 | -1) => { if (!detail || busy) return; setAdjustment({ phone: detail.phone, asset, direction, amount: "1", reason: "" }); setError(""); };
  if (selected) return <div className="admin-customer-workspace" data-admin-dirty={editingName || adjustment ? "true" : undefined}><div className="admin-workspace-toolbar"><Button onClick={back} disabled={busy}>{t("← К клиентам")}</Button><Button disabled={busy || detailLoading} onClick={() => { void loadDetail(selected); void loadOrders(selected); }}>{t("Обновить")}</Button></div>
    {error && <div className="admin-error banner" role="alert">{t(error)}</div>}{notice && <div className="admin-success banner" role="status">{t(notice)}</div>}
    {!detail ? <div className="admin-loading-card" role="status">{detailLoading ? t("Загружаем карточку клиента…") : t("Карточка недоступна. Обновите страницу.")}</div> : <>
      <Card><CardHeader><div className="section-title"><div><CardTitle>{name(detail)}</CardTitle><CardDescription><a href={`tel:+${detail.phone}`}>+{detail.phone}</a></CardDescription></div>{can("users.edit") && !editingName && <Button disabled={busy} onClick={() => { setNameDraft(detail.name?.trim() || detail.customerName?.trim() || ""); setEditingName(true); }}>{t("Редактировать клиента")}</Button>}</div></CardHeader><CardContent>
        {editingName && <form className="customer-edit-form" onSubmit={saveName}><label className="admin-filter-field">{t("Имя клиента")}<input required maxLength={120} value={nameDraft} disabled={busy} onChange={(event) => setNameDraft(event.target.value)} /></label><Button variant="default" disabled={busy}>{busy ? t("Сохраняем…") : t("Сохранить")}</Button><Button type="button" disabled={busy} onClick={() => setEditingName(false)}>{t("Отменить")}</Button></form>}
        {canViewOrders && <><div className="analytics-customer-summary"><div><span>{t("Всего заказов")}</span><strong>{number(detail.ordersCount)}</strong></div><div><span>{t("Выдано")}</span><strong>{number(detail.completedOrders)}</strong></div><div><span>{t("Покупки")}</span><strong>{money(detail.revenue)}</strong></div></div><p className="admin-muted">{t("Последний заказ:")} {date(detail.lastOrderAt)}.</p></>}<p className="admin-muted">{t("Телефон используется для входа клиента.")}</p>
      </CardContent></Card>
      {canViewOrders && <Card><CardHeader><CardTitle>{t("История заказов")}</CardTitle><CardDescription>{t("Все заказы клиента, включая отменённые")}</CardDescription></CardHeader><CardContent>{ordersLoading ? <p role="status">{t("Обновляем историю…")}</p> : orders.items.length ? <Table><TableHeader><TableRow><TableHead>{t("Заказ")}</TableHead><TableHead>{t("Дата")}</TableHead><TableHead>{t("Статус")}</TableHead><TableHead>{t("Сумма")}</TableHead></TableRow></TableHeader><TableBody>{orders.items.map((order) => <TableRow key={order.orderNumber}><TableCell>{order.orderNumber}</TableCell><TableCell>{date(order.createdAt)}</TableCell><TableCell><Badge variant={order.status === "completed" ? "success" : order.status === "cancelled" ? "destructive" : "secondary"}>{t(statuses[order.status])}</Badge></TableCell><TableCell>{money(order.total)}</TableCell></TableRow>)}</TableBody></Table> : <EmptyState title={t("Заказов ещё нет")} />}
        <div className="admin-pagination"><span>{t("Всего:")} {number(orders.total)}</span><Button disabled={ordersLoading || orderOffset === 0} onClick={() => setOrderOffset(Math.max(0, orderOffset - 20))}>{t("Назад")}</Button><Button disabled={ordersLoading || orderOffset + 20 >= orders.total} onClick={() => setOrderOffset(orderOffset + 20)}>{t("Далее")}</Button></div>
      </CardContent></Card>}
      {can("loyalty.view") && <><div className="analytics-grid">{([['coin', 'DAANA Coin', detail.naktaCoins || 0], ['nft', 'NFT', detail.nftCount || 0]] as const).map(([asset, label, balance]) => <Card key={asset}><CardHeader><CardTitle>{t(label)}</CardTitle><CardDescription>{t("Доступно:")} {number(asset === "coin" ? balance : detail.availableNftCount)}{asset === "nft" ? t(" · На выводе: {v0}", { v0: number(detail.pendingNftCount) }) : ""}</CardDescription></CardHeader><CardContent><strong className="customer-reward-balance">{number(balance)}</strong>{can("loyalty.adjust") && <div className="staff-row-actions"><Button onClick={() => beginAdjustment(asset, 1)}>{t("Начислить")}</Button><Button disabled={(asset === "coin" ? balance : detail.availableNftCount || 0) <= 0} onClick={() => beginAdjustment(asset, -1)}>{t("Списать")}</Button></div>}</CardContent></Card>)}</div>
      <Card><CardHeader><CardTitle>{t("История корректировок")}</CardTitle></CardHeader><CardContent>{detail.adjustments?.length ? <Table><TableHeader><TableRow><TableHead>{t("Дата")}</TableHead><TableHead>{t("Изменение")}</TableHead><TableHead>{t("Причина")}</TableHead><TableHead>{t("Остаток")}</TableHead></TableRow></TableHeader><TableBody>{detail.adjustments.map((item) => <TableRow key={item.id}><TableCell>{date(item.createdAt)}</TableCell><TableCell>{item.delta > 0 ? "+" : ""}{number(item.delta)} {item.asset === "coin" ? "DAANA Coin" : "NFT"}</TableCell><TableCell>{item.reason}</TableCell><TableCell>{number(item.balanceAfter)}</TableCell></TableRow>)}</TableBody></Table> : <EmptyState title={t("Ручных корректировок пока нет")} />}</CardContent></Card></>}
    </>}
    {adjustment && <AdminDialog title={`${adjustment.direction === 1 ? t("Начислить") : t("Списать")} ${adjustment.asset === "coin" ? "DAANA Coin" : "NFT"}`} description={detail ? name(detail) : t("Изменение баланса клиента")} busy={busy} onClose={() => { if (!busy && window.confirm(t("Отменить изменение баланса?"))) { setAdjustment(null); setError(""); } }}><form onSubmit={saveAdjustment} className="editor-form">{error && <div className="admin-error" role="alert">{t(error)}</div>}<label>{t("Количество")}<input required type="number" min="1" max={adjustment.asset === "nft" ? 100 : 1_000_000} step="1" disabled={busy} value={adjustment.amount} onChange={(event) => setAdjustment({ ...adjustment, amount: event.target.value })} /></label><label>{t("Причина")}<textarea required maxLength={240} disabled={busy} value={adjustment.reason} onChange={(event) => setAdjustment({ ...adjustment, reason: event.target.value })} /></label><div className="editor-actions"><Button type="button" disabled={busy} onClick={() => { setAdjustment(null); setError(""); }}>{t("Отменить")}</Button><Button variant={adjustment.direction === -1 ? "destructive" : "default"} disabled={busy}>{busy ? t("Сохраняем…") : t("Сохранить")}</Button></div></form></AdminDialog>}
  </div>;
  return <Card><CardHeader><CardTitle>{t("Клиенты")}</CardTitle><CardDescription>{canViewOrders ? t("Поиск по имени или телефону и история покупок") : t("Поиск по имени или телефону и контактные данные")}</CardDescription></CardHeader><CardContent>
    <form className="customer-edit-form" onSubmit={(event) => { event.preventDefault(); setOffset(0); setSearch(searchDraft.trim()); }}><input aria-label={t("Имя или телефон клиента")} placeholder={t("Имя или телефон")} type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} /><Button variant="default">{t("Найти")}</Button></form>
    {error && <div className="admin-error banner" role="alert">{t(error)}</div>}
    {listLoading ? <p role="status">{t("Загружаем клиентов…")}</p> : customers.items.length ? <Table><TableHeader><TableRow><TableHead>{t("Клиент")}</TableHead><TableHead>{t("Телефон")}</TableHead>{canViewOrders && <><TableHead>{t("Заказы")}</TableHead><TableHead>{t("Последний заказ")}</TableHead></>}<TableHead><span className="sr-only">{t("Открыть")}</span></TableHead></TableRow></TableHeader><TableBody>{customers.items.map((customer) => <TableRow key={customer.phone}><TableCell><strong>{name(customer)}</strong></TableCell><TableCell>+{customer.phone}</TableCell>{canViewOrders && <><TableCell>{number(customer.ordersCount)}</TableCell><TableCell>{date(customer.lastOrderAt)}</TableCell></>}<TableCell><Button onClick={() => open(customer.phone)}>{t("Открыть")}</Button></TableCell></TableRow>)}</TableBody></Table> : <EmptyState title={search ? t("Клиенты не найдены") : t("Клиентов пока нет")}><p>{search ? t("Попробуйте другое имя или номер телефона.") : t("Клиент появится после первого заказа или входа на сайте.")}</p></EmptyState>}
    <div className="admin-pagination"><span>{t("Всего:")} {number(customers.total)}</span><Button disabled={listLoading || offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>{t("Назад")}</Button><Button disabled={listLoading || offset + LIMIT >= customers.total} onClick={() => setOffset(offset + LIMIT)}>{t("Далее")}</Button></div>
  </CardContent></Card>;
}
