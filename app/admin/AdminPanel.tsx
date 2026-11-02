"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import type { Category, PickupLocation, Product, Promotion } from "../types";
import AdminDialog from "./AdminDialog";
import ProductsSection from "./ProductsSection";
import CrudSection from "./CrudSection";
import LocationsSection from "./LocationsSection";
import AnalyticsSection from "./AnalyticsSection";
import StaffSection from "./StaffSection";
import SchedulesSection from "./SchedulesSection";
import OrdersWorkspace from "./OrdersWorkspace";
import LoyaltyWorkspace from "./LoyaltyWorkspace";
import CustomerWorkspace from "./CustomerWorkspace";
import { AdminAccessProvider, useAdminAccess, type AdminUser } from "./AdminAccess";
import AdminPwa, { clearAdminDevice, detachAdminPushLocally } from "./AdminPwa";
import { SoundSettings, OrderNotificationCenter, useOrderNotifications } from "./AdminNotifications";
import useAdminLiveUpdates from "./useAdminLiveUpdates";
import { AdminLanguageSwitcher, useAdminLanguage } from "./i18n";
import { Badge, Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardAction, CardFooter, EmptyState, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, SidebarHeader, SidebarContent, SidebarFooter, Separator } from "./ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:4000/api");
export type AdminRequest = <T = unknown>(path: string, options?: RequestInit) => Promise<T>;
type Tab = "dashboard" | "orders" | "products" | "categories" | "locations" | "schedules" | "promotions" | "users" | "loyalty" | "staff" | "analytics" | "settings" | "audit" | "profile";
const sections: Array<{ id: Tab; title: string; description: string; permission?: string; group: string; icon: string }> = [
  { id: "dashboard", title: "Обзор", description: "Главное о работе бизнеса сегодня", permission: "dashboard.view", group: "Работа", icon: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z" },
  { id: "orders", title: "Заказы", description: "От нового заказа до выдачи клиенту", permission: "orders.view", group: "Работа", icon: "M8 3h8v4H8z M6 5H4v16h16V5h-2 M8 11h8 M8 15h6" },
  { id: "users", title: "Пользователи", description: "Клиенты, история покупок и контакты", permission: "users.view", group: "Работа", icon: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2" },
  { id: "products", title: "Товары", description: "Меню, фотографии, цены и доступность", permission: "products.view", group: "Каталог", icon: "M3 7l9-4 9 4-9 4z M3 7v10l9 4 9-4V7 M12 11v10" },
  { id: "categories", title: "Категории", description: "Разделы меню и порядок отображения", permission: "categories.view", group: "Каталог", icon: "M4 6h3 M11 6h9 M4 12h3 M11 12h9 M4 18h3 M11 18h9" },
  { id: "promotions", title: "Акции", description: "Предложения на сайте", permission: "promotions.view", group: "Каталог", icon: "M3 3h8l10 10-8 8L3 11z M7 7h.01" },
  { id: "locations", title: "Точки самовывоза", description: "Адреса, карта и время работы", permission: "locations.view", group: "Управление", icon: "M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 0 1 16 0z M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0" },
  { id: "schedules", title: "Время работы", description: "Недельное расписание и приём заказов", permission: "schedules.view", group: "Управление", icon: "M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0" },
  { id: "loyalty", title: "Программа наград", description: "Bonus DAANA Coin, NFT и заявки на вывод", permission: "loyalty.view", group: "Управление", icon: "M3 9h18v4H3z M5 13v8h14v-8 M12 9v12 M12 9C3 9 5 1 9 4l3 5c9 0 7-8 3-5z" },
  { id: "analytics", title: "Аналитика", description: "Продажи, товары и клиенты за выбранный период", permission: "analytics.view", group: "Управление", icon: "M4 3v18h17 M9 16v-4 M14 16V8 M19 16V4" },
  { id: "staff", title: "Персонал", description: "Команда, роли и персональные права", permission: "staff.view", group: "Управление", icon: "M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 21v-3a7 7 0 0 1 14 0v3 M20 4a3 3 0 0 1 0 6" },
  { id: "audit", title: "Журнал действий", description: "Важные изменения и ответственные сотрудники", permission: "audit.view", group: "Система", icon: "M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h4" },
  { id: "settings", title: "Настройки", description: "Контакты и сведения о компании", permission: "settings.view", group: "Система", icon: "M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0" },
  { id: "profile", title: "Мой профиль", description: "Уведомления, звук и приложение на этом устройстве", group: "Система", icon: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2" },
];
const roleNames = { OWNER: "Владелец", ADMIN: "Администратор", MANAGER: "Менеджер" };
function Icon({ path }: { path: string }) { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>; }

function Login({ onLogin }: { onLogin: (user: AdminUser) => void }) {
  const { t } = useAdminLanguage();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const response = await fetch(`${API_URL}/admin/login`, { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), password }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Не удалось войти"); onLogin(data.user);
    } catch (reason) { setError(reason instanceof TypeError || reason instanceof SyntaxError ? "Не удалось подключиться к серверу. Проверьте соединение." : reason instanceof Error ? reason.message : "Сервер недоступен"); } finally { setBusy(false); }
  };
  return <main className="admin-login"><div className="admin-login-layout"><div className="admin-login-intro"><Link href="/catalog/1"><img src="/assets/icons/logo.svg" alt="ДААНА СУШИ" /></Link><Badge variant="outline">{t("Панель управления")}</Badge><h1>{t("Всё для работы.")}<br />{t("В одном месте.")}</h1><p>{t("Заказы, меню и команда — под вашим контролем.")}</p><small>ДААНА СУШИ</small></div><Card><CardHeader><div className="admin-login-card-heading"><CardTitle>{t("Добро пожаловать")}</CardTitle><AdminLanguageSwitcher /></div><CardDescription>{t("Войдите в свою рабочую учётную запись.")}</CardDescription></CardHeader><CardContent><form onSubmit={submit}><label>{t("Логин сотрудника")}<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder={t("Email или оставьте пустым для владельца")} /></label><label>{t("Пароль")}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <div className="admin-error" role="alert">{t(error)}</div>}<Button variant="default" size="lg" disabled={busy}>{t(busy ? "Входим…" : "Войти")}</Button><Link className="admin-muted" href="/catalog/1">{t("Вернуться на сайт")} ↗</Link></form></CardContent></Card></div></main>;
}

