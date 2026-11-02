"use client";

import { useAdminLanguage } from "./i18n";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Category, Product } from "../types";
import type { ProductDetails } from "../productDetails";
import AdminDialog from "./AdminDialog";
import { useAdminAccess } from "./AdminAccess";
import { usePagedAdminList, Pagination } from "./usePagedAdminList";
import { Badge, Button, PageHeading, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui";

type Props = {
  products: Product[];
  categories: Category[];
  request: <T = unknown>(path: string, options?: RequestInit) => Promise<T>;
  onRefresh: () => Promise<void>;
  refreshKey?: number;
};

type ProductDraft = {
  id?: number;
  name: string;
  categoryId: string;
  price: string;
  naktaCoins: string;
  sortOrder: string;
  image: string;
  active: boolean;
  ingredients: string;
  serving: string;
  weightUnit: string;
  weight: string;
  calories: string;
  protein: string;
  fat: string;
  carbohydrates: string;
};

type LocalCatalog = {
  source: Product[];
  saved: Map<number, Product>;
  deleted: Set<number>;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:4000/api");
const MAX_DATABASE_INTEGER = 2_147_483_647;

const errorMessage = (reason: unknown, fallback: string) => reason instanceof Error ? reason.message : fallback;

function productDraft(product: Product): ProductDraft {
  return {
    id: product.id,
    name: product.name,
    categoryId: String(product.categoryId),
    price: String(product.price),
    naktaCoins: String(product.naktaCoins || 0),
    sortOrder: String(product.sortOrder),
    image: product.image,
    active: product.active,
    ingredients: product.ingredients || "",
    serving: product.serving || "",
    weightUnit: product.weightUnit || "г",
    weight: product.weight == null ? "" : String(product.weight),
    calories: product.calories == null ? "" : String(product.calories),
    protein: product.protein == null ? "" : String(product.protein),
    fat: product.fat == null ? "" : String(product.fat),
    carbohydrates: product.carbohydrates == null ? "" : String(product.carbohydrates),
  };
}

function imageUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_URL.replace(/\/api\/?$/, "")}${value.startsWith("/") ? "" : "/"}${value}`;
}

function validImageUrl(value: string) {
  if (!value) return true;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function ProductImage({ src, className, preview = false }: { src: string; className: string; preview?: boolean }) {
  const { t } = useAdminLanguage();

  const [failedSource, setFailedSource] = useState<string | null>(null);
  const available = Boolean(src) && failedSource !== src;
  return (
    <div className={className}>
      {available ? <img src={src} alt={preview ? t("Изображение товара") : ""} loading={preview ? "eager" : "lazy"} onError={() => setFailedSource(src)} /> : <span>{src ? t("Фото недоступно") : t("Нет фото")}</span>}
    </div>
  );
}

export default function ProductsSection({ products: refreshSignal, categories, request, onRefresh, refreshKey = 0 }: Props) {
  const { t, formatNumber } = useAdminLanguage();
  const money = (value: number) => `${formatNumber(value)} С`;

  const { can } = useAdminAccess();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const query = new URLSearchParams({ search, visibility: statusFilter, ...(categoryFilter === "all" ? {} : { categoryId: categoryFilter }) }).toString();
  const list = usePagedAdminList<Product>(request, "products", query, refreshSignal, 24, refreshKey);
  const products = list.items;
  const [editing, setEditing] = useState<ProductDraft | null>(null);
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryMatches, setCategoryMatches] = useState<Array<Pick<Category, "id" | "name"> & { active?: boolean }>>([]);
  const [categoryLookupError, setCategoryLookupError] = useState("");
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshFailure, setRefreshFailure] = useState<{ message: string; source: Product[] } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [localCatalog, setLocalCatalog] = useState<LocalCatalog>(() => ({ source: products, saved: new Map(), deleted: new Set() }));
  const editorGeneration = useRef(0);
  const uploadController = useRef<AbortController | null>(null);
  const mutationBusy = useRef(false);
  const refreshBusy = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      editorGeneration.current += 1;
      uploadController.current?.abort();
    };
  }, []);

  // A fresh server list acknowledges local saves. Once acknowledged, subsequent
  // remote edits use server data again instead of a retained local override.
  if (localCatalog.source !== products) {
    setLocalCatalog({ ...localCatalog, source: products, saved: new Map() });
  }

  const categoryChoices = useMemo(() => [...new Map((categorySearch.trim() ? categoryMatches : [...categories, ...categoryMatches]).map((category) => [category.id, category])).values()], [categories, categoryMatches, categorySearch]);
  const categoriesById = useMemo(() => new Map(categoryChoices.map((category) => [category.id, category])), [categoryChoices]);
  const editingKey = editing ? String(editing.id || "new") : null;
  const editingCategoryId = editing?.categoryId || "";
  useEffect(() => {
    if (!editingKey) return;
    let stopped = false;
    const timer = window.setTimeout(() => {
      void request<{ categories: Array<Pick<Category, "id" | "name"> & { active?: boolean }> }>(`products/options?${new URLSearchParams({ search: categorySearch, selectedId: editingCategoryId })}`).then((result) => {
        if (!stopped) { setCategoryMatches((current) => [...new Map([...current.filter((item) => item.id === Number(editingCategoryId)), ...result.categories].map((item) => [item.id, item])).values()]); setCategoryLookupError(""); }
      }).catch(() => { if (!stopped) setCategoryLookupError("Не удалось обновить категории. Доступны ранее загруженные варианты."); });
    }, 200);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [editingKey, editingCategoryId, categorySearch, request]);
  const currentProducts = useMemo(() => {
    const merged = new Map(products.map((product) => [product.id, product]));
    for (const [id, product] of localCatalog.saved) merged.set(id, product);
    return [...merged.values()].filter((product) => !localCatalog.deleted.has(product.id))
      .sort((left, right) => left.categoryId - right.categoryId || left.sortOrder - right.sortOrder || left.id - right.id);
  }, [products, localCatalog.saved, localCatalog.deleted]);
  const visibleProducts = currentProducts;
  const hasFilters = Boolean(search || categoryFilter !== "all" || statusFilter !== "all");
  const hasMissingCategories = currentProducts.some((product) => !categoriesById.has(product.categoryId));
  const selectedCategory = editing ? categoriesById.get(Number(editing.categoryId)) : undefined;
  const hasUnconfirmedChanges = localCatalog.saved.size > 0 || products.some((product) => localCatalog.deleted.has(product.id));
  const refreshError = refreshFailure && (refreshFailure.source === products || hasUnconfirmedChanges) ? refreshFailure.message : "";

  const resetFilters = () => { setSearch(""); setCategoryFilter("all"); setStatusFilter("all"); list.setPage(0); };

  const openEditor = (product?: Product) => {
    if (!can(product ? "products.edit" : "products.create")) return;
    if (mutationBusy.current) return;
    editorGeneration.current += 1;
    uploadController.current?.abort();
    uploadController.current = null;
    setUploading(false);
    setFormError("");
    setCategorySearch(""); setCategoryLookupError("");
    if (product) {
      const details = product as Product & { categoryName?: string; categoryActive?: boolean };
      if (details.categoryName) setCategoryMatches([{ id: product.categoryId, name: details.categoryName, active: details.categoryActive ?? true }]);
    }
    setEditing(product ? productDraft(product) : {
      name: "",
      categoryId: String(categoryChoices.find((category) => category.active !== false)?.id || categoryChoices[0]?.id || ""),
      price: "",
      naktaCoins: "0",
      sortOrder: "0",
      image: "",
      active: true,
      ingredients: "", serving: "", weightUnit: "г", weight: "", calories: "", protein: "", fat: "", carbohydrates: "",
    });
  };

  const closeEditor = () => {
    if (mutationBusy.current) return;
    editorGeneration.current += 1;
    uploadController.current?.abort();
    uploadController.current = null;
    setUploading(false);
    setEditing(null);
    setFormError("");
  };

  const refreshAfterMutation = async () => {
    try {
      await Promise.all([onRefresh(), list.reload()]);
    } catch (reason) {
      if (mounted.current) setRefreshFailure({ message: `Изменение сохранено, но список не обновился. ${errorMessage(reason, "Попробуйте обновить страницу.")}`, source: products });
    }
  };

  const retryRefresh = async () => {
    if (refreshBusy.current || mutationBusy.current) return;
    refreshBusy.current = true;
    setRefreshing(true);
    try {
      await onRefresh();
      if (mounted.current) setRefreshFailure(null);
    } catch (reason) {
      if (mounted.current) setRefreshFailure({ message: errorMessage(reason, "Не удалось обновить список. Попробуйте ещё раз."), source: products });
    } finally {
      refreshBusy.current = false;
      if (mounted.current) setRefreshing(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || mutationBusy.current || !can(editing.id ? "products.edit" : "products.create")) return;
    setFormError("");
    if (uploadController.current) { setFormError("Дождитесь завершения загрузки фото."); return; }
    const name = editing.name.trim();
    const categoryId = Number(editing.categoryId);
    const price = Number(editing.price);
    const naktaCoins = Number(editing.naktaCoins);
    const sortOrder = Number(editing.sortOrder);
    const image = editing.image.trim();
    if (!name) { setFormError("Укажите название товара."); return; }
    if (!categoriesById.has(categoryId)) { setFormError("Выберите существующую категорию товара."); return; }
    if (!editing.price.trim() || !Number.isInteger(price) || price < 0 || price > MAX_DATABASE_INTEGER) { setFormError("Цена должна быть целым неотрицательным числом."); return; }
    if (!editing.naktaCoins.trim() || !Number.isInteger(naktaCoins) || naktaCoins < 0 || naktaCoins > 1_000_000) { setFormError("Награда должна быть целым числом от 0 до 1 000 000."); return; }
    if (!editing.sortOrder.trim() || !Number.isInteger(sortOrder) || Math.abs(sortOrder) > MAX_DATABASE_INTEGER) { setFormError("Порядок должен быть целым числом."); return; }
    if (!validImageUrl(image)) { setFormError("Укажите ссылку на фото с http:// или https://, либо путь, начинающийся с /."); return; }
    const details: ProductDetails = { ingredients: editing.ingredients.trim(), serving: editing.serving.trim(), weightUnit: editing.weightUnit, weight: null, calories: null, protein: null, fat: null, carbohydrates: null };
    for (const key of ["weight", "calories", "protein", "fat", "carbohydrates"] as const) {
      if (!editing[key].trim()) continue;
      const value = Number(editing[key]);
      if (!Number.isFinite(value) || value < 0 || value > 1_000_000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) { setFormError("Вес и пищевая ценность должны быть числами от 0 до 1 000 000, до двух знаков после запятой"); return; }
      details[key] = value;
    }
    const generation = editorGeneration.current;
    mutationBusy.current = true;
    setSaving(true);
    setNotice("");
    setRefreshFailure(null);
    try {
      const payload = { ...editing, ...details, name, categoryId, price, naktaCoins, sortOrder, image };
      const returnedProduct = await request<Product>(editing.id ? `products/${editing.id}` : "products", {
        method: editing.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (mounted.current && generation === editorGeneration.current) {
        const savedProduct = returnedProduct?.id ? returnedProduct : editing.id ? { ...payload, id: editing.id } : null;
        if (savedProduct) setLocalCatalog((current) => {
          if (current.deleted.has(savedProduct.id)) return current;
          const saved = new Map(current.saved);
          saved.set(savedProduct.id, savedProduct);
          return { ...current, saved };
        });
        editorGeneration.current += 1;
        setEditing(null);
        setNotice(editing.id ? `Товар «${name}» сохранён.` : `Товар «${name}» добавлен.`);
      }
      await refreshAfterMutation();
    } catch (reason) {
      if (mounted.current && generation === editorGeneration.current) setFormError(errorMessage(reason, "Не удалось сохранить товар."));
    } finally {
      mutationBusy.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const uploadImage = async (file: File) => {
    if (!editing || mutationBusy.current) return;
    uploadController.current?.abort();
    uploadController.current = null;
    setUploading(false);
    setFormError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setFormError("Выберите фото в формате PNG, JPG или WebP."); return; }
    if (file.size > 5 * 1024 * 1024) { setFormError("Фото должно быть не больше 5 МБ."); return; }
    const generation = editorGeneration.current;
    const controller = new AbortController();
    uploadController.current = controller;
    setUploading(true);
    const isCurrent = () => mounted.current && generation === editorGeneration.current && uploadController.current === controller;
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await request<{ url: string }>("upload", { method: "POST", body, signal: controller.signal });
      if (!isCurrent()) return;
      if (!result?.url || typeof result.url !== "string") throw new Error("Сервер не вернул ссылку на загруженное фото.");
      const uploadedUrl = imageUrl(result.url);
      if (!validImageUrl(uploadedUrl)) throw new Error("Сервер вернул некорректную ссылку на фото.");
      setEditing((current) => current ? { ...current, image: uploadedUrl } : current);
    } catch (reason) {
      if (!controller.signal.aborted && isCurrent()) setFormError(errorMessage(reason, "Не удалось загрузить фото."));
    } finally {
      if (isCurrent()) {
        uploadController.current = null;
        setUploading(false);
      }
    }
  };

  const remove = async (event: FormEvent) => {
    event.preventDefault();
    if (!deleting || mutationBusy.current || !can("products.delete")) return;
    mutationBusy.current = true;
    setRemoving(true);
    setDeleteError("");
    setNotice("");
    setRefreshFailure(null);
    try {
      await request(`products/${deleting.id}`, { method: "DELETE" });
      if (mounted.current) {
        setLocalCatalog((current) => {
          const saved = new Map(current.saved);
          saved.delete(deleting.id);
          return { ...current, saved, deleted: new Set(current.deleted).add(deleting.id) };
        });
        setDeleting(null);
        setNotice(`Товар «${deleting.name}» архивирован.`);
      }
      await refreshAfterMutation();
    } catch (reason) {
      if (mounted.current) setDeleteError(errorMessage(reason, "Не удалось удалить товар."));
    } finally {
      mutationBusy.current = false;
      if (mounted.current) setRemoving(false);
    }
  };

  return (
    <section className="admin-section products-admin-section">
      <PageHeading title={t("Товары")} description={t("Меню, фотографии, цены и доступность.")}>
        {can("products.create") && <Button variant="default" type="button" disabled={saving || removing} onClick={() => openEditor()}>{t("+ Добавить товар")}</Button>}
      </PageHeading>
      {notice && <div className="admin-success banner" role="status">{t(notice)}</div>}
      {refreshError && <div className="admin-error banner" role="alert"><span>{t(refreshError)}</span><button type="button" disabled={refreshing || saving || removing} onClick={() => void retryRefresh()}>{refreshing ? t("Обновляем…") : t("Обновить список")}</button></div>}
      <div className="admin-products-toolbar">
        <label className="admin-filter-field">{t("Поиск")}<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); list.setPage(0); }} placeholder={t("Найти товар…")} /></label>
        <label className="admin-filter-field">{t("Категория")}<select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); list.setPage(0); }}><option value="all">{t("Все категории")}</option>{categories.map((category) => <option key={category.id} value={String(category.id)}>{category.name}</option>)}{hasMissingCategories && <option value="missing">{t("Без категории")}</option>}</select></label>
        <label className="admin-filter-field">{t("Доступность")}<select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); list.setPage(0); }}><option value="all">{t("Все товары")}</option><option value="visible">{t("Показываются")}</option><option value="hidden">{t("Скрыты")}</option></select></label>
      </div>
      <div className="admin-list-summary"><span role="status">{list.loading ? t("Обновляем список…") : t("Найдено товаров: {v0}", { v0: list.total })}</span>{hasFilters && <button type="button" onClick={resetFilters}>{t("Сбросить фильтры")}</button>}</div>
      {t(list.error) && <div className="admin-error banner" role="alert">{t(list.error)}<button type="button" onClick={() => void list.reload()}>{t("Повторить")}</button></div>}
      {visibleProducts.length ? <Table className="admin-catalog-table"><TableHeader><TableRow><TableHead>{t("Товар")}</TableHead><TableHead>{t("Категория")}</TableHead><TableHead>{t("Цена")}</TableHead><TableHead>{t("Доступность")}</TableHead><TableHead><span className="sr-only">{t("Действия")}</span></TableHead></TableRow></TableHeader><TableBody>
        {visibleProducts.map((product) => {
          const category = categoriesById.get(product.categoryId);
          const details = product as Product & { categoryName?: string; categoryActive?: boolean };
          const visible = product.active && (details.categoryActive ?? category?.active ?? false);
          return <TableRow key={product.id}>
            <TableCell><div className="admin-product-cell"><ProductImage src={product.image} className="admin-product-image" /><div><strong>{product.name}</strong><small>{formatNumber(Number(product.naktaCoins || 0))} Bonus DAANA Coin</small></div></div></TableCell>
            <TableCell>{details.categoryName || category?.name || t("Категория недоступна")}</TableCell>
            <TableCell><strong>{money(product.price)}</strong></TableCell>
            <TableCell><Badge variant={visible ? "success" : "secondary"}>{visible ? t("На сайте") : t("Скрыт")}</Badge></TableCell>
            <TableCell><div className="admin-row-actions">{can("products.edit") && <Button type="button" disabled={saving || removing} onClick={() => openEditor(product)} aria-label={t("Редактировать товар «{v0}»", { v0: product.name })}>{t("Редактировать")}</Button>}{can("products.delete") && <Button variant="ghost" type="button" className="danger" disabled={saving || removing} onClick={() => { if (!mutationBusy.current) { setDeleting(product); setDeleteError(""); } }} aria-label={t("Архивировать товар «{v0}»", { v0: product.name })}>{t("Архивировать")}</Button>}</div></TableCell>
          </TableRow>;
        })}
      </TableBody></Table> : !list.loading && !t(list.error) ? <div className="admin-empty-state"><h3>{hasFilters ? t("Товары не найдены") : t("Товаров пока нет")}</h3><p>{hasFilters ? t("Измените название, категорию или доступность в фильтрах.") : categories.length ? t("Добавьте первый товар, чтобы он появился в каталоге.") : t("Добавьте категорию, затем создайте первый товар.")}</p>{hasFilters && <button type="button" onClick={resetFilters}>{t("Показать все товары")}</button>}</div> : null}
      <Pagination page={list.page} total={list.total} limit={list.limit} loading={list.loading} onPage={list.setPage} />

      {editing && <AdminDialog title={editing.id ? t("Редактирование товара") : t("Новый товар")} description={t("Заполните данные товара и сохраните изменения.")} onClose={closeEditor} busy={saving} className="product-editor-dialog">
        <form className="editor-form" onSubmit={save}>
          {formError && <div className="admin-error banner" role="alert">{t(formError)}</div>}
          <fieldset className="admin-form-fieldset" disabled={saving}>
            <div className="editor-grid">
              <label className="wide-field">{t("Название товара")}<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} maxLength={200} required autoComplete="off" placeholder={t("Например, Филадельфия")} /></label>
              <div className="wide-field admin-category-chooser"><label>{t("Найти категорию")}<input type="search" value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} placeholder={t("Введите название категории…")} /></label><label>{t("Категория")}<select required value={selectedCategory ? editing.categoryId : ""} onChange={(event) => setEditing({ ...editing, categoryId: event.target.value })}><option value="" disabled>{t("Выберите категорию")}</option>{categoryChoices.map((category) => <option value={String(category.id)} key={category.id}>{category.name}{category.active === false ? t(" (скрыта)") : ""}</option>)}</select>{categoryLookupError && <small>{t(categoryLookupError)}</small>}{editing.active && selectedCategory?.active === false && <small>{t("Категория скрыта. Товар появится на сайте после её включения.")}</small>}</label></div>
              <label>{t("Цена, С")}<input type="number" inputMode="numeric" min="0" max={MAX_DATABASE_INTEGER} step="1" value={editing.price} onChange={(event) => setEditing({ ...editing, price: event.target.value })} required placeholder="0" /></label>
              <label className="check-field"><input type="checkbox" checked={editing.active} onChange={(event) => setEditing({ ...editing, active: event.target.checked })} />{t("Показывать товар на сайте")}</label>
              <label className="wide-field">{t("Состав")}<textarea rows={3} maxLength={4000} value={editing.ingredients} onChange={(event) => setEditing({ ...editing, ingredients: event.target.value })} placeholder={t("Например: лосось, творожный сыр")} /></label>
              <label className="wide-field">{t("Порция")}<input maxLength={120} value={editing.serving} onChange={(event) => setEditing({ ...editing, serving: event.target.value })} placeholder={t("Например: 1 шт. или 8 шт.")} /></label>
            </div>
            <div className="admin-image-editor">
              <ProductImage src={editing.image.trim()} className="admin-image-preview" preview />
              <div>
                <label className="admin-upload-field">{t("Фото товара")}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadImage(file); }} /><small role="status">{uploading ? t("Загружаем фото…") : t("PNG, JPG или WebP, до 5 МБ.")}</small></label>
                <label>{t("Или ссылка на фото")}<input value={editing.image} disabled={uploading} onChange={(event) => setEditing({ ...editing, image: event.target.value })} placeholder={t("https://… или /assets/…")} autoComplete="off" /></label>
                {editing.image && <button type="button" disabled={uploading} onClick={() => setEditing({ ...editing, image: "" })}>{t("Убрать фото")}</button>}
              </div>
            </div>
            <details className="admin-additional-fields"><summary>{t("Вес и пищевая ценность")}</summary><p className="admin-muted">{t("Значения на одну порцию. Пустое поле — данные не указаны.")}</p><div className="editor-grid">
              <label>{t("Единица измерения")}<select value={editing.weightUnit} onChange={(event) => setEditing({ ...editing, weightUnit: event.target.value })}><option value="г">{t("г")}</option><option value="мл">{t("мл")}</option><option value="шт.">{t("шт.")}</option></select></label>
              {([["weight", "Вес или объём"], ["calories", "Калорийность, ккал"], ["protein", "Белки, г"], ["fat", "Жиры, г"], ["carbohydrates", "Углеводы, г"]] as const).map(([key, label]) => <label key={key}>{t(label)}<input type="number" inputMode="decimal" min="0" max="1000000" step="0.01" value={editing[key]} onChange={(event) => setEditing({ ...editing, [key]: event.target.value })} placeholder="—" /></label>)}
            </div></details>
            <details className="admin-additional-fields"><summary>{t("Дополнительно")}</summary><div className="editor-grid">
              <label>{t("Награда Bonus DAANA Coin")}<input type="number" inputMode="numeric" min="0" max="1000000" step="1" value={editing.naktaCoins} onChange={(event) => setEditing({ ...editing, naktaCoins: event.target.value })} required /><small>{t("Начисляется после выдачи заказа.")}</small></label>
              <label>{t("Порядок в категории")}<input type="number" inputMode="numeric" min={-MAX_DATABASE_INTEGER} max={MAX_DATABASE_INTEGER} step="1" value={editing.sortOrder} onChange={(event) => setEditing({ ...editing, sortOrder: event.target.value })} required /><small>{t("Меньшее число — выше в списке.")}</small></label>
            </div></details>
          </fieldset>
          <div className="editor-actions"><button type="button" data-dialog-dismiss disabled={saving} onClick={closeEditor}>{t("Отмена")}</button><button type="submit" className="admin-primary" disabled={saving || uploading || !categoryChoices.length}>{saving ? t("Сохраняем…") : uploading ? t("Загружаем фото…") : t("Сохранить товар")}</button></div>
        </form>
      </AdminDialog>}
      {deleting && <AdminDialog title={t("Архивировать товар?")} description={t("Товар исчезнет с сайта и из каталога управления. Состав ранее оформленных заказов сохранится.")} onClose={() => { if (!mutationBusy.current) setDeleting(null); }} busy={removing}>
        <form onSubmit={remove}>
          <div className="admin-delete-preview"><ProductImage src={deleting.image} className="admin-product-image" /><div><strong>{deleting.name}</strong><span>{money(deleting.price)}</span></div></div>
          {deleteError && <div className="admin-error banner" role="alert">{t(deleteError)}</div>}
          <div className="editor-actions"><button type="button" disabled={removing} onClick={() => { if (!mutationBusy.current) setDeleting(null); }}>{t("Отмена")}</button><button type="submit" className="danger-solid" disabled={removing}>{removing ? t("Архивируем…") : t("Архивировать товар")}</button></div>
        </form>
      </AdminDialog>}
    </section>
  );
}
