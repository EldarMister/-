"use client";

import { useAdminLanguage } from "./i18n";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAdminAccess } from "./AdminAccess";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui";

type Request = <T = unknown>(path: string, options?: RequestInit) => Promise<T>;
type Totals = { orders: number; completed: number; cancelled: number; active: number; revenue: number; averageOrder: number };
type SalesRow = { name: string; quantity: number; revenue: number; categoryMissing?: boolean };
type Report = {
  filters: { from: string; to: string; locationId: number | null; timezone: string };
  comparison: { from: string; to: string };
  current: Totals; previous: Totals; changes: Record<keyof Totals, number | null>;
  daily: { date: string; orders: number; revenue: number }[];
  hourly: { hour: number; orders: number; revenue: number }[];
  statuses: { status: string; count: number }[];
  products: SalesRow[]; categories: SalesRow[];
  customers: { total: number; new: number; returning: number };
  locations: { id: number; name: string }[];
  coverage: { ordersSince: string | null; employeeActionsSince: string | null };
  employees: { name: string; statusChanges: number; completed: number; cancelled: number }[];
  unavailable: { key: string; label: string; reason: string }[];
};
const API_URL = process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:4000/api");
const statusLabels: Record<string, string> = { new: "Новый", confirmed: "Подтверждён", preparing: "Готовится", ready: "Готов", completed: "Выдан", cancelled: "Отменён" };

function initialDates() {
  const today = new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
  return { from: new Date(Date.parse(today + "T00:00:00Z") - 29 * 86_400_000).toISOString().slice(0, 10), to: today, locationId: "" };
}

function SalesTable({ title, description, rows }: { title: string; description: string; rows: SalesRow[] }) {
  const { t, formatNumber } = useAdminLanguage();
  const number = (value: number) => formatNumber(value, { maximumFractionDigits: 0 }); const money = (value: number) => `${formatNumber(value, { maximumFractionDigits: 2 })} С`;

  return <Card><CardHeader><CardTitle>{t(title)}</CardTitle><CardDescription>{t(description)}</CardDescription></CardHeader><CardContent>{rows.length ? <Table><TableHeader><TableRow><TableHead>{t("Название")}</TableHead><TableHead>{t("Продано")}</TableHead><TableHead>{t("Выручка")}</TableHead></TableRow></TableHeader><TableBody>{rows.map((item) => <TableRow key={`${item.name}-${item.categoryMissing === true ? "missing" : "named"}`}><TableCell>{item.categoryMissing ? t("Категория не записана") : item.name}</TableCell><TableCell>{number(item.quantity)}</TableCell><TableCell>{money(item.revenue)}</TableCell></TableRow>)}</TableBody></Table> : <EmptyState title={t("Продаж за период нет")}><p>{t("Здесь появятся данные завершённых заказов.")}</p></EmptyState>}</CardContent></Card>;
}

