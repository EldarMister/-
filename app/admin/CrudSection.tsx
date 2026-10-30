"use client";

import { useAdminLanguage } from "./i18n";

import { type FormEvent, useId, useRef, useState } from "react";
import AdminDialog from "./AdminDialog";
import { useAdminAccess } from "./AdminAccess";
import { usePagedAdminList, Pagination, type AdminListRequest } from "./usePagedAdminList";
import { Badge, Button, PageHeading, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui";

type Row = Record<string, unknown>;
type Field = { key: string; label: string; type?: "text" | "number" | "textarea" | "checkbox" };
type Props = {
  title: string; rows: Row[]; fields: Field[]; empty: Row; endpoint: string;
  request: AdminListRequest;
  onRefresh: () => Promise<void>;
  refreshKey?: number;
};

function recordName(row: Row) { return String(row.name || row.title || "Без названия"); }
function errorMessage(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback; }

export default function CrudSection({ title, rows: refreshSignal, fields: suppliedFields, empty, endpoint, request, onRefresh, refreshKey = 0 }: Props) {
  const { t } = useAdminLanguage();

  const { can } = useAdminAccess();
  const fields = suppliedFields.filter(({key}) => !["id", "slug", "createdAt", "updatedAt"].includes(key));
  const [editing, setEditing] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [listError, setListError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const list = usePagedAdminList<Row>(request, endpoint, new URLSearchParams({ search, ...(status === "all" ? {} : { active: String(status === "active") }) }).toString(), refreshSignal, 24, refreshKey);
  const rows = list.items;
  const actionPending = useRef(false);
  const editorId = useId();
  const hasStatus = fields.some((field) => field.key === "active");
  const detailFields = fields.filter((field) => ["sortOrder", "description"].includes(field.key));
  const visibleRows = rows;

  const refreshList = async () => {
    try { await Promise.all([onRefresh(), list.reload()]); }
    catch (reason) { setListError(errorMessage(reason, "Изменение сохранено, но список не удалось обновить. Нажмите «Обновить».")); }
  };

  const beginEditing = (row: Row) => {
    if (actionPending.current || !can(`${endpoint}.${row.id ? "edit" : "create"}`)) return;
    setError(""); setListError(""); setNotice("");
    setEditing({ ...row });
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || actionPending.current || !can(`${endpoint}.${editing.id ? "edit" : "create"}`)) return;
    const payload = { ...editing };
    delete payload.slug;
    for (const field of fields) {
      if (field.type === "checkbox") continue;
      const value = String(editing[field.key] ?? "").trim();
      if (["name", "title", "slug"].includes(field.key) && !value) {
        setError(`Заполните поле «${field.key === "slug" ? "Код категории" : field.label}».`);
        return;
      }
      if (field.type === "number") {
        const number = Number(value);
        if (!value || !Number.isSafeInteger(number) || number < 0) {
          setError(`«${field.label}» должно быть целым числом от 0.`);
          return;
        }
        payload[field.key] = number;
      } else { payload[field.key] = value; }
    }
    if (editing.id && !rows.some((row) => row.id === editing.id)) {
      setError("Эта запись уже удалена. Закройте окно и обновите список.");
      return;
    }
    actionPending.current = true;
    setSaving(true); setError(""); setListError("");
    try {
      await request(editing.id ? `${endpoint}/${editing.id}` : endpoint, {
        method: editing.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      setEditing(null);
      setNotice(editing.id ? "Изменения сохранены." : "Запись добавлена.");
      await refreshList();
    } catch (reason) { setError(errorMessage(reason, "Не удалось сохранить запись.")); }
    finally { actionPending.current = false; setSaving(false); }
  };

  const remove = async (event: FormEvent) => {
    event.preventDefault();
    if (!deleting || actionPending.current || !can(`${endpoint}.delete`)) return;
    actionPending.current = true;
    setRemoving(true); setDeleteError(""); setListError("");
    try {
      await request(`${endpoint}/${deleting.id}`, { method: "DELETE" });
      if (editing?.id === deleting.id) setEditing(null);
      setDeleting(null);
      setNotice(endpoint === "categories" ? `«${recordName(deleting)}» архивировано.` : `«${recordName(deleting)}» удалено.`);
      await refreshList();
    } catch (reason) { setDeleteError(errorMessage(reason, "Не удалось удалить запись.")); }
    finally { actionPending.current = false; setRemoving(false); }
  };

  return <section className="admin-section">
    <PageHeading title={t(title)} description={t("Порядок отображения и доступность на сайте.")}>{can(`${endpoint}.create`) && <Button variant="default" type="button" disabled={saving || removing} onClick={() => beginEditing(empty)}>{t("+ Добавить")}</Button>}</PageHeading>
    {listError ? <div className="admin-error banner" role="alert">{t(listError)}</div> : null}
    {notice ? <div className="admin-success banner" role="status">{t(notice)}</div> : null}
    {t(list.error) && <div className="admin-error banner" role="alert">{t(list.error)}<button type="button" onClick={() => void list.reload()}>{t("Повторить")}</button></div>}
    <div className="admin-crud-toolbar">
      <label className="admin-search-field"><span className="sr-only">{t("Поиск по записям")}</span><input type="search" placeholder={t("Поиск по названию…")} value={search} onChange={(event) => { setSearch(event.target.value); list.setPage(0); }} /></label>
      {hasStatus ? <label className="admin-filter-field"><span className="sr-only">{t("Видимость на сайте")}</span><select value={status} onChange={(event) => { setStatus(event.target.value); list.setPage(0); }}><option value="all">{t("Все записи")}</option><option value="active">{t("На сайте")}</option><option value="hidden">{t("Скрытые")}</option></select></label> : null}
      <span className="admin-list-count" role="status">{list.loading ? t("Обновляем…") : t("Всего: {v0}", { v0: list.total })}</span>
    </div>
    {visibleRows.length ? <Table><TableHeader><TableRow><TableHead>{t("Название")}</TableHead>{detailFields.map((field) => <TableHead key={field.key}>{t(field.label)}</TableHead>)}{hasStatus && <TableHead>{t("Видимость")}</TableHead>}<TableHead><span className="sr-only">{t("Действия")}</span></TableHead></TableRow></TableHeader><TableBody>{visibleRows.map((row) => <TableRow key={String(row.id)}>
      <TableCell><div className="admin-product-cell">{row.image ? <img className="admin-promo-thumb" src={String(row.image)} alt="" /> : null}<strong>{recordName(row)}</strong></div></TableCell>
      {detailFields.map((field) => <TableCell key={field.key}><span className={field.type === "textarea" ? "admin-cell-description" : undefined}>{String(row[field.key] ?? "") || "—"}</span></TableCell>)}
      {hasStatus && <TableCell><Badge variant={row.active ? "success" : "secondary"}>{row.active ? t("На сайте") : t("Скрыто")}</Badge></TableCell>}
      <TableCell><div className="admin-row-actions">{can(`${endpoint}.edit`) && <Button type="button" disabled={saving || removing} onClick={() => beginEditing(row)} aria-label={t("Редактировать «{v0}»", { v0: recordName(row) })}>{t("Редактировать")}</Button>}{can(`${endpoint}.delete`) && <Button variant="ghost" type="button" className="danger" disabled={saving || removing} onClick={() => { setDeleting(row); setDeleteError(""); setNotice(""); }} aria-label={`${endpoint === "categories" ? t("Архивировать") : t("Удалить")} «${recordName(row)}»`}>{endpoint === "categories" ? t("Архивировать") : t("Удалить")}</Button>}</div></TableCell>
    </TableRow>)}</TableBody></Table> : !list.loading && !t(list.error) ? <div className="admin-empty-state"><h3>{search || status !== "all" ? t("Ничего не найдено") : t("Записей пока нет")}</h3><p>{search || status !== "all" ? t("Измените поиск или фильтр видимости.") : t("Нажмите «Добавить», чтобы создать первую запись.")}</p></div> : null}
    <Pagination page={list.page} total={list.total} limit={list.limit} loading={list.loading} onPage={list.setPage} />

    {editing ? <AdminDialog title={editing.id ? t("Изменить «{v0}»", { v0: recordName(editing) }) : t("Новая запись")} description={t("Заполните поля и сохраните изменения.")} onClose={() => { if (!saving) setEditing(null); }} busy={saving} className="admin-editor-dialog">
      <form className="editor-form" onSubmit={save} aria-busy={saving}>
        {error ? <div className="admin-error" role="alert">{t(error)}</div> : null}
        <fieldset disabled={saving} className="admin-editor-fieldset"><div className="editor-grid">{fields.map((field) => {
          const label = field.key === "slug" ? t("Код категории") : field.key === "image" ? t("Ссылка на изображение") : t(field.label);
          const hintId = `${editorId}-${field.key}-hint`;
          return <label className={field.type === "checkbox" ? "check-field" : field.type === "textarea" || field.key === "image" ? "wide-field" : undefined} key={field.key}>
            {field.type === "checkbox" ? <><input type="checkbox" checked={Boolean(editing[field.key])} onChange={(event) => setEditing({ ...editing, [field.key]: event.target.checked })} />{field.key === "active" ? t("Показывать на сайте") : label}</> : <>{t(label)}{field.type === "textarea" ? <textarea rows={4} value={String(editing[field.key] ?? "")} onChange={(event) => setEditing({ ...editing, [field.key]: event.target.value })} /> : <input type={field.type || "text"} inputMode={field.type === "number" ? "numeric" : undefined} min={field.type === "number" ? 0 : undefined} step={field.type === "number" ? 1 : undefined} value={String(editing[field.key] ?? "")} onChange={(event) => setEditing({ ...editing, [field.key]: event.target.value })} required={["name", "title", "slug"].includes(field.key) || field.type === "number"} aria-describedby={field.key === "slug" || field.key === "sortOrder" ? hintId : undefined} />}{field.key === "slug" ? <small id={hintId}>{t("Уникальный код для категории, например rolls.")}</small> : field.key === "sortOrder" ? <small id={hintId}>{t("Меньшее число показывается раньше.")}</small> : null}</>}
          </label>;
        })}</div></fieldset>
        <div className="editor-actions"><button type="button" data-dialog-dismiss disabled={saving} onClick={() => setEditing(null)}>{t("Отмена")}</button><button type="submit" className="admin-primary" disabled={saving}>{saving ? t("Сохранение…") : t("Сохранить")}</button></div>
      </form>
    </AdminDialog> : null}
    {deleting ? <AdminDialog title={`${endpoint === "categories" ? t("Архивировать") : t("Удалить")} «${recordName(deleting)}»?`} description={endpoint === "categories" ? t("Категория исчезнет из меню. Её товары останутся в админке для переноса в другую категорию. Ранее оформленные заказы сохранятся.") : t("Запись исчезнет с сайта. Это действие нельзя отменить.")} onClose={() => { if (!removing) setDeleting(null); }} busy={removing} className="admin-confirm-dialog">
      <form onSubmit={remove} aria-busy={removing}>
        {deleteError ? <div className="admin-error" role="alert">{t(deleteError)}</div> : null}
        <div className="editor-actions"><button type="button" disabled={removing} onClick={() => setDeleting(null)}>{t("Отмена")}</button><button type="submit" className="danger-solid" disabled={removing}>{removing ? t("Сохраняем…") : endpoint === "categories" ? t("Архивировать") : t("Удалить")}</button></div>
      </form>
    </AdminDialog> : null}
  </section>;
}
