"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

type Row = Record<string, unknown>;
type Field = { key: string; label: string; type?: "text" | "number" | "textarea" | "checkbox" };
type Props = {
  title: string; rows: Row[]; fields: Field[]; empty: Row; endpoint: string;
  request: (path: string, options?: RequestInit) => Promise<unknown>;
  onRefresh: () => Promise<void>;
};

export default function CrudSection({ title, rows, fields, empty, endpoint, request, onRefresh }: Props) {
  const [editing, setEditing] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (deleting) dialogRef.current?.showModal(); }, [deleting]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || saving) return;
    setSaving(true); setError("");
    try {
      await request(editing.id ? `${endpoint}/${editing.id}` : endpoint, {
        method: editing.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing),
      });
      setEditing(null);
      await onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить"); }
    finally { setSaving(false); }
  };
  const remove = async (event: FormEvent) => {
    event.preventDefault();
    if (!deleting || removing) return;
    setRemoving(true); setDeleteError("");
    try {
      await request(`${endpoint}/${deleting.id}`, { method: "DELETE" });
      if (editing?.id === deleting.id) setEditing(null);
      setDeleting(null);
      await onRefresh();
    } catch (reason) { setDeleteError(reason instanceof Error ? reason.message : "Не удалось удалить"); }
    finally { setRemoving(false); }
  };
  return <section className="admin-section">
    <div className="section-title"><h2>{title}</h2><button className="admin-primary" type="button" onClick={() => { setEditing({ ...empty }); setError(""); }}>+ Добавить</button></div>
    {error ? <div className="admin-error banner" role="alert">{error}</div> : null}
    {editing ? <form className="editor-form" onSubmit={save}>
      <h3>{editing.id ? "Редактирование" : "Новая запись"}</h3>
      <div className="editor-grid">{fields.map((field) => <label className={field.type === "checkbox" ? "check-field" : undefined} key={field.key}>
        {field.type === "checkbox" ? <><input type="checkbox" checked={Boolean(editing[field.key])} onChange={(event) => setEditing({ ...editing, [field.key]: event.target.checked })} />{field.label}</> : <>{field.label}{field.type === "textarea" ? <textarea value={String(editing[field.key] ?? "")} onChange={(event) => setEditing({ ...editing, [field.key]: event.target.value })} /> : <input type={field.type || "text"} value={String(editing[field.key] ?? "")} onChange={(event) => setEditing({ ...editing, [field.key]: field.type === "number" ? Number(event.target.value) : event.target.value })} required={field.key === "name" || field.key === "title"} />}</>}
      </label>)}</div>
      <div className="editor-actions"><button type="button" onClick={() => setEditing(null)}>Отмена</button><button className="admin-primary" disabled={saving}>{saving ? "Сохранение…" : "Сохранить"}</button></div>
    </form> : null}
    <div className="admin-table-wrap"><table>
      <thead><tr>{fields.slice(0, 4).map((field) => <th key={field.key}>{field.label}</th>)}<th /></tr></thead>
      <tbody>{rows.map((row) => <tr key={String(row.id)}>
        {fields.slice(0, 4).map((field) => <td key={field.key}>{field.type === "checkbox" ? (row[field.key] ? "Да" : "Нет") : String(row[field.key] ?? "")}</td>)}
        <td className="row-actions"><button type="button" onClick={() => { setEditing({ ...row }); setError(""); }}>Изменить</button><button type="button" className="danger" disabled={removing} onClick={() => { setDeleting(row); setDeleteError(""); }}>Удалить</button></td>
      </tr>)}</tbody>
    </table></div>
    {deleting ? <dialog ref={dialogRef} className="admin-action-dialog location-delete-dialog" aria-labelledby="crud-delete-title" aria-describedby="crud-delete-description" onCancel={(event) => { if (removing) event.preventDefault(); else setDeleting(null); }}>
      <header><h2 id="crud-delete-title">Удалить «{String(deleting.name || deleting.title)}»?</h2></header>
      <form onSubmit={remove}>
        <p id="crud-delete-description">{endpoint === "categories" ? "Категория исчезнет из меню. Её товары останутся в админке для переноса в другую категорию. Ранее оформленные заказы сохранятся." : "Запись будет удалена."}</p>
        {deleteError ? <div className="admin-error" role="alert">{deleteError}</div> : null}
        <div><button type="button" disabled={removing} onClick={() => setDeleting(null)}>Отмена</button><button className="danger-solid" disabled={removing}>{removing ? "Удаление…" : "Удалить"}</button></div>
      </form>
    </dialog> : null}
  </section>;
}
