"use client";

import { useAdminLanguage } from "./i18n";

import { type FormEvent, useState } from "react";
import { scheduleTimezone, validateWeeklySchedule, type WeeklySchedule } from "../../server/schedule-rules";
import { useAdminAccess } from "./AdminAccess";
import AdminDialog from "./AdminDialog";
import { Pagination, usePagedAdminList, type AdminListRequest } from "./usePagedAdminList";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui";

type LocationSchedule = { locationId: number; name: string; address: string; legacyHours: string; enabled: boolean; timezone: string; weekly: WeeklySchedule; version: number; updatedAt?: string };
const days = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const summary = (weekly: WeeklySchedule) => {
  const open = weekly.filter((day) => day.intervals.length > 0).length;
  return open ? `Рабочих дней: ${open} из 7` : "Все дни закрыты";
};

export default function SchedulesSection({ request, refreshKey = 0 }: { request: AdminListRequest; refreshKey?: number }) {
  const { t } = useAdminLanguage();

  const { can } = useAdminAccess();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<LocationSchedule | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const list = usePagedAdminList<LocationSchedule>(request, "schedules", new URLSearchParams({ search }).toString(), refreshKey);
  const changeDay = (day: number, update: WeeklySchedule[number]["intervals"]) => {
    setDirty(true);
    setEditing((current) => current ? { ...current, weekly: current.weekly.map((item) => item.day === day ? { ...item, intervals: update } : item) } : current);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || saving || !can("schedules.edit")) return;
    try {
      const weekly = validateWeeklySchedule(editing.weekly);
      setSaving(true); setError("");
      await request(`schedules/${editing.locationId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weekly, enabled: editing.enabled, timezone: scheduleTimezone, version: editing.version }) });
      setEditing(null); setDirty(false); setNotice("Расписание сохранено. Оно применяется к новым заказам."); await list.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить расписание."); }
    finally { setSaving(false); }
  };
  return <Card><CardHeader><CardTitle>{t("Недельное расписание")}</CardTitle><CardDescription>{t("Часовой пояс — Бишкек (UTC+6). У каждой точки своё расписание.")}</CardDescription></CardHeader><CardContent>
    {notice && <div className="admin-success banner" role="status">{t(notice)}</div>}
    {t(list.error) && <div className="admin-error banner" role="alert">{t(list.error)}<Button onClick={() => void list.reload()}>{t("Повторить")}</Button></div>}
    <label className="schedule-search"><span className="sr-only">{t("Поиск точки")}</span><input type="search" value={search} placeholder={t("Найти точку по названию или адресу…")} onChange={(event) => { setSearch(event.target.value); list.setPage(0); }} /></label>
    {list.loading && <p className="admin-muted" role="status">{t("Обновляем расписания…")}</p>}
    <Table><TableHeader><TableRow><TableHead>{t("Точка")}</TableHead><TableHead>{t("Расписание")}</TableHead><TableHead>{t("Приём заказов")}</TableHead><TableHead><span className="sr-only">{t("Действия")}</span></TableHead></TableRow></TableHeader><TableBody>{list.items.map((item) => <TableRow key={item.locationId}><TableCell><strong>{item.name}</strong><small className="staff-contact">{item.address}</small></TableCell><TableCell>{item.enabled ? t(summary(item.weekly)) : item.legacyHours || t("Недельное расписание не задано")}</TableCell><TableCell><Badge variant={item.enabled ? "success" : "outline"}>{item.enabled ? t("По расписанию") : t("Без ограничения по дням")}</Badge></TableCell><TableCell><Button onClick={() => { setEditing(structuredClone(item)); setDirty(false); setError(""); }}>{can("schedules.edit") ? t("Редактировать") : t("Посмотреть")}</Button></TableCell></TableRow>)}</TableBody></Table>
    {!list.loading && !list.items.length && !t(list.error) && <div className="admin-empty-state"><h3>{t("Точки не найдены")}</h3><p>{t("Добавьте точку самовывоза или измените поиск.")}</p></div>}
    <Pagination page={list.page} total={list.total} limit={list.limit} loading={list.loading} onPage={list.setPage} />
    {editing && <AdminDialog title={t("Время работы: {v0}", { v0: editing.name })} description={t("Интервал с окончанием раньше начала продолжается на следующий день.")} onClose={() => { if (!saving) { setEditing(null); setDirty(false); } }} busy={saving} unsaved={dirty} className="admin-editor-dialog schedule-editor-dialog"><form onSubmit={save}>
      {error && <div className="admin-error banner" role="alert">{t(error)}</div>}
      <fieldset disabled={saving || !can("schedules.edit")}>
        <label className="check-field schedule-enabled"><input type="checkbox" checked={editing.enabled} onChange={(event) => setEditing({ ...editing, enabled: event.target.checked })} />{t("Принимать заказы только в рабочие интервалы")}</label>
        <p className="admin-info schedule-help">{editing.enabled ? t("Вне расписания сервер отклонит новый заказ. Уже созданные заказы останутся доступны.") : t("Недельное ограничение выключено. Текущее обозначение на сайте: {v0}.", { v0: editing.legacyHours || t("не указано") })}</p>
        <div className="schedule-week">{editing.weekly.map(({ day, intervals }) => <section className="schedule-day" key={day}><div className="schedule-day-heading"><strong>{t(days[day])}</strong><label className="check-field"><input type="checkbox" checked={intervals.length === 0} onChange={(event) => changeDay(day, event.target.checked ? [] : [{ start: "10:00", end: "21:00" }])} />{t("Выходной")}</label></div><div className="schedule-day-intervals">{intervals.map((interval, index) => <div className="schedule-interval" key={index}><label><span className="sr-only">{days[day]}{t(", начало интервала")} {index + 1}</span><input type="time" required value={interval.start} onChange={(event) => changeDay(day, intervals.map((value, position) => position === index ? { ...value, start: event.target.value } : value))} /></label><span>—</span><label><span className="sr-only">{days[day]}{t(", конец интервала")} {index + 1}</span><input type="time" required value={interval.end} onChange={(event) => changeDay(day, intervals.map((value, position) => position === index ? { ...value, end: event.target.value } : value))} /></label><Button variant="ghost" type="button" aria-label={t("Убрать интервал {v0}, {v1}", { v0: index + 1, v1: t(days[day]) })} onClick={() => changeDay(day, intervals.filter((_, position) => position !== index))}>×</Button>{interval.start === interval.end && <small>{t("24 часа")}</small>}{interval.end < interval.start && <small>{t("На следующий день")}</small>}</div>)}{intervals.length < 6 && <Button variant="ghost" type="button" className="schedule-add" onClick={() => changeDay(day, [...intervals, { start: "10:00", end: "21:00" }])}>{t("+ Интервал")}</Button>}</div></section>)}</div>
        <p className="admin-muted">{t("Для перерыва добавьте два интервала. Одинаковое начало и окончание означает 24 часа. Пересекающиеся интервалы сохранить нельзя.")}</p>
      </fieldset><div className="editor-actions"><Button type="button" data-dialog-dismiss disabled={saving} onClick={() => setEditing(null)}>{t("Отменить")}</Button>{can("schedules.edit") && <Button variant="default" disabled={saving}>{saving ? t("Сохраняем…") : t("Сохранить")}</Button>}</div>
    </form></AdminDialog>}
  </CardContent></Card>;
}
