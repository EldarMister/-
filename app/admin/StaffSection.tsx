"use client";

import { useAdminLanguage } from "./i18n";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import AdminDialog from "./AdminDialog";
import { useAdminAccess } from "./AdminAccess";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui";

type Role = "OWNER" | "ADMIN" | "MANAGER";
type Staff = { id: number; name: string; email: string; role: Role; active: boolean; permissionOverrides: Record<string, boolean>; effectivePermissions: string[] };
type Definition = { key: string; section: string; action: string; label: string };
type StaffResponse = { items: Staff[]; permissionDefinitions: Definition[]; roleDefaults: Record<Role, string[]> };
type Request = <T = unknown>(path: string, options?: RequestInit) => Promise<T>;
type Profile = { id?: number; name: string; email: string; password: string; active: boolean; role: Role };
const roleLabels: Record<Role, string> = { OWNER: "Владелец", ADMIN: "Администратор", MANAGER: "Менеджер" };
const sections: Record<string, string> = { dashboard: "Главная", orders: "Заказы", users: "Пользователи", products: "Товары", categories: "Категории", locations: "Точки самовывоза", schedules: "Время работы", promotions: "Акции", loyalty: "Программа наград", settings: "Настройки", staff: "Персонал", analytics: "Аналитика", audit: "Журнал действий" };
const actions: Record<string, string> = { view: "Просмотр", create: "Создание", edit: "Редактирование", delete: "Архивация / удаление", export: "Экспорт", status: "Смена статуса", adjust: "Корректировка наград", access: "Управление доступом" };
const blankProfile: Profile = { name: "", email: "", password: "", role: "MANAGER", active: true };