type OverviewReport = { daily: Array<{ date: string; orders: number; revenue: number }>; current: { orders: number; revenue: number; averageOrder: number }; changes: { orders: number | null; revenue: number | null }; filters: { from: string; to: string } };
type RecentOrder = { id: number; orderNumber: string; customerName: string; locationName: string; status: string; total: number; createdAt: string };
const orderStatuses: Record<string, string> = { new: "Новый", confirmed: "Подтверждён", preparing: "Готовится", ready: "Готов к выдаче", completed: "Выдан", cancelled: "Отменён" };
function chartCurve(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1]; const center = (previous.x + point.x) / 2;
    return `C ${center} ${previous.y}, ${center} ${point.y}, ${point.x} ${point.y}`;
  }).join(" ");
}
function Overview({ request, refreshKey, navigate, canViewOrders, onOpenOrder }: { request: AdminRequest; refreshKey: number; navigate: (tab: Tab) => void; canViewOrders: boolean; onOpenOrder: (id: number) => void }) {
  const { t, formatNumber, formatDate } = useAdminLanguage(); const { can } = useAdminAccess();
  const canViewAnalytics = can("analytics.view"); const canViewProducts = can("products.view");
  const [data, setData] = useState<Record<string, number | null> | null>(null); const [error, setError] = useState("");
  const [days, setDays] = useState(90); const [report, setReport] = useState<OverviewReport | null>(null); const [chartError, setChartError] = useState(""); const [chartLoading, setChartLoading] = useState(true);
  const [metric, setMetric] = useState<"revenue" | "orders">("revenue");
  const [orders, setOrders] = useState<{ items: RecentOrder[]; total: number }>({ items: [], total: 0 }); const [orderFilter, setOrderFilter] = useState(""); const [orderError, setOrderError] = useState(""); const [ordersLoading, setOrdersLoading] = useState(true);
  const gradient = useId().replaceAll(":", "");
  useEffect(() => { let stopped = false; void request<Record<string, number | null>>("dashboard").then((value) => { if (!stopped) { setData(value); setError(""); } }).catch((reason) => { if (!stopped) setError(reason.message); }); return () => { stopped = true; }; }, [request, refreshKey]);
  useEffect(() => {
    if (!canViewAnalytics) return;
    let stopped = false;
    const timer = setTimeout(() => {
      setChartLoading(true);
      const to = new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
      const from = new Date(Date.parse(to + "T00:00:00Z") - (days - 1) * 86_400_000).toISOString().slice(0, 10);
      void request<OverviewReport>(`analytics?${new URLSearchParams({ from, to })}`).then((value) => { if (!stopped) { setReport(value); setChartError(""); } }).catch((reason) => { if (!stopped) { setChartError(reason.message); setReport(null); } }).finally(() => { if (!stopped) setChartLoading(false); });
    }, 100);
    return () => { stopped = true; clearTimeout(timer); };
  }, [request, refreshKey, days, canViewAnalytics]);
  useEffect(() => {
    if (!canViewOrders) return;
    let stopped = false;
    const timer = setTimeout(() => { setOrdersLoading(true); void request<typeof orders>(`orders?${new URLSearchParams({ limit: "8", offset: "0", status: orderFilter })}`).then((value) => { if (!stopped) { setOrders(value); setOrderError(""); } }).catch((reason) => { if (!stopped) { setOrderError(reason.message); setOrders({ items: [], total: 0 }); } }).finally(() => { if (!stopped) setOrdersLoading(false); }); }, 100);
    return () => { stopped = true; clearTimeout(timer); };
  }, [request, refreshKey, orderFilter, canViewOrders]);
  const cards = [
    { key: "revenueToday", title: "Выручка сегодня", badge: "Сегодня", headline: "Только выданные заказы", detail: "Отменённые заказы не учитываются", allowed: canViewOrders && canViewAnalytics, icon: "M12 3v18 M16 7h-6a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H8" },
    { key: "ordersToday", title: "Заказов сегодня", badge: "Сегодня", headline: "Заказы за день", detail: "Все статусы заказов", allowed: canViewOrders, icon: "M8 3h8v4H8z M6 5H4v16h16V5h-2 M8 11h8 M8 15h6" },
    { key: "activeOrders", title: "Активных заказов", badge: "Сейчас", headline: "Сейчас в работе", detail: "От нового заказа до выдачи", allowed: canViewOrders, icon: "M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0" },
    { key: "products", title: "Товаров в каталоге", badge: "Каталог", headline: "Активные товары меню", detail: "С учётом доступности категории", allowed: canViewProducts, icon: "M3 7l9-4 9 4-9 4z M3 7v10l9 4 9-4V7 M12 11v10" },
  ].filter((item) => item.allowed && (!data || data[item.key] !== null));
  const values = report?.daily.map((row) => Number(row[metric])) || [];
  const maximum = Math.max(1, ...values); const points = values.map((value, index) => ({ x: values.length <= 1 ? 500 : 8 + index / (values.length - 1) * 984, y: 220 - value / maximum * 190 }));
  const curve = chartCurve(points); const area = points.length ? `${curve} L ${points[points.length - 1].x} 220 L ${points[0].x} 220 Z` : "";
  const tickIndexes = report?.daily.map((_, index, rows) => index === 0 || index === rows.length - 1 || index % Math.max(1, Math.ceil(rows.length / 7)) === 0 ? index : -1).filter((index) => index >= 0) || [];
  return <div className="admin-overview">
    {error && <div className="admin-error" role="alert">{t(error)}</div>}
    {cards.length > 0 && <div className="dashboard-section-cards">{cards.map((item) => <Card className="dashboard-metric-card" key={item.key}><CardHeader><CardDescription>{t(item.title)}</CardDescription><CardTitle className="admin-stat-value">{data ? formatNumber(Number(data[item.key] || 0)) + (item.key === "revenueToday" ? " С" : "") : "…"}</CardTitle><CardAction><Badge variant="outline"><Icon path={item.icon} />{t(item.badge)}</Badge></CardAction></CardHeader><CardFooter><strong>{t(item.headline)}</strong><span>{t(item.detail)}</span></CardFooter></Card>)}</div>}
    {canViewAnalytics && <Card className="dashboard-chart-card"><CardHeader><CardTitle>{t(metric === "revenue" ? "Выручка по дням" : "Количество заказов")}</CardTitle><CardDescription>{t("Данные за выбранный период")}{report && <> · {formatDate(report.filters.from, { day: "numeric", month: "short" })} — {formatDate(report.filters.to, { day: "numeric", month: "short" })}</>}</CardDescription><CardAction><div className="dashboard-period-toggle" role="group" aria-label={t("Период")} >{[90, 30, 7].map((value) => <Button key={value} size="sm" aria-pressed={days === value} onClick={() => setDays(value)}>{t(value === 90 ? "Последние 90 дней" : value === 30 ? "Последние 30 дней" : "Последние 7 дней")}</Button>)}</div><select className="dashboard-period-select" aria-label={t("Период")} value={days} onChange={(event) => setDays(Number(event.target.value))}>{[90, 30, 7].map((value) => <option key={value} value={value}>{t(value === 90 ? "Последние 90 дней" : value === 30 ? "Последние 30 дней" : "Последние 7 дней")}</option>)}</select></CardAction></CardHeader><CardContent>
      {chartError ? <div className="admin-error" role="alert">{t(chartError)}</div> : report ? <div className={`dashboard-area-chart ${chartLoading ? "is-loading" : ""}`} aria-busy={chartLoading}><div className="dashboard-chart-scale"><span>{formatNumber(maximum === 1 && values.every((value) => value === 0) ? 0 : maximum, { maximumFractionDigits: 0 })}{metric === "revenue" ? " С" : ""}</span></div><svg viewBox="0 0 1000 250" preserveAspectRatio="none" role="img" aria-label={t(metric === "revenue" ? "Выручка по дням" : "Количество заказов")}><defs><linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".34" /><stop offset="100%" stopColor="currentColor" stopOpacity=".03" /></linearGradient></defs>{[30, 77.5, 125, 172.5, 220].map((y) => <line key={y} x1="0" y1={y} x2="1000" y2={y} className="dashboard-chart-grid" />)}{area && <path d={area} fill={`url(#${gradient})`} />}<path d={curve} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />{points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="8" className="dashboard-chart-point"><title>{formatDate(report.daily[index].date, { day: "numeric", month: "long" })}: {formatNumber(values[index])}{metric === "revenue" ? " С" : ""}</title></circle>)}</svg><div className="dashboard-chart-dates">{tickIndexes.map((index) => <span key={index}>{formatDate(report.daily[index].date, { day: "numeric", month: "short" })}</span>)}</div></div> : <div className="dashboard-chart-skeleton" role="status">{t("Загружаем показатели…")}</div>}
      <div className="dashboard-chart-toolbar"><div className="dashboard-chart-metric" role="group" aria-label={t("Показатель")}><Button size="sm" variant="ghost" aria-pressed={metric === "revenue"} onClick={() => setMetric("revenue")}><span />{t("Выручка")}</Button><Button size="sm" variant="ghost" aria-pressed={metric === "orders"} onClick={() => setMetric("orders")}><span />{t("Заказы")}</Button></div><Button variant="ghost" size="sm" onClick={() => navigate("analytics")}>{t("Открыть аналитику")} <span aria-hidden="true">↗</span></Button></div>
    </CardContent></Card>}
    {canViewOrders && <section className="dashboard-recent-orders"><div className="dashboard-table-toolbar"><div className="dashboard-table-tabs" role="group" aria-label={t("Последние заказы")}>{[["", "Все заказы"], ["new", "Новые"], ["completed", "Выданные"]].map(([value, label]) => <Button key={value} size="sm" variant="ghost" aria-pressed={orderFilter === value} onClick={() => setOrderFilter(value)}>{t(label)}{orderFilter === value && <Badge variant="secondary">{formatNumber(orders.total)}</Badge>}</Button>)}</div><Button size="sm" onClick={() => navigate("orders")}>{t("Показать все заказы")} <span aria-hidden="true">↗</span></Button></div>{orderError && <div className="admin-error banner" role="alert">{t(orderError)}</div>}{ordersLoading && !orders.items.length ? <div className="admin-loading-card" role="status">{t("Загружаем заказы…")}</div> : orders.items.length ? <Table><TableHeader><TableRow><TableHead>{t("Заказ")}</TableHead><TableHead>{t("Клиент")}</TableHead><TableHead>{t("Статус")}</TableHead><TableHead>{t("Точка")}</TableHead><TableHead>{t("Сумма")}</TableHead><TableHead>{t("Дата")}</TableHead><TableHead><span className="sr-only">{t("Действия")}</span></TableHead></TableRow></TableHeader><TableBody>{orders.items.map((order) => <TableRow key={order.id}><TableCell><button type="button" className="dashboard-order-link" onClick={() => onOpenOrder(Number(order.id))}>{order.orderNumber}</button></TableCell><TableCell>{order.customerName}</TableCell><TableCell><Badge variant={order.status === "completed" ? "success" : order.status === "new" ? "warning" : order.status === "cancelled" ? "destructive" : "outline"}>{t(orderStatuses[order.status] || "Неизвестный статус")}</Badge></TableCell><TableCell>{order.locationName}</TableCell><TableCell className="dashboard-money">{formatNumber(Number(order.total))} С</TableCell><TableCell>{formatDate(order.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</TableCell><TableCell><Button variant="ghost" size="icon-sm" aria-label={t("Открыть заказ")} onClick={() => onOpenOrder(Number(order.id))}><Icon path="M9 5l7 7-7 7" /></Button></TableCell></TableRow>)}</TableBody></Table> : !orderError && <Card><CardContent><EmptyState title={t("Заказов пока нет")}><p>{t("Новые заказы появятся здесь автоматически")}</p></EmptyState></CardContent></Card>}</section>}
    {!canViewOrders && !canViewAnalytics && <Card><CardHeader><CardTitle>{t("Рабочий день под контролем")}</CardTitle><CardDescription>{t("Откройте нужный раздел в меню.")}</CardDescription></CardHeader><CardContent><Button onClick={() => navigate("profile")}>{t("Настроить уведомления")}</Button></CardContent></Card>}
  </div>;
}

function Audit({ request, refreshKey }: { request: AdminRequest; refreshKey: number }) {
  const { t, formatNumber, formatDate } = useAdminLanguage();
  const [data, setData] = useState<{ items: Array<{ id: string; actorName?: string; action: string; entityType?: string; createdAt: string }>; total: number }>({ items: [], total: 0 }); const [offset, setOffset] = useState(0); const [error, setError] = useState("");
  useEffect(() => { let stopped = false; void request<typeof data>(`audit?limit=25&offset=${offset}`).then((value) => { if (!stopped) { setData(value); setError(""); } }).catch((reason) => { if (!stopped) setError(reason.message); }); return () => { stopped = true; }; }, [request, offset, refreshKey]);
  const auditLabel = (action: string) => {
    const labels: Record<string, string> = { create: "Создание", edit: "Редактирование", update: "Изменение", delete: "Архивация", status: "Смена статуса", access: "Изменение прав", login: "Вход", logout: "Выход", "orders.status": "Изменён статус заказа", "staff.create": "Добавлен сотрудник", "staff.edit": "Изменены данные сотрудника", "staff.access": "Изменены права сотрудника", "settings.edit": "Изменены настройки компании", "schedules.edit": "Изменено расписание" };
    if (labels[action]) return t(labels[action]);
    const [method, resource] = action.split(" "); const names: Record<string, string> = { products: "Товары", categories: "Категории", locations: "Точки самовывоза", promotions: "Акции", settings: "Настройки", customers: "Клиенты", "coin-withdrawals": "Вывод Coin", "nft-withdrawals": "Вывод NFT", orders: "Заказы" };
    return names[resource] ? t(method === "POST" ? "{section}: создание" : method === "DELETE" ? "{section}: архивация" : "{section}: изменение", { section: t(names[resource]) }) : t("Изменение рабочих данных");
  };
  return <Card><CardHeader><CardTitle>{t("История важных действий")}</CardTitle><CardDescription>{t("Учёт ведётся с момента установки новой версии. Пароли и токены не записываются.")}</CardDescription></CardHeader><CardContent>{error && <div className="admin-error" role="alert">{t(error)}</div>}{!data.items.length ? <EmptyState title={t("Действий пока нет")} /> : <Table><TableHeader><TableRow><TableHead>{t("Когда")}</TableHead><TableHead>{t("Сотрудник")}</TableHead><TableHead>{t("Действие")}</TableHead></TableRow></TableHeader><TableBody>{data.items.map((entry) => <TableRow key={entry.id}><TableCell>{formatDate(entry.createdAt, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</TableCell><TableCell>{entry.actorName || t("Система")}</TableCell><TableCell>{auditLabel(entry.action)}</TableCell></TableRow>)}</TableBody></Table>}<div className="admin-pagination"><span>{t("Всего: {count}", { count: formatNumber(data.total) })}</span><div><Button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 25))}>{t("Назад")}</Button><Button disabled={offset + 25 >= data.total} onClick={() => setOffset(offset + 25)}>{t("Далее")}</Button></div></div></CardContent></Card>;
}

