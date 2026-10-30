"use client";

import { useAdminLanguage } from "./i18n";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import AdminDialog from "./AdminDialog";
import { useAdminAccess } from "./AdminAccess";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, CardDescription, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui";

export type Order = { id: number; orderNumber: string; customerName: string; customerPhone: string; status: string; total: number; createdAt: string; updatedAt?: string; locationName: string; locationAddress: string; comment: string; items: Array<{ productName: string; unitPrice: number; quantity: number; lineTotal: number }>; history?: Array<{ status?: string; fromStatus?: string; toStatus?: string; name?: string; actorName?: string; createdAt: string }> };
type Requester = <T = unknown>(path: string, options?: RequestInit) => Promise<T>;
type Page = { items: Order[]; total: number; limit: number; offset: number };
const labels: Record<string, string> = { new: "Новый", confirmed: "Подтверждён", preparing: "Готовится", ready: "Готов к выдаче", completed: "Выдан", cancelled: "Отменён" };
const next: Record<string, string> = { new: "confirmed", confirmed: "preparing", preparing: "ready", ready: "completed" };
const API_URL = process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:4000/api");

const variant = (status: string): "success" | "warning" | "secondary" | "destructive" => status === "completed" ? "success" : status === "cancelled" ? "destructive" : status === "new" ? "warning" : "secondary";