export default function StaffSection({ request, refreshKey = 0 }: { request: Request; refreshKey?: number }) {
  const { t } = useAdminLanguage();

  const { user, can } = useAdminAccess();
  const owner = user?.role === "OWNER";
  const [data, setData] = useState<StaffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selected, setSelected] = useState<Staff | null>(null);
  const [role, setRole] = useState<Role>("MANAGER");
  const [overrides, setOverrides] = useState<Record<string, boolean | null>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const result = await request<StaffResponse>("staff"); setData(result); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить сотрудников"); }
    finally { setLoading(false); }
  }, [request]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const close = () => { if (busy || (dirty && !window.confirm(t("Закрыть карточку без сохранения изменений?")))) return; setProfile(null); setSelected(null); setDirty(false); };
  const editProfile = (person?: Staff) => {
    setProfile(person ? { id: person.id, name: person.name, email: person.email, password: "", role: person.role, active: person.active } : { ...blankProfile });
    setDirty(false); setError(""); setNotice("");
  };
  const openAccess = (person: Staff) => { setSelected(person); setRole(person.role); setOverrides({ ...person.permissionOverrides }); setDirty(false); setError(""); setNotice(""); };
  const saveProfile = async (event: FormEvent) => {
    event.preventDefault(); if (!profile || busy) return;
    setBusy(true); setError("");
    try {
      const body = profile.id ? { name: profile.name.trim(), email: profile.email.trim(), ...(owner ? { active: profile.active, ...(profile.password ? { password: profile.password } : {}) } : {}) } : { name: profile.name.trim(), email: profile.email.trim(), password: profile.password, role: profile.role };
      await request(profile.id ? `staff/${profile.id}` : "staff", { method: profile.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setProfile(null); setDirty(false); setNotice("Данные сотрудника сохранены"); await load(); window.dispatchEvent(new Event("admin-access-changed"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить сотрудника"); }
    finally { setBusy(false); }
  };
  const saveAccess = async (event: FormEvent) => {
    event.preventDefault(); if (!selected || !owner || busy) return;
    setBusy(true); setError("");
    try {
      await request(`staff/${selected.id}/access`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, permissions: overrides }) });
      setSelected(null); setDirty(false); setNotice("Права сохранены и действуют со следующего запроса сотрудника"); await load(); window.dispatchEvent(new Event("admin-access-changed"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось изменить доступ"); }
    finally { setBusy(false); }
  };
  const visibleActions = ["view", "create", "edit", "delete", "export", "status", "adjust", "access"].filter((action) => data?.permissionDefinitions.some((permission) => permission.action === action));
  const permissionSections = [...new Set(data?.permissionDefinitions.map((definition) => definition.section) || [])];
  const inherited = data?.roleDefaults[role] || [];
  const effective = (key: string) => {
    const granted = (permission: string) => overrides[permission] === true || (overrides[permission] !== false && inherited.includes(permission));
    if (role === "OWNER") return true;
    if (["staff.create", "staff.access"].includes(key)) return false;
    if (key === "loyalty.adjust" && !granted("users.view")) return false;
    return granted(key) && (key.endsWith(".view") || granted(`${key.split(".")[0]}.view`));
  };

  return <div className="admin-staff-workspace">
    {error && <div className="admin-error banner" role="alert">{t(error)}</div>}
    {notice && <div className="admin-success banner" role="status">{t(notice)}</div>}
    <Card><CardHeader><div className="section-title"><div><CardTitle>{t("Команда")}</CardTitle><p>{t("Учётные записи сотрудников и их доступ к рабочим разделам.")}</p></div>{owner && can("staff.create") && <Button onClick={() => editProfile()}>{t("Добавить сотрудника")}</Button>}</div></CardHeader><CardContent>
      {loading ? <p role="status">{t("Загружаем сотрудников…")}</p> : !data?.items.length ? <EmptyState title={t("Сотрудников пока нет")}><p>{t("Добавьте сотрудника и настройте доступ.")}</p></EmptyState> : <div className="admin-table-wrap"><Table><TableHeader><TableRow><TableHead>{t("Сотрудник")}</TableHead><TableHead>{t("Роль")}</TableHead><TableHead>{t("Доступ")}</TableHead><TableHead>{t("Действия")}</TableHead></TableRow></TableHeader><TableBody>{data.items.map((person) => <TableRow key={person.id}><TableCell><strong>{person.name}</strong><small className="staff-contact">{person.email}</small></TableCell><TableCell>{t(roleLabels[person.role])}</TableCell><TableCell><Badge variant={person.active ? "success" : "secondary"}>{person.active ? t("Активен") : t("Заблокирован")}</Badge></TableCell><TableCell><div className="staff-row-actions">{can("staff.edit") && (owner || Number(user?.id) === person.id) && <Button variant="outline" onClick={() => editProfile(person)}>{t("Редактировать")}</Button>}<Button variant="ghost" onClick={() => openAccess(person)}>{owner ? t("Права доступа") : t("Посмотреть права")}</Button></div></TableCell></TableRow>)}</TableBody></Table></div>}
    </CardContent></Card>
    {!owner && <p className="admin-muted">{t("Роли и персональные права изменяет владелец.")}</p>}
    {profile && <AdminDialog title={profile.id ? t("Редактировать сотрудника") : t("Добавить сотрудника")} onClose={close} busy={busy} description={t("Пароль передаётся по защищённому соединению и хранится в виде хеша.")}>
      <form className="editor-form" onSubmit={saveProfile}><fieldset disabled={busy} className="admin-form-fieldset"><div className="editor-grid">
        {error && <div role="alert" className="admin-error wide-field">{t(error)}</div>}
        <label>{t("Имя")}<input required maxLength={120} value={profile.name} onChange={(event) => { setProfile({ ...profile, name: event.target.value }); setDirty(true); }} autoComplete="off" /></label>
        <label>{t("Электронная почта")}<input required type="email" maxLength={254} value={profile.email} onChange={(event) => { setProfile({ ...profile, email: event.target.value }); setDirty(true); }} autoComplete="off" /></label>
        {owner && <label className="wide-field">{profile.id ? t("Новый пароль") : t("Пароль")}<input type="password" required={!profile.id} minLength={12} maxLength={200} value={profile.password} onChange={(event) => { setProfile({ ...profile, password: event.target.value }); setDirty(true); }} autoComplete="new-password" /><small>{profile.id ? t("Оставьте пустым, чтобы сохранить текущий пароль.") : t("Не менее 12 символов.")}</small></label>}
        {!profile.id && owner && <label>{t("Роль")}<select value={profile.role} onChange={(event) => { setProfile({ ...profile, role: event.target.value as Role }); setDirty(true); }}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>}
        {profile.id && owner && <label className="check-field"><input type="checkbox" checked={profile.active} disabled={profile.role === "OWNER" && !owner} onChange={(event) => { if (!event.target.checked && !window.confirm(t("Заблокировать сотрудника? Его сессии и уведомления перестанут работать."))) return; setProfile({ ...profile, active: event.target.checked }); setDirty(true); }} />{t("Сотрудник активен")}</label>}
      </div></fieldset><div className="editor-actions"><Button type="button" variant="outline" disabled={busy} onClick={close}>{t("Отменить")}</Button><Button disabled={busy}>{busy ? t("Сохраняем…") : t("Сохранить")}</Button></div></form>
    </AdminDialog>}
    {selected && data && <AdminDialog className="staff-access-dialog" title={t("Права: {v0}", { v0: selected.name })} description={t("Итоговый доступ складывается из прав роли и персональных разрешений.")} onClose={close} busy={busy}>
      <form onSubmit={saveAccess} className="editor-form"><fieldset disabled={busy || !owner} className="admin-form-fieldset">
        {error && <div role="alert" className="admin-error">{t(error)}</div>}
        <div className="staff-access-toolbar"><label>{t("Роль")}<select value={role} onChange={(event) => { setRole(event.target.value as Role); setDirty(true); }}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>{owner && <Button type="button" variant="outline" onClick={() => { setOverrides({}); setDirty(true); }}>{t("Сбросить к правам роли")}</Button>}</div>
        <p className="admin-muted">{t("Действия требуют просмотра соответствующего раздела. История покупок клиента доступна с просмотром заказов; корректировка наград — с просмотром пользователей и программы наград.")}</p>
        {role === "OWNER" ? <p className="admin-info">{t("Владелец имеет полный доступ. Персональные ограничения к нему не применяются. Последнего активного владельца нельзя заблокировать или понизить.")}</p> : <div className="staff-permissions admin-table-wrap"><Table><TableHeader><TableRow><TableHead>{t("Раздел")}</TableHead>{visibleActions.map((action) => <TableHead key={action}>{t(actions[action]) || action}</TableHead>)}</TableRow></TableHeader><TableBody>{permissionSections.map((section) => <TableRow key={section}><TableCell><strong>{t(sections[section]) || section}</strong></TableCell>{visibleActions.map((action) => {
          const definition = data.permissionDefinitions.find((permission) => permission.section === section && permission.action === action);
          if (!definition) return <TableCell key={action}><span aria-label={t("Не применяется")}>—</span></TableCell>;
          if (["staff.create", "staff.access"].includes(definition.key)) return <TableCell key={action}><small>{t("Только владелец")}</small></TableCell>;
          const override = overrides[definition.key]; const allowed = effective(definition.key);
          return <TableCell key={action}><label className="staff-permission-cell"><span className="sr-only">{t(sections[section])}: {t(definition.label)}</span><select aria-label={`${t(sections[section]) || section}: ${t(actions[action]) || t(definition.label)}`} value={override === undefined || override === null ? "inherit" : override ? "allow" : "deny"} onChange={(event) => { setOverrides({ ...overrides, [definition.key]: event.target.value === "inherit" ? null : event.target.value === "allow" }); setDirty(true); }}><option value="inherit">{t("От роли")}</option><option value="allow">{t("Разрешить")}</option><option value="deny">{t("Запретить")}</option></select><small className={allowed ? "access-allowed" : "access-denied"}>{allowed ? t("Разрешено") : t("Запрещено")}</small></label></TableCell>;
        })}</TableRow>)}</TableBody></Table></div>}
      </fieldset><div className="editor-actions"><Button type="button" variant="outline" onClick={close} disabled={busy}>{owner ? t("Отменить") : t("Закрыть")}</Button>{owner && <Button disabled={busy || !dirty}>{busy ? t("Сохраняем…") : t("Сохранить права")}</Button>}</div></form>
    </AdminDialog>}
  </div>;
}
