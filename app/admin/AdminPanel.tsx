"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Category, PickupLocation, Product, Promotion } from "../types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
type Tab = "orders" | "products" | "categories" | "locations" | "promotions" | "settings";
type Order = { id: number; orderNumber: string; customerName: string; customerPhone: string; status: string; total: number; createdAt: string; locationName: string; comment: string; items: Array<{ productName: string; quantity: number; lineTotal: number }> };
type Dashboard = { ordersToday: number; revenueToday: number; products: number; activeOrders: number };

const statusLabels: Record<string, string> = { new: "Новый", confirmed: "Подтвержден", preparing: "Готовится", ready: "Готов", completed: "Выдан", cancelled: "Отменен" };

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState("admin@sushitochka.local");
  const [password, setPassword] = useState("ChangeMe123!");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setError("");
    try {
      const response = await fetch(`${API_URL}/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось войти");
      localStorage.setItem("sushi-admin-token", result.token); onLogin(result.token);
    } catch (loginError) { setError(loginError instanceof Error ? loginError.message : "Сервер недоступен"); }
    finally { setPending(false); }
  };
  return <main className="admin-login"><form onSubmit={submit}><img src="/assets/icons/logo.svg" alt="Суши Точка" /><h1>Управление сайтом</h1><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <div className="admin-error">{error}</div>}<button disabled={pending}>{pending ? "Вход…" : "Войти"}</button><small>Тестовые данные указаны в .env.example. Перед публикацией смените пароль.</small></form></main>;
}

function CrudSection({ title, rows, fields, empty, endpoint, request, onRefresh }: {
  title: string;
  rows: Array<Record<string, unknown>>;
  fields: Array<{ key: string; label: string; type?: "text" | "number" | "textarea" | "checkbox" }>;
  empty: Record<string, unknown>;
  endpoint: string;
  request: (path: string, options?: RequestInit) => Promise<unknown>;
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!editing) return; setSaving(true);
    const id = editing.id; await request(id ? `${endpoint}/${id}` : endpoint, { method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing) });
    setEditing(null); await onRefresh(); setSaving(false);
  };
  const remove = async (row: Record<string, unknown>) => {
    if (!window.confirm(`Удалить «${row.name || row.title}»?`)) return;
    await request(`${endpoint}/${row.id}`, { method: "DELETE" }); await onRefresh();
  };
  return <section className="admin-section"><div className="section-title"><h2>{title}</h2><button className="admin-primary" onClick={() => setEditing({ ...empty })}>+ Добавить</button></div>{editing && <form className="editor-form" onSubmit={save}><h3>{editing.id ? "Редактирование" : "Новая запись"}</h3><div className="editor-grid">{fields.map((field) => field.type === "checkbox" ? <label className="check-field" key={field.key}><input type="checkbox" checked={Boolean(editing[field.key])} onChange={(event) => setEditing({ ...editing, [field.key]: event.target.checked })} />{field.label}</label> : <label key={field.key}>{field.label}{field.type === "textarea" ? <textarea value={String(editing[field.key] ?? "")} onChange={(event) => setEditing({ ...editing, [field.key]: event.target.value })} /> : <input type={field.type || "text"} value={String(editing[field.key] ?? "")} onChange={(event) => setEditing({ ...editing, [field.key]: field.type === "number" ? Number(event.target.value) : event.target.value })} required={field.key === "name" || field.key === "title"} />}</label>)}</div><div className="editor-actions"><button type="button" onClick={() => setEditing(null)}>Отмена</button><button className="admin-primary" disabled={saving}>Сохранить</button></div></form>}<div className="admin-table-wrap"><table><thead><tr>{fields.slice(0, 4).map((field) => <th key={field.key}>{field.label}</th>)}<th /></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}>{fields.slice(0, 4).map((field) => <td key={field.key}>{field.type === "checkbox" ? (row[field.key] ? "Да" : "Нет") : String(row[field.key] ?? "")}</td>)}<td className="row-actions"><button onClick={() => setEditing({ ...row })}>Изменить</button><button className="danger" onClick={() => remove(row)}>Удалить</button></td></tr>)}</tbody></table></div></section>;
}

export default function AdminPanel() {
  const [token, setToken] = useState("");
  const [tab, setTab] = useState<Tab>("orders");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard>({ ordersToday: 0, revenueToday: 0, products: 0, activeOrders: 0 });
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [productEditing, setProductEditing] = useState<Partial<Product> | null>(null);
  const [settings, setSettings] = useState({ legalName: "ИП Багаутдинова", qualityControl: "Отдел контроля качества", telegram: "https://t.me/BIG_REST_TEAM" });

  // Read the browser-only session after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setToken(localStorage.getItem("sushi-admin-token") || ""); setLoading(false); }, []);
  const request = useCallback(async (path: string, options: RequestInit = {}) => {
    const response = await fetch(`${API_URL}/admin/${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
    if (response.status === 401) { localStorage.removeItem("sushi-admin-token"); setToken(""); throw new Error("Сессия истекла"); }
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || "Ошибка запроса"); }
    if (response.status === 204) return null;
    return response.json();
  }, [token]);

  const loadAll = useCallback(async () => {
    if (!token) return; setLoading(true); setError("");
    try {
      const [dashboardData, orderData, productData, categoryData, locationData, promotionData, settingRows] = await Promise.all([
        request("dashboard"), request("orders"), request("products"), request("categories"), request("locations"), request("promotions"), request("settings"),
      ]) as [Dashboard, Order[], Product[], Category[], PickupLocation[], Promotion[], Array<{ key: string; value: typeof settings }>];
      setDashboard(dashboardData); setOrders(orderData); setProducts(productData); setCategories(categoryData); setLocations(locationData); setPromotions(promotionData);
      const general = settingRows.find((row) => row.key === "general"); if (general) setSettings(general.value);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить данные"); }
    finally { setLoading(false); }
  }, [request, token]);
  // Loading remote administration data is the synchronization performed by this effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadAll(); }, [loadAll]);

  const productSave = async (event: FormEvent) => {
    event.preventDefault(); if (!productEditing) return;
    await request(productEditing.id ? `products/${productEditing.id}` : "products", { method: productEditing.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(productEditing) });
    setProductEditing(null); await loadAll();
  };
  const uploadProductImage = async (file: File) => {
    const body = new FormData(); body.append("file", file);
    const result = await request("upload", { method: "POST", body }) as { url: string };
    setProductEditing((current) => current ? { ...current, image: `${API_URL.replace(/\/api$/, "")}${result.url}` } : current);
  };
  const deleteProduct = async (product: Product) => { if (!window.confirm(`Удалить «${product.name}»?`)) return; await request(`products/${product.id}`, { method: "DELETE" }); await loadAll(); };
  const updateStatus = async (order: Order, status: string) => { await request(`orders/${order.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); await loadAll(); };
  const saveSettings = async (event: FormEvent) => { event.preventDefault(); await request("settings/general", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: settings }) }); };

  const menu = useMemo(() => [
    ["orders", "Заказы"], ["products", "Товары"], ["categories", "Категории"], ["locations", "Точки"], ["promotions", "Акции"], ["settings", "Настройки"],
  ] as Array<[Tab, string]>, []);

  if (!token && !loading) return <Login onLogin={setToken} />;
  return <div className="admin-shell"><aside className="admin-sidebar"><img src="/assets/icons/logo.svg" alt="Суши Точка" /><nav>{menu.map(([id, label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id)}>{label}</button>)}</nav><Link href="/catalog/1">Открыть сайт</Link><button className="logout" onClick={() => { localStorage.removeItem("sushi-admin-token"); setToken(""); }}>Выйти</button></aside><main className="admin-main"><header><div><h1>{menu.find(([id]) => id === tab)?.[1]}</h1><p>Управление «Суши Точка»</p></div><button onClick={() => void loadAll()}>Обновить</button></header>{error && <div className="admin-error banner">{error}</div>}{loading && <div className="admin-loading">Загрузка…</div>}
    {!loading && tab === "orders" && <section><div className="stat-grid"><div><strong>{dashboard.ordersToday}</strong><span>Заказов сегодня</span></div><div><strong>{dashboard.revenueToday} ₽</strong><span>Выручка сегодня</span></div><div><strong>{dashboard.activeOrders}</strong><span>Активных заказов</span></div><div><strong>{dashboard.products}</strong><span>Товаров на сайте</span></div></div><div className="order-list">{orders.length === 0 && <div className="empty-admin">Заказов пока нет</div>}{orders.map((order) => <article className="order-card" key={order.id}><div className="order-head"><div><strong>#{order.orderNumber}</strong><span>{new Date(order.createdAt).toLocaleString("ru-RU")}</span></div><select value={order.status} onChange={(event) => updateStatus(order, event.target.value)}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div><div className="order-info"><span><b>{order.customerName}</b><br />{order.customerPhone}</span><span><b>{order.locationName}</b><br />{order.comment || "Без комментария"}</span><strong>{order.total} ₽</strong></div><div className="order-items">{order.items.map((item, index) => <span key={`${item.productName}-${index}`}>{item.productName} × {item.quantity}</span>)}</div></article>)}</div></section>}
    {!loading && tab === "products" && <section className="admin-section"><div className="section-title"><h2>Каталог товаров</h2><button className="admin-primary" onClick={() => setProductEditing({ name: "", price: 0, categoryId: categories[0]?.id || 1, image: "", active: true, sortOrder: 0 })}>+ Добавить</button></div>{productEditing && <form className="editor-form" onSubmit={productSave}><h3>{productEditing.id ? "Редактирование товара" : "Новый товар"}</h3><div className="editor-grid"><label>Название<input value={productEditing.name || ""} onChange={(event) => setProductEditing({ ...productEditing, name: event.target.value })} required /></label><label>Категория<select value={productEditing.categoryId} onChange={(event) => setProductEditing({ ...productEditing, categoryId: Number(event.target.value) })}>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label>Цена<input type="number" min="0" value={productEditing.price || 0} onChange={(event) => setProductEditing({ ...productEditing, price: Number(event.target.value) })} /></label><label>Порядок<input type="number" value={productEditing.sortOrder || 0} onChange={(event) => setProductEditing({ ...productEditing, sortOrder: Number(event.target.value) })} /></label><label className="wide-field">URL изображения<input value={productEditing.image || ""} onChange={(event) => setProductEditing({ ...productEditing, image: event.target.value })} /></label><label>Загрузить файл<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => event.target.files?.[0] && uploadProductImage(event.target.files[0])} /></label><label className="check-field"><input type="checkbox" checked={productEditing.active ?? true} onChange={(event) => setProductEditing({ ...productEditing, active: event.target.checked })} />Показывать на сайте</label></div><div className="editor-actions"><button type="button" onClick={() => setProductEditing(null)}>Отмена</button><button className="admin-primary">Сохранить</button></div></form>}<div className="product-admin-grid">{products.map((product) => <article key={product.id}><img src={product.image} alt="" /><div><strong>{product.name}</strong><span>{categories.find((category) => category.id === product.categoryId)?.name} · {product.price} ₽</span><small>{product.active ? "На сайте" : "Скрыт"}</small></div><button onClick={() => setProductEditing(product)}>Изменить</button><button className="danger" onClick={() => deleteProduct(product)}>Удалить</button></article>)}</div></section>}
    {!loading && tab === "categories" && <CrudSection title="Категории меню" rows={categories as unknown as Array<Record<string, unknown>>} fields={[{ key: "name", label: "Название" }, { key: "slug", label: "Slug" }, { key: "sortOrder", label: "Порядок", type: "number" }, { key: "active", label: "Активна", type: "checkbox" }]} empty={{ name: "", slug: "", sortOrder: 0, active: true }} endpoint="categories" request={request} onRefresh={loadAll} />}
    {!loading && tab === "locations" && <CrudSection title="Точки самовывоза" rows={locations as unknown as Array<Record<string, unknown>>} fields={[{ key: "name", label: "Название" }, { key: "address", label: "Адрес" }, { key: "phone", label: "Телефон" }, { key: "hours", label: "Часы" }, { key: "opensAt", label: "Открытие" }, { key: "latitude", label: "Широта", type: "number" }, { key: "longitude", label: "Долгота", type: "number" }, { key: "active", label: "Активна", type: "checkbox" }]} empty={{ name: "", address: "", phone: "", hours: "10:00 - 21:00", opensAt: "10:00", latitude: 0, longitude: 0, active: true }} endpoint="locations" request={request} onRefresh={loadAll} />}
    {!loading && tab === "promotions" && <CrudSection title="Акции" rows={promotions as unknown as Array<Record<string, unknown>>} fields={[{ key: "title", label: "Заголовок" }, { key: "description", label: "Описание", type: "textarea" }, { key: "image", label: "Изображение" }, { key: "sortOrder", label: "Порядок", type: "number" }, { key: "active", label: "Активна", type: "checkbox" }]} empty={{ title: "", description: "", image: "", sortOrder: 0, active: true }} endpoint="promotions" request={request} onRefresh={loadAll} />}
    {!loading && tab === "settings" && <section className="admin-section"><div className="section-title"><h2>Общие настройки</h2></div><form className="settings-form" onSubmit={saveSettings}><label>Юридическое название<input value={settings.legalName} onChange={(event) => setSettings({ ...settings, legalName: event.target.value })} /></label><label>Подпись контроля качества<input value={settings.qualityControl} onChange={(event) => setSettings({ ...settings, qualityControl: event.target.value })} /></label><label>Ссылка Telegram<input value={settings.telegram} onChange={(event) => setSettings({ ...settings, telegram: event.target.value })} /></label><button className="admin-primary">Сохранить настройки</button></form></section>}
  </main></div>;
}