export default function AnalyticsSection({ request, refreshKey = 0 }: { request: Request; refreshKey?: number }) {
  const { t, formatNumber, formatDate } = useAdminLanguage();
  const number = (value: number) => formatNumber(value, { maximumFractionDigits: 0 }); const money = (value: number) => `${formatNumber(value, { maximumFractionDigits: 2 })} С`; const date = (value: string) => formatDate(value, { day: "2-digit", month: "short", year: "numeric" }); const changeLabel = (change: number | null) => change === null ? t("Нет базы для сравнения") : t("{value}% к предыдущему периоду", { value: `${change > 0 ? "+" : ""}${formatNumber(change, { maximumFractionDigits: 1 })}` });

  const { can } = useAdminAccess();
  const [draft, setDraft] = useState(initialDates);
  const [filters, setFilters] = useState(initialDates);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const invalidateRequest = useCallback(() => { generation.current++; }, []);
  const load = useCallback(async () => {
    const current = ++generation.current; setLoading(true); setError("");
    try {
      const query = new URLSearchParams(filters);
      const result = await request<Report>(`analytics?${query}`);
      if (current === generation.current) setReport(result);
    } catch (reason) { if (current === generation.current) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить аналитику"); setReport(null); } }
    finally { if (current === generation.current) setLoading(false); }
  }, [filters, request]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => { window.clearTimeout(timer); invalidateRequest(); }; }, [load, invalidateRequest, refreshKey]);
  const submit = (event: FormEvent) => { event.preventDefault(); setFilters({ ...draft }); };
  const exportReport = async () => {
    if (!report || exporting) return; setExporting(true); setError("");
    try {
      const query = new URLSearchParams({ from: report.filters.from, to: report.filters.to, locationId: report.filters.locationId ? String(report.filters.locationId) : "" });
      const response = await fetch(`${API_URL}/admin/analytics/export?${query}`, { credentials: "include", cache: "no-store" });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || "Не удалось выгрузить отчёт"); }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `daana-analytics-${report.filters.from}-${report.filters.to}.csv`; document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (reason) { setError(reason instanceof TypeError ? "Сервер недоступен. Проверьте соединение." : reason instanceof Error ? reason.message : "Не удалось выгрузить отчёт"); }
    finally { setExporting(false); }
  };
  const maxRevenue = Math.max(1, ...(report?.daily.map((item) => item.revenue) ?? []));
  const chartPoints = report?.daily.map((item, index, rows) => `${rows.length === 1 ? 300 : index / (rows.length - 1) * 600},${160 - item.revenue / maxRevenue * 140}`).join(" ");
  const maxHourly = Math.max(1, ...(report?.hourly.map((item) => item.orders) ?? []));
  return <div className="admin-analytics-workspace">
    <Card><CardContent><form className="analytics-filters" onSubmit={submit}>
      <label className="admin-filter-field">{t("С")}<input type="date" required value={draft.from} max={draft.to} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
      <label className="admin-filter-field">{t("По")}<input type="date" required value={draft.to} min={draft.from} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
      <label className="admin-filter-field">{t("Точка самовывоза")}<select value={draft.locationId} onChange={(event) => setDraft({ ...draft, locationId: event.target.value })}><option value="">{t("Все точки")}</option>{report?.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
      <Button variant="default" disabled={loading}>{loading ? t("Загружаем…") : t("Применить")}</Button>{can("analytics.export") && <Button type="button" disabled={!report || loading || exporting} onClick={() => void exportReport()}>{exporting ? t("Выгружаем…") : t("Экспорт CSV")}</Button>}
    </form></CardContent></Card>
    {error && <div className="admin-error banner" role="alert">{t(error)}<Button variant="ghost" onClick={() => void load()}>{t("Повторить")}</Button></div>}
    {loading ? <div className="admin-loading-card" role="status">{t("Считаем показатели по данным сервера…")}</div> : report && <>
      <div className="analytics-period"><span>{date(report.filters.from)} — {date(report.filters.to)}</span><span>{t("Сравнение:")} {date(report.comparison.from)} — {date(report.comparison.to)}  {t("· Бишкек, UTC+6")}</span></div>
      <div className="stat-grid analytics-stats">{([['orders', t("Всего заказов")], ['revenue', t("Выручка")], ['averageOrder', t("Средний чек")], ['cancelled', t("Отменено")]] as const).map(([key, label]) => <Card key={key}><CardContent><span>{t(label)}</span><strong>{key === "revenue" || key === "averageOrder" ? money(report.current[key]) : number(report.current[key])}</strong><small>{changeLabel(report.changes[key])}</small></CardContent></Card>)}</div>
      <p className="admin-muted">{t("Выручка и средний чек учитывают только выданные заказы. Период определяется датой оформления заказа.")}</p>
      <div className="analytics-grid"><Card><CardHeader><CardTitle>{t("Выручка по дням")}</CardTitle><CardDescription>{t("Фактические суммы завершённых заказов, С")}</CardDescription></CardHeader><CardContent>
        <div className="analytics-line-chart"><span>{money(maxRevenue === 1 && !report.current.revenue ? 0 : maxRevenue)}</span><svg viewBox="0 0 600 180" preserveAspectRatio="none" role="img" aria-label={t("Выручка по дням: {v0} за период", { v0: money(report.current.revenue) })}><line x1="0" y1="160" x2="600" y2="160" stroke="currentColor" opacity="0.15" /><line x1="0" y1="90" x2="600" y2="90" stroke="currentColor" opacity="0.08" /><polyline points={`0,160 ${chartPoints} 600,160`} fill="currentColor" opacity="0.07" /><polyline points={chartPoints} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" /></svg><div><small>{date(report.filters.from)}</small><small>{date(report.filters.to)}</small></div></div>
        <details className="analytics-data-details"><summary>{t("Данные по дням")}</summary><Table><TableHeader><TableRow><TableHead>{t("Дата")}</TableHead><TableHead>{t("Заказы")}</TableHead><TableHead>{t("Выручка")}</TableHead></TableRow></TableHeader><TableBody>{report.daily.map((item) => <TableRow key={item.date}><TableCell>{date(item.date)}</TableCell><TableCell>{number(item.orders)}</TableCell><TableCell>{money(item.revenue)}</TableCell></TableRow>)}</TableBody></Table></details>
      </CardContent></Card><Card><CardHeader><CardTitle>{t("Статусы заказов")}</CardTitle><CardDescription>{t("Все заказы выбранного периода")}</CardDescription></CardHeader><CardContent>{!report.statuses.length ? <EmptyState title={t("Заказов пока нет")} /> : <div className="analytics-statuses">{report.statuses.map((item) => <div key={item.status}><div><Badge variant={item.status === "completed" ? "success" : item.status === "cancelled" ? "destructive" : "secondary"}>{t(statusLabels[item.status]) || item.status}</Badge><strong>{number(item.count)}</strong></div><progress max={report.current.orders || 1} value={item.count} aria-label={t(statusLabels[item.status])} /></div>)}</div>}<div className="analytics-customer-summary"><div><span>{t("Новые клиенты")}</span><strong>{number(report.customers.new)}</strong></div><div><span>{t("Повторные клиенты")}</span><strong>{number(report.customers.returning)}</strong></div></div><p className="admin-muted">{t("По первому заказу за всю доступную историю, включая отменённые.")}</p></CardContent></Card></div>
      <Card><CardHeader><CardTitle>{t("Заказы по часам")}</CardTitle><CardDescription>{t("Количество оформленных заказов · часовой пояс Бишкек")}</CardDescription></CardHeader><CardContent><div className="analytics-bars">{report.hourly.map((item) => <div className="analytics-bar" key={item.hour} title={t("{v0}:00 — {v1} заказов", { v0: item.hour, v1: number(item.orders) })}><span>{item.orders || ""}</span><i style={{ height: `${Math.max(2, item.orders / maxHourly * 120)}px` }} /><small>{String(item.hour).padStart(2, "0")}</small></div>)}</div></CardContent></Card>
      <div className="analytics-grid"><SalesTable title={t("Популярные товары")} description={t("20 товаров по количеству проданных единиц")} rows={report.products} /><SalesTable title={t("Категории")} description={t("Категория, сохранённая в заказе; старые записи могут быть без категории")} rows={report.categories} /></div>
      <Card><CardHeader><CardTitle>{t("Действия сотрудников")}</CardTitle><CardDescription>{report.coverage.employeeActionsSince ? t("Записи собираются с {v0}. По дате изменения статуса.", { v0: date(report.coverage.employeeActionsSince) }) : t("Учёт начинается с установки новой панели.")}</CardDescription></CardHeader><CardContent>{report.employees.length ? <Table><TableHeader><TableRow><TableHead>{t("Сотрудник")}</TableHead><TableHead>{t("Смен статуса")}</TableHead><TableHead>{t("Выдано")}</TableHead><TableHead>{t("Отменено")}</TableHead></TableRow></TableHeader><TableBody>{report.employees.map((person, index) => <TableRow key={`${person.name}-${index}`}><TableCell>{person.name}</TableCell><TableCell>{number(person.statusChanges)}</TableCell><TableCell>{number(person.completed)}</TableCell><TableCell>{number(person.cancelled)}</TableCell></TableRow>)}</TableBody></Table> : <EmptyState title={t("Нет записанных действий за период")}><p>{t("Действия до начала учёта не восстанавливаются.")}</p></EmptyState>}<p className="admin-muted">{t("Показаны только фактические переходы статусов. Это не назначенные заказы и не выручка сотрудника.")}</p></CardContent></Card>
      <Card><CardHeader><CardTitle>{t("Какие данные доступны")}</CardTitle><CardDescription>{report.coverage.ordersSince ? t("Заказы учитываются с {v0}. История не дополнялась искусственно.", { v0: date(report.coverage.ordersSince) }) : t("В базе ещё нет заказов.")}</CardDescription></CardHeader><CardContent><div className="analytics-unavailable">{report.unavailable.map((item) => <div key={item.key}><strong>{t(item.label)}</strong><Badge variant="outline">{t("Данные не собирались")}</Badge><p>{t(item.reason)}</p></div>)}</div></CardContent></Card>
    </>}
  </div>;
}