export default function OrdersWorkspace({ request, refreshKey, orderToOpen, onOpened }: { request: Requester; refreshKey: number; orderToOpen?: number | null; onOpened?: () => void }) {
  const { t, formatNumber, formatDate } = useAdminLanguage();
  const formatMoney = (value: number) => `${formatNumber(value)} С`; const date = (value: string) => formatDate(value, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  const { can } = useAdminAccess();
  const [filters, setFilters] = useState({ search: "", status: "", from: "", to: "", locationId: "" });
  const [draft, setDraft] = useState(filters);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page>({ items: [], total: 0, limit: 25, offset: 0 });
  const [locations, setLocations] = useState<Array<{ id: number; name: string }>>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [cancel, setCancel] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0); const invalidate = useCallback(() => { generation.current++; }, []); const lock = useRef(false);
  const load = useCallback(async () => {
    const current = ++generation.current; setLoading(true);
    try {
      const query = new URLSearchParams({ ...filters, paginate: "1", limit: "25", offset: String(offset) });
      const data = await request<Page>(`orders?${query}`);
      if (generation.current === current) { setPage(data); setError(""); }
    } catch (reason) { if (generation.current === current) { setPage({ items: [], total: 0, limit: 25, offset }); setError(reason instanceof Error ? reason.message : "Не удалось загрузить заказы"); } }
    finally { if (generation.current === current) setLoading(false); }
  }, [request, filters, offset]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => { clearTimeout(timer); invalidate(); }; }, [load, refreshKey, invalidate]);
  useEffect(() => { let stopped = false; void request<{ locations: Array<{ id: number; name: string }> }>("orders/options").then((data) => { if (!stopped) setLocations(data.locations); }).catch(() => {}); return () => { stopped = true; }; }, [request]);
  const open = useCallback(async (id: number) => {
    setError("");
    try { const order = await request<Order>(`orders/${id}`); setSelected(order); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Заказ недоступен"); }
  }, [request]);
  useEffect(() => { if (orderToOpen) { const timer = setTimeout(() => { void open(orderToOpen); onOpened?.(); }, 0); return () => clearTimeout(timer); } }, [orderToOpen, open, onOpened]);
  const selectedId = selected?.id;
  useEffect(() => { if (!selectedId) return; let stopped = false; void request<Order>(`orders/${selectedId}`).then((data) => { if (!stopped) setSelected(data); }).catch(() => { if (!stopped) setSelected(null); }); return () => { stopped = true; }; }, [refreshKey, request, selectedId]);
  const update = async (order: Order, status: string) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      await request(`orders/${order.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, expectedStatus: order.status }) });
      setCancel(null); if (selected?.id === order.id) await open(order.id); await load();
    } catch (reason) { await load(); if (selected?.id === order.id) await open(order.id); setError(reason instanceof Error ? reason.message : "Не удалось изменить статус"); }
    finally { lock.current = false; setBusy(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); setOffset(0); setFilters({ ...draft }); };
  const exportOrders = async () => {
    setExporting(true); setError("");
    try {
      const response = await fetch(`${API_URL}/admin/orders/export?${new URLSearchParams(filters)}`, { credentials: "include", cache: "no-store" });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "Не удалось выгрузить заказы"); }
      const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "daana-orders.csv"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(reason instanceof TypeError ? "Сервер недоступен. Проверьте соединение." : reason instanceof Error ? reason.message : "Не удалось выгрузить заказы"); }
    finally { setExporting(false); }
  };
  const cancelButton = (order: Order) => can("orders.status") && !["cancelled", "completed"].includes(order.status) && <Button variant="destructive" disabled={busy} onClick={() => setCancel(order)}>{t("Отменить заказ")}</Button>;
  return <div className="admin-orders-workspace">
    <Card><CardHeader><CardTitle>{t("Заказы")}</CardTitle><CardDescription>{t("Контролируйте приготовление и выдачу. Время указано по Бишкеку.")}</CardDescription></CardHeader><CardContent><form className="admin-orders-toolbar" onSubmit={submit}>
      <label className="admin-filter-field">{t("Поиск")}<input type="search" placeholder={t("Номер, клиент или телефон")} value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} /></label>
      <label className="admin-filter-field">{t("Статус")}<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="">{t("Все статусы")}</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
      <label className="admin-filter-field">{t("Точка")}<select value={draft.locationId} onChange={(event) => setDraft({ ...draft, locationId: event.target.value })}><option value="">{t("Все точки")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
      <label className="admin-filter-field">{t("С")}<input type="date" value={draft.from} max={draft.to || undefined} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label><label className="admin-filter-field">{t("По")}<input type="date" value={draft.to} min={draft.from || undefined} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
      <Button variant="default" disabled={loading}>{t("Применить")}</Button>{can("orders.export") && <Button type="button" disabled={loading || exporting} onClick={() => void exportOrders()}>{exporting ? t("Выгружаем…") : t("Экспорт CSV")}</Button>}
    </form></CardContent></Card>
    {error && <div className="admin-error banner" role="alert">{t(error)}</div>}
    <Card><CardHeader><div className="section-title"><div><CardTitle>{t("Список заказов")} <Badge>{page.total}</Badge></CardTitle><CardDescription>{loading ? t("Обновляем данные…") : t("Последние загруженные заказы")}</CardDescription></div><Button onClick={() => void load()} disabled={loading}>{t("Обновить")}</Button></div></CardHeader><CardContent>
      {!page.items.length ? <EmptyState title={loading ? t("Загружаем заказы…") : t("Заказы не найдены")}><p>{t("Новые заказы появятся здесь автоматически.")}</p></EmptyState> : <Table><TableHeader><TableRow><TableHead>{t("Заказ")}</TableHead><TableHead>{t("Клиент")}</TableHead><TableHead>{t("Точка")}</TableHead><TableHead>{t("Статус")}</TableHead><TableHead>{t("Сумма")}</TableHead><TableHead><span className="sr-only">{t("Действия")}</span></TableHead></TableRow></TableHeader><TableBody>{page.items.map((order) => <TableRow key={order.id}><TableCell><strong>№{order.orderNumber}</strong><small>{date(order.createdAt)}</small></TableCell><TableCell><strong>{order.customerName}</strong><small>{order.customerPhone}</small></TableCell><TableCell>{order.locationName}</TableCell><TableCell><Badge variant={variant(order.status)}>{t(labels[order.status])}</Badge></TableCell><TableCell><strong>{formatMoney(order.total)}</strong></TableCell><TableCell><Button onClick={() => void open(order.id)}>{t("Открыть")}</Button></TableCell></TableRow>)}</TableBody></Table>}
      <div className="admin-pagination"><span>{page.total ? t("{v0}–{v1} из {v2}", { v0: offset + 1, v1: Math.min(offset + page.items.length, page.total), v2: page.total }) : t("Нет заказов")}</span><div><Button disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>{t("Назад")}</Button><Button disabled={loading || offset + 25 >= page.total} onClick={() => setOffset(offset + 25)}>{t("Далее")}</Button></div></div>
    </CardContent></Card>
    {selected && <AdminDialog title={t("Заказ №{v0}", { v0: selected.orderNumber })} description={date(selected.createdAt)} onClose={() => { if (!busy) setSelected(null); }} busy={busy} className="admin-order-dialog"><div className="admin-order-status"><Badge variant={variant(selected.status)}>{t(labels[selected.status])}</Badge>{can("orders.status") && next[selected.status] && <Button variant="default" disabled={busy} onClick={() => void update(selected, next[selected.status])}>{t(labels[next[selected.status]])}</Button>}</div>{can("orders.status") && <label className="admin-status-select">{t("Изменить статус")}<select disabled={busy} value={selected.status} onChange={(event) => { const status = event.target.value; if (status === selected.status) return; if (status === "cancelled") setCancel(selected); else if (window.confirm(t("Изменить статус заказа на «{v0}»?", { v0: labels[status] }))) void update(selected, status); }}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>}<div className="admin-order-details"><div><small>{t("Клиент")}</small><strong>{selected.customerName}</strong><a href={`tel:${selected.customerPhone}`}>{selected.customerPhone}</a></div><div><small>{t("Самовывоз")}</small><strong>{selected.locationName}</strong><span>{selected.locationAddress}</span></div><div className="admin-order-comment"><small>{t("Комментарий")}</small><span>{selected.comment || t("Без комментария")}</span></div></div><div className="admin-order-lines"><h3>{t("Состав заказа")}</h3>{selected.items.map((item, index) => <div key={index}><span><b>{item.productName}</b><small>{formatMoney(item.unitPrice)} × {item.quantity}</small></span><strong>{formatMoney(item.lineTotal)}</strong></div>)}</div>{selected.history && <div className="admin-order-lines"><h3>{t("История статусов")}</h3>{selected.history.length ? selected.history.map((entry, index) => <div key={index}><span>{t(labels[entry.toStatus || entry.status || ""]) || t("Изменение статуса")}<small>{entry.actorName || entry.name || t("Сотрудник")}</small></span><small>{date(entry.createdAt)}</small></div>) : <p className="admin-muted">{t("Изменений после начала учёта нет.")}</p>}</div>}<footer><div><span>{t("Итого")}</span><strong>{formatMoney(selected.total)}</strong></div>{cancelButton(selected)}</footer></AdminDialog>}
    {cancel && <AdminDialog title={t("Отменить заказ №{v0}?", { v0: cancel.orderNumber })} description={t("Он останется в истории со статусом «Отменён».")} onClose={() => { if (!busy) setCancel(null); }} busy={busy}><p>{cancel.customerName} · {formatMoney(cancel.total)}</p><div className="editor-actions"><Button disabled={busy} onClick={() => setCancel(null)}>{t("Назад")}</Button><Button variant="destructive" disabled={busy} onClick={() => void update(cancel, "cancelled")}>{busy ? t("Отменяем…") : t("Подтвердить отмену")}</Button></div></AdminDialog>}
  </div>;
}