function QuickSearch({ can, onNavigate, onClose }: { can: (permission: string) => boolean; onNavigate: (tab: Tab) => boolean; onClose: () => void }) {
  const { t } = useAdminLanguage(); const [query, setQuery] = useState(""); const [selected, setSelected] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null); const input = useRef<HTMLInputElement>(null); const id = useId();
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  const items = sections.filter((item) => (!item.permission || can(item.permission)) && (!query.trim() || `${t(item.title)} ${t(item.description)} ${item.title}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  useEffect(() => { dialog.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [selected, query]);
  useEffect(() => { const element = dialog.current; const previous = document.activeElement as HTMLElement | null; const overflow = document.body.style.overflow; const dismissBackdrop = (event: MouseEvent) => { if (event.target === element) close.current(); }; element?.addEventListener("click", dismissBackdrop); element?.showModal(); input.current?.focus(); document.body.style.overflow = "hidden"; return () => { element?.removeEventListener("click", dismissBackdrop); element?.close(); document.body.style.overflow = overflow; previous?.focus(); }; }, []);
  return <dialog ref={dialog} className="admin-command-dialog" aria-labelledby={id} onCancel={(event) => { event.preventDefault(); onClose(); }}><div className="admin-command-search"><Icon path="M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0" /><input ref={input} value={query} placeholder={t("Поиск по разделам…")} aria-label={t("Поиск раздела")} aria-controls={`${id}-results`} aria-activedescendant={items[selected] ? `${id}-${items[selected].id}` : undefined} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => items.length ? (value + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length : 0); } if (event.key === "Enter" && items[selected]) { event.preventDefault(); if (onNavigate(items[selected].id)) onClose(); } }} /><kbd>Esc</kbd></div><h2 className="sr-only" id={id}>{t("Быстрый переход")}</h2><div className="admin-command-results" role="listbox" id={`${id}-results`} aria-label={t("Разделы")}>{items.length ? items.map((item, index) => <button type="button" role="option" aria-selected={selected === index} id={`${id}-${item.id}`} key={item.id} onPointerMove={() => setSelected(index)} onClick={() => { if (onNavigate(item.id)) onClose(); }}><Icon path={item.icon} /><span>{t(item.title)}<small>{t(item.group)}</small></span><span aria-hidden="true">↵</span></button>) : <p>{t("По вашему запросу ничего не найдено")}</p>}</div><footer>{t("Найдите нужный раздел панели")}<span aria-hidden="true">↑ ↓ ↵</span></footer></dialog>;
}

export default function AdminPanel() {
  const { t, formatNumber } = useAdminLanguage();
  const [user, setUser] = useState<AdminUser | null>(null); const userRef = useRef<AdminUser | null>(null);
  const [checked, setChecked] = useState(false); const [tab, setTab] = useState<Tab>("orders"); const [mobile, setMobile] = useState(false);
  const [theme, setTheme] = useState("light");
  const [collapsed, setCollapsed] = useState(false); const [searchOpen, setSearchOpen] = useState(false);
  const [newOrders, setNewOrders] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false); const [logoutBusy, setLogoutBusy] = useState(false); const [orderToOpen, setOrderToOpen] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]); const [products] = useState<Product[]>([]); const [locations, setLocations] = useState<PickupLocation[]>([]); const [promotions] = useState<Promotion[]>([]);
  const [settings, setSettings] = useState({ legalName: "", telegram: "" }); const [settingsBusy, setSettingsBusy] = useState(false); const [settingsDirty, setSettingsDirty] = useState(false);
  const generation = useRef(0); const authEpoch = useRef(0); const requestedTab = useRef<Tab | null>(null);
  const userId = user?.id; const accessSignature = user ? user.role + user.permissions.join(",") : "";
  const can = useCallback((permission: string) => user?.role === "OWNER" || Boolean(user?.permissions.includes(permission)), [user]);
  const updateSession = useCallback((next: AdminUser | null) => { if (JSON.stringify(userRef.current) !== JSON.stringify(next)) authEpoch.current++; userRef.current = next; setUser((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next); }, []);
  const session = useCallback(async () => {
    const epoch = authEpoch.current;
    try {
      const response = await fetch(`${API_URL}/admin/session`, { credentials: "include", cache: "no-store" });
      if (!response.ok) { if (response.status === 401 && authEpoch.current === epoch) { generation.current++; void detachAdminPushLocally(); updateSession(null); } return null; }
      const data = await response.json(); if (authEpoch.current !== epoch) return userRef.current; updateSession(data.user); return data.user as AdminUser;
    } catch { return null; } finally { setChecked(true); }
  }, [updateSession]);
  useEffect(() => {
    document.documentElement.classList.add("admin-page");
    const query = new URLSearchParams(location.search); const target = query.get("section") as Tab;
    if (sections.some((item) => item.id === target)) requestedTab.current = target;
    const timer = setTimeout(() => {
      const saved = localStorage.getItem("daana-admin-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); setTheme(saved); document.documentElement.dataset.theme = saved;
      setCollapsed(localStorage.getItem("daana-admin-sidebar") === "collapsed");
      void session().then((current) => { if (current) setTab(requestedTab.current || (current.role === "MANAGER" ? "orders" : current.permissions.includes("dashboard.view") || current.role === "OWNER" ? "dashboard" : "orders")); });
    }, 0);
    return () => { clearTimeout(timer); document.documentElement.classList.remove("admin-page"); delete document.documentElement.dataset.theme; };
  }, [session]);
  useEffect(() => {
    if (!userId) return;
    const check = () => void session(); const interval = setInterval(check, 10000);
    window.addEventListener("focus", check); window.addEventListener("admin-access-changed", check);
    return () => { clearInterval(interval); window.removeEventListener("focus", check); window.removeEventListener("admin-access-changed", check); };
  }, [userId, session]);
  const request = useCallback(async <T = unknown,>(path: string, options: RequestInit = {}): Promise<T> => {
    const epoch = authEpoch.current;
    const response = await fetch(`${API_URL}/admin/${path.replace(/^\/+/, "")}`, { ...options, credentials: "include", cache: "no-store" }).catch(() => { throw new Error("Сервер недоступен. Проверьте подключение и повторите попытку."); });
    if (response.status === 401) { if (authEpoch.current === epoch) { generation.current++; void detachAdminPushLocally(); updateSession(null); } throw new Error("Сессия завершена. Войдите снова."); }
    if (response.status === 403) { void session(); throw new Error("Недостаточно прав для этого действия"); }
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || "Не удалось выполнить запрос"); }
    if (response.status === 204) return null as T;
    return response.json() as Promise<T>;
  }, [session, updateSession]);
  const sound = useOrderNotifications(userId, can("orders.view"), request);
  const refreshLive = useCallback(async () => { const current = await session(); if (current) setRefreshKey((value) => value + 1); }, [session]);
  const accessChanged = useCallback(async () => { generation.current++; setCategories([]); setLocations([]); await session(); }, [session]);
  useAdminLiveUpdates(API_URL, Boolean(userId), refreshLive, { onOrder: sound.receive, onAccessChanged: accessChanged, onReconnect: sound.sync });
  useEffect(() => {
    if (!userId) return;
    const shortcut = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen((value) => !value); } };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  }, [userId]);
  useEffect(() => { if (!user || !can("orders.view")) return; let stopped = false; const timer = setTimeout(() => { void request<{newOrders:number}>("orders/summary").then((data) => { if (!stopped) setNewOrders(data.newOrders); }).catch(() => {}); }, 0); return () => { stopped = true; clearTimeout(timer); }; }, [user, can, request, refreshKey]);
  const section = sections.find((item) => item.id === tab)!; const allowed = !section.permission || can(section.permission);
  useEffect(() => {
    const current = ++generation.current;
    if (!userId || !allowed) return;
    let stopped = false;
    const perform = async () => {
      setLoading(true);
      try {
        // Fetch only sources needed for the open screen and permitted by the server.
        if (tab === "products") { const data = await request<{ categories: Category[] }>("products/options"); if (!stopped && generation.current === current) setCategories(data.categories); }
        if (tab === "settings") {
          const path = "settings";
          const data = await request<Array<{ key: string; value: unknown }>>(path);
          if (!stopped && generation.current === current) {
            const general = data.find((row) => row.key === "general")?.value; if (general && !settingsDirty) setSettings(general as typeof settings);
          }
        }
      } catch (reason) { if (!stopped && generation.current === current) setError(reason instanceof Error ? reason.message : "Ошибка загрузки"); }
      finally { if (!stopped && generation.current === current) setLoading(false); }
    };
    void perform(); return () => { stopped = true; };
  }, [tab, userId, accessSignature, allowed, refreshKey, request, can, settingsDirty]);
  const refresh = useCallback(async () => { setRefreshKey((value) => value + 1); }, []);
  const navigate = useCallback((id: Tab) => {
    if ((settingsDirty || document.querySelector('[data-admin-dirty="true"]')) && !window.confirm(t("Покинуть страницу без сохранения изменений?"))) return false;
    setTab(id); setMobile(false); setSettingsDirty(false); setError(""); setNotice("");
    const url = new URL(location.href); url.searchParams.set("section", id); url.searchParams.delete("order"); history.replaceState(null, "", url); window.scrollTo({ top: 0 });
    return true;
  }, [settingsDirty, t]);
  const openOrder = useCallback((id: number) => { if (can("orders.view") && navigate("orders")) { setOrderToOpen(id); sound.dismiss(); } }, [can, navigate, sound]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (settingsDirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [settingsDirty]);
  useEffect(() => { if (!userId || !can("orders.view")) return; const value = Number(new URLSearchParams(location.search).get("order")); if (Number.isSafeInteger(value) && value > 0) { const timer = setTimeout(() => { setTab("orders"); setOrderToOpen(value); }, 0); return () => clearTimeout(timer); } }, [userId, can]);
  const opened = useCallback(() => { setOrderToOpen(null); const url = new URL(location.href); url.searchParams.delete("order"); history.replaceState(null, "", url); }, []);
  const logout = async () => {
    if (logoutBusy || (settingsDirty || document.querySelector('[data-admin-dirty="true"]')) && !confirm(t("Выйти без сохранения изменений?"))) return;
    setLogoutBusy(true); setError("");
    try {
      await clearAdminDevice(request); await request("logout", { method: "POST" }); generation.current++; updateSession(null); setCategories([]); setLocations([]); setNewOrders(0); setSettings({ legalName: "", telegram: "" }); setOrderToOpen(null); setSettingsDirty(false);
      localStorage.removeItem("sushi-admin-token");
      for (let index = sessionStorage.length - 1; index >= 0; index--) { const key = sessionStorage.key(index); if (key && /^(?:daana-admin|sushi-admin)/.test(key)) sessionStorage.removeItem(key); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось выйти"); } finally { setLogoutBusy(false); }
  };
  const saveSettings = async (event: FormEvent) => { event.preventDefault(); setSettingsBusy(true); setError(""); try { await request("settings/general", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: settings }) }); setSettingsDirty(false); setNotice("Настройки сохранены"); } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить настройки"); } finally { setSettingsBusy(false); } };
  const toggleSidebar = () => {
    if (matchMedia("(max-width: 900px)").matches) { setMobile(true); return; }
    setCollapsed((value) => { localStorage.setItem("daana-admin-sidebar", value ? "expanded" : "collapsed"); return !value; });
  };
  if (!checked) return <main className="admin-login"><Card><CardContent><p role="status">{t("Проверяем рабочую сессию…")}</p></CardContent></Card></main>;
  if (!user) return <Login onLogin={(current) => { updateSession(current); setChecked(true); setTab(current.role === "MANAGER" ? "orders" : current.role === "OWNER" || current.permissions.includes("dashboard.view") ? "dashboard" : "orders"); }} />;
  const home = can("dashboard.view") ? "dashboard" : can("orders.view") ? "orders" : "profile";
  const navigation = <nav aria-label={t("Главная навигация")}>{["Работа", "Каталог", "Управление", "Система"].map((group) => {
    const items = sections.filter((item) => item.group === group && (!item.permission || can(item.permission)));
    return items.length > 0 && <div data-slot="sidebar-group" className="nav-group" key={group}><span data-slot="sidebar-group-label" className="admin-nav-label">{t(group)}</span><div data-slot="sidebar-menu">{items.map((item) => <button data-slot="sidebar-menu-button" key={item.id} type="button" title={t(item.title)} aria-label={t(item.title)} className={item.id === tab ? "active" : ""} aria-current={item.id === tab ? "page" : undefined} onClick={() => navigate(item.id)}><Icon path={item.icon} /><span className="admin-nav-item-title">{t(item.title)}</span>{item.id === "orders" && newOrders > 0 && <Badge variant="secondary">{formatNumber(newOrders)}</Badge>}</button>)}</div></div>;
  })}</nav>;
  let content: ReactNode;
  if (!allowed) content = <Card><CardContent><EmptyState title={t("Нет доступа")}><p>{t("Владелец может изменить ваши права в разделе «Персонал».")}</p><Button onClick={() => navigate(sections.find((item) => item.permission && can(item.permission))?.id || "profile")}>{t("Открыть доступный раздел")}</Button></EmptyState></CardContent></Card>;
  else if (tab === "dashboard") content = <Overview request={request} refreshKey={refreshKey} navigate={navigate} canViewOrders={can("orders.view")} onOpenOrder={openOrder} />;
  else if (tab === "orders") content = <OrdersWorkspace request={request} refreshKey={refreshKey} orderToOpen={orderToOpen} onOpened={opened} />;
  else if (tab === "products") content = <ProductsSection products={products} categories={categories} request={request} onRefresh={refresh} refreshKey={refreshKey} />;
  else if (tab === "categories") content = <CrudSection title={t("Категории меню")} rows={categories as unknown as Array<Record<string, unknown>>} fields={[{ key: "name", label: t("Название") }, { key: "sortOrder", label: t("Порядок"), type: "number" }, { key: "active", label: t("Активна"), type: "checkbox" }]} empty={{ name: "", sortOrder: 0, active: true }} endpoint="categories" request={request} onRefresh={refresh} refreshKey={refreshKey} />;
  else if (tab === "locations") content = <LocationsSection locations={locations} request={request} onRefresh={refresh} refreshKey={refreshKey} />;
  else if (tab === "promotions") content = <CrudSection title={t("Акции")} rows={promotions as unknown as Array<Record<string, unknown>>} fields={[{ key: "title", label: t("Название") }, { key: "description", label: t("Описание"), type: "textarea" }, { key: "image", label: t("Изображение") }, { key: "sortOrder", label: t("Порядок"), type: "number" }, { key: "active", label: t("Активна"), type: "checkbox" }]} empty={{ title: "", description: "", image: "", sortOrder: 0, active: true }} endpoint="promotions" request={request} onRefresh={refresh} refreshKey={refreshKey} />;
  else if (tab === "schedules") content = <SchedulesSection request={request} refreshKey={refreshKey} />;
  else if (tab === "users") content = <CustomerWorkspace key={accessSignature} request={request} refreshKey={refreshKey} />;
  else if (tab === "loyalty") content = <LoyaltyWorkspace request={request} refreshKey={refreshKey} />;
  else if (tab === "analytics") content = <AnalyticsSection request={request} refreshKey={refreshKey} />;
  else if (tab === "staff") content = <StaffSection request={request} refreshKey={refreshKey} />;
  else if (tab === "audit") content = <Audit request={request} refreshKey={refreshKey} />;
  else if (tab === "profile") content = <div className="admin-profile-workspace"><Card><CardHeader><CardTitle>{user.name}</CardTitle><CardDescription>{t(roleNames[user.role])} · {user.email}</CardDescription></CardHeader><CardContent><Badge variant="success">{t("Рабочая сессия активна")}</Badge></CardContent></Card>{can("orders.view") && <SoundSettings controller={sound} />}<AdminPwa request={request} canNotify={can("orders.view")} /></div>;
  else content = <Card><CardHeader><CardTitle>{t("О компании")}</CardTitle><CardDescription>{t("Контакты, которые показываются на сайте.")}</CardDescription></CardHeader><CardContent><form className="settings-form" onSubmit={saveSettings}><fieldset disabled={!can("settings.edit") || settingsBusy}><label>{t("Юридическое название")}<input required maxLength={200} value={settings.legalName} onChange={(event) => { setSettings({ ...settings, legalName: event.target.value }); setSettingsDirty(true); }} /></label><label>{t("Ссылка Telegram")}<input type="url" value={settings.telegram} onChange={(event) => { setSettings({ ...settings, telegram: event.target.value }); setSettingsDirty(true); }} /></label><Button variant="default" disabled={!settingsDirty || settingsBusy}>{t(settingsBusy ? "Сохраняем…" : "Сохранить")}</Button></fieldset></form></CardContent></Card>;
  return <AdminAccessProvider user={user}><div className="admin-shell" data-theme={theme} data-collapsed={collapsed}>
    <aside className="admin-sidebar" data-slot="sidebar" data-state={collapsed ? "collapsed" : "expanded"}>
      <SidebarHeader><button type="button" className="admin-brand" title={t("На главную панели")} onClick={() => navigate(home)}><span className="admin-brand-initial" aria-hidden="true">Д</span><span className="admin-brand-copy"><img src="/assets/icons/logo.svg" alt="ДААНА СУШИ" /><span>{t("Панель управления")}</span></span></button></SidebarHeader>
      <SidebarContent>{navigation}</SidebarContent>
      <SidebarFooter><Link className="admin-site-link" href="/catalog/1" target="_blank" rel="noreferrer" title={t("Открыть сайт")}><Icon path="M14 3h7v7 M21 3l-11 11 M10 3H3v18h18v-7" /><span>{t("Открыть сайт")}</span></Link><button className="admin-account-button" title={t("Мой профиль")} onClick={() => navigate("profile")}><span className="admin-avatar">{user.name.slice(0, 1)}</span><span className="admin-account-copy"><strong>{user.name}</strong><small>{t(roleNames[user.role])}</small></span><Icon path="M8 9l4-4 4 4 M8 15l4 4 4-4" /></button></SidebarFooter>
    </aside>
    <div className="admin-workspace" data-slot="sidebar-inset">
      <header className="admin-topbar"><div className="admin-header-leading"><Button variant="ghost" size="icon" className="admin-sidebar-trigger" aria-label={t("Меню")} onClick={toggleSidebar}><Icon path="M8 3v18 M3 3h18v18H3z" /></Button><Separator orientation="vertical" /><Button className="admin-search-trigger" size="sm" onClick={() => setSearchOpen(true)} aria-label={t("Поиск по разделам")}><Icon path="M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0" /><span>{t("Поиск по разделам…")}</span><kbd>Ctrl K</kbd></Button></div>
        <div className="admin-topbar-actions"><AdminLanguageSwitcher />{can("orders.view") && <><OrderNotificationCenter controller={sound} onOpenOrder={openOrder} /></>}<Separator orientation="vertical" /><Button variant="ghost" size="icon" aria-label={t(theme === "dark" ? "Светлая тема" : "Тёмная тема")} onClick={() => { const value = theme === "dark" ? "light" : "dark"; setTheme(value); document.documentElement.dataset.theme = value; localStorage.setItem("daana-admin-theme", value); }}><Icon path={theme === "dark" ? "M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6L7 7 M17 17l1.4 1.4 M5.6 18.4L7 17 M17 7l1.4-1.4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0" : "M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10"} /></Button><Button variant="ghost" size="icon" className="admin-header-logout" disabled={logoutBusy} aria-label={t(logoutBusy ? "Выходим…" : "Выйти")} title={t("Выйти")} onClick={() => void logout()}><Icon path="M9 4H3v16h6 M9 12h12 M17 8l4 4-4 4" /></Button></div>
      </header>
      <main className="admin-main" id="admin-content"><header className="admin-page-header"><div><h1>{t(section.title)}</h1><p>{t(section.description)}</p></div><Button size="sm" onClick={() => void refresh()} disabled={loading}><Icon path="M20 7v5h-5 M4 17v-5h5 M6.1 7a7 7 0 0 1 11.6-2L20 8 M4 16l2.3 3A7 7 0 0 0 18 17" />{t("Обновить")}</Button></header><AdminPwa request={request} canNotify={can("orders.view")} compact />{error && <div className="admin-error banner" role="alert">{t(error)}</div>}{notice && <div className="admin-success banner" role="status">{t(notice)}</div>}{content}</main>
    </div>
    {mobile && <AdminDialog title={t("Разделы")} onClose={() => setMobile(false)} className="admin-navigation-dialog"><div className="admin-mobile-navigation">{navigation}<Separator /><button type="button" className="admin-mobile-logout" disabled={logoutBusy} onClick={() => void logout()}>{t(logoutBusy ? "Выходим…" : "Выйти")}</button></div></AdminDialog>}
    {searchOpen && <QuickSearch can={can} onNavigate={navigate} onClose={() => setSearchOpen(false)} />}
    {sound.notification && <div className="admin-order-toast" role="status"><span className="admin-notification-icon"><Icon path="M8 3h8v4H8z M6 5H4v16h16V5h-2 M8 11h8 M8 15h6" /></span><div><strong>{t("Новый заказ №{number}", { number: sound.notification.orderNumber })}</strong><small>{t("Откройте карточку заказа")}</small></div><Button onClick={() => openOrder(sound.notification!.orderId)}>{t("Открыть")}</Button><Button variant="ghost" size="icon-sm" aria-label={t("Закрыть уведомление")} onClick={sound.dismiss}>×</Button></div>}
  </div></AdminAccessProvider>;
}
