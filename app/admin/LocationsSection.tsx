"use client";

import { useAdminLanguage } from "./i18n";

import { type FormEvent, useCallback, useId, useMemo, useRef, useState } from "react";
import { hasValidCoordinates, type LocationGeocodeResult, type MapPosition } from "../locationUtils";
import PickupMap from "../PickupMap";
import type { PickupLocation } from "../types";
import AdminDialog from "./AdminDialog";
import { useAdminAccess } from "./AdminAccess";
import { Badge, Button, PageHeading } from "./ui";
import { usePagedAdminList, Pagination, type AdminListRequest } from "./usePagedAdminList";

type LocationDraft = Omit<PickupLocation, "id" | "latitude" | "longitude"> & {
  id?: number;
  latitude: number | "";
  longitude: number | "";
};

type LocationsSectionProps = {
  locations: PickupLocation[];
  request: AdminListRequest;
  onRefresh: () => Promise<void>;
  refreshKey?: number;
};

function newLocation(): LocationDraft {
  return {
    name: "",
    address: "",
    phone: "",
    hours: "10:00 - 21:00",
    opensAt: "10:00",
    latitude: "",
    longitude: "",
    active: true,
  };
}

function asGeocodeResult(value: unknown): LocationGeocodeResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Яндекс Карты вернули некорректный ответ.");
  const result = value as Record<string, unknown>;
  const position = { latitude: Number(result.latitude), longitude: Number(result.longitude) };
  const address = typeof result.address === "string" ? result.address.trim() : "";
  if (!address || !hasValidCoordinates(position)) throw new Error("Яндекс Карты не смогли определить адрес и координаты.");
  return { ...position, address };
}

function asMapLinkResult(value: unknown): LocationGeocodeResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Не удалось прочитать координаты из ссылки.");
  const result = value as Record<string, unknown>;
  const position = { latitude: Number(result.latitude), longitude: Number(result.longitude) };
  if (!hasValidCoordinates(position)) throw new Error("В ссылке Яндекс Карт не найдены корректные координаты.");
  return { ...position, address: typeof result.address === "string" ? result.address.trim() : "" };
}

export default function LocationsSection({ locations: refreshSignal, request, onRefresh, refreshKey = 0 }: LocationsSectionProps) {
  const { t } = useAdminLanguage();

  const { can } = useAdminAccess();
  const [editing, setEditing] = useState<LocationDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [addressBusy, setAddressBusy] = useState(false);
  const [mapLink, setMapLink] = useState("");
  const [mapLinkBusy, setMapLinkBusy] = useState(false);
  const [mapLinkStatus, setMapLinkStatus] = useState("");
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const [editorSession, setEditorSession] = useState(0);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<PickupLocation | null>(null);
  const [removing, setRemoving] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [listError, setListError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const list = usePagedAdminList<PickupLocation>(request, "locations", new URLSearchParams({ search, ...(status === "all" ? {} : { active: String(status === "active") }) }).toString(), refreshSignal, 24, refreshKey);
  const locations = list.items;
  const editorSessionRef = useRef(0);
  const actionPending = useRef(false);
  const linkPending = useRef(false);
  const editorId = useId();
  const editingLatitude = editing?.latitude;
  const editingLongitude = editing?.longitude;
  const editingId = editing?.id;
  const locationBusy = addressBusy || mapLinkBusy;

  const position = useMemo(() => {
    if (typeof editingLatitude !== "number" || typeof editingLongitude !== "number") return null;
    const next = { latitude: editingLatitude, longitude: editingLongitude };
    return hasValidCoordinates(next) ? next : null;
  }, [editingLatitude, editingLongitude]);
  const otherLocations = useMemo(
    () => locations.filter((location) => location.id !== editingId),
    [locations, editingId],
  );
  const visibleLocations = locations;

  const refreshList = async () => {
    try { await Promise.all([onRefresh(), list.reload()]); }
    catch (reason) { setListError(reason instanceof Error ? reason.message : "Изменение сохранено, но список не удалось обновить. Нажмите «Обновить»."); }
  };

  const searchAddress = useCallback(async (address: string) => {
    const result = await request(`geocode?query=${encodeURIComponent(address)}`);
    return asGeocodeResult(result);
  }, [request]);

  const resolveAddress = useCallback(async ({ latitude, longitude }: MapPosition) => {
    const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
    const result = await request(`geocode?${params.toString()}`);
    return asGeocodeResult(result);
  }, [request]);

  const applyMapLink = async () => {
    if (linkPending.current || actionPending.current) return;
    if (!editing || !mapLink.trim()) {
      setError("Вставьте ссылку из Яндекс Карт.");
      return;
    }
    const session = editorSessionRef.current;
    linkPending.current = true;
    setMapLinkBusy(true);
    setMapLinkStatus("");
    setError("");
    try {
      const result = asMapLinkResult(await request("yandex-map-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: mapLink.trim() }),
      }));
      if (session !== editorSessionRef.current) return;
      const address = result.address || editing.address.trim();
      setEditing((current) => current ? { ...current, ...result, address: result.address || current.address } : current);
      setAddressConfirmed(Boolean(address));
      setMapLinkStatus(`Координаты определены: ${result.latitude.toFixed(6)}, ${result.longitude.toFixed(6)}`);
      if (!address) setError("Координаты определены. Теперь укажите адрес точки.");
    } catch (linkError) {
      if (session === editorSessionRef.current) setError(linkError instanceof Error ? linkError.message : "Не удалось обработать ссылку Яндекс Карт");
    } finally {
      if (session === editorSessionRef.current) { linkPending.current = false; setMapLinkBusy(false); }
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || actionPending.current || !can(editing.id ? "locations.edit" : "locations.create")) return;
    if (![editing.name, editing.address, editing.phone, editing.hours, editing.opensAt].every((value) => value.trim())) {
      setError("Заполните название, телефон, адрес и часы работы точки.");
      return;
    }
    if (locationBusy) {
      setError("Дождитесь завершения поиска адреса.");
      return;
    }
    if (!position || !addressConfirmed) {
      setError("Подтвердите адрес кнопкой «Найти» или выберите точку на карте.");
      return;
    }
    if (editing.id && !locations.some((location) => location.id === editing.id)) {
      setError("Эта точка уже удалена. Закройте окно и обновите список.");
      return;
    }

    actionPending.current = true;
    setSaving(true);
    setError("");
    setListError("");
    try {
      await request(editing.id ? `locations/${editing.id}` : "locations", {
        method: editing.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editing, name: editing.name.trim(), address: editing.address.trim(), phone: editing.phone.trim(), hours: editing.hours.trim() }),
      });
      editorSessionRef.current += 1;
      setEditing(null);
      setAddressConfirmed(false);
      setNotice(editing.id ? "Изменения точки сохранены." : "Точка добавлена.");
      await refreshList();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить точку");
    } finally {
      actionPending.current = false;
      setSaving(false);
    }
  };

  const remove = async (event: FormEvent) => {
    event.preventDefault();
    if (!deleting || actionPending.current || !can("locations.delete")) return;
    actionPending.current = true;
    setRemoving(true);
    setDeleteError("");
    setListError("");
    try {
      await request(`locations/${deleting.id}`, { method: "DELETE" });
      if (editing?.id === deleting.id) { editorSessionRef.current += 1; setEditing(null); }
      setDeleting(null);
      setNotice(`Точка «${deleting.name}» архивирована.`);
      await refreshList();
    } catch (removeError) {
      setDeleteError(removeError instanceof Error ? removeError.message : "Не удалось удалить точку");
    } finally {
      actionPending.current = false;
      setRemoving(false);
    }
  };

  const updatePosition = useCallback((next: MapPosition) => {
    if (actionPending.current) return;
    setEditing((current) => current ? { ...current, ...next } : current);
    setAddressConfirmed(false);
    setError("");
    setMapLinkStatus("");
  }, []);

  const updateAddress = useCallback((address: string) => {
    if (actionPending.current) return;
    setEditing((current) => current ? { ...current, address } : current);
    setAddressConfirmed(false);
    setError("");
  }, []);

  const applyResolvedLocation = useCallback((result: LocationGeocodeResult) => {
    if (actionPending.current) return;
    setEditing((current) => current ? {
      ...current,
      address: result.address,
      latitude: result.latitude,
      longitude: result.longitude,
    } : current);
    setAddressConfirmed(true);
    setError("");
  }, []);

  const startNewLocation = () => {
    if (actionPending.current || !can("locations.create")) return;
    editorSessionRef.current += 1;
    linkPending.current = false;
    setEditorSession((current) => current + 1);
    setEditing(newLocation());
    setAddressConfirmed(false);
    setAddressBusy(false);
    setMapLink("");
    setMapLinkBusy(false);
    setMapLinkStatus("");
    setError("");
    setListError("");
    setNotice("");
  };

  const startEditingLocation = (location: PickupLocation) => {
    if (actionPending.current || !can("locations.edit")) return;
    editorSessionRef.current += 1;
    linkPending.current = false;
    setEditorSession((current) => current + 1);
    setEditing({ ...location });
    setAddressConfirmed(Boolean(location.address.trim()) && hasValidCoordinates(location));
    setAddressBusy(false);
    setMapLink("");
    setMapLinkBusy(false);
    setMapLinkStatus("");
    setError("");
    setListError("");
    setNotice("");
  };

  const cancelEditing = () => {
    if (actionPending.current) return;
    editorSessionRef.current += 1;
    linkPending.current = false;
    setEditing(null);
    setAddressConfirmed(false);
    setAddressBusy(false);
    setMapLink("");
    setMapLinkBusy(false);
    setMapLinkStatus("");
    setError("");
  };

  return (
    <section className="admin-section locations-admin-section">
      <PageHeading title={t("Точки самовывоза")} description={t("Адреса, контакты и доступность точек на сайте.")}>{can("locations.create") && <Button variant="default" type="button" disabled={saving || removing} onClick={startNewLocation}>{t("+ Добавить точку")}</Button>}</PageHeading>

      {listError ? <div className="admin-error banner" role="alert">{listError}</div> : null}
      {notice ? <div className="admin-success banner" role="status">{t(notice)}</div> : null}
      {t(list.error) && <div className="admin-error banner" role="alert">{t(list.error)}<button type="button" onClick={() => void list.reload()}>{t("Повторить")}</button></div>}
      <div className="admin-crud-toolbar">
        <label className="admin-search-field"><span className="sr-only">{t("Поиск точек по названию, адресу или телефону")}</span><input type="search" placeholder={t("Название, адрес или телефон")} value={search} onChange={(event) => { setSearch(event.target.value); list.setPage(0); }} /></label>
        <label className="admin-filter-field"><span className="sr-only">{t("Видимость точки на сайте")}</span><select value={status} onChange={(event) => { setStatus(event.target.value); list.setPage(0); }}><option value="all">{t("Все точки")}</option><option value="active">{t("На сайте")}</option><option value="hidden">{t("Скрытые")}</option></select></label>
        <span className="admin-list-count" role="status">{list.loading ? t("Обновляем…") : t("Всего: {v0}", { v0: list.total })}</span>
      </div>

      {editing ? (
        <AdminDialog title={editing.id ? t("Изменить «{v0}»", { v0: editing.name }) : t("Новая точка самовывоза")} description={t("Укажите контакты и часы работы. Подтвердите адрес на карте или вставьте ссылку из Яндекс Карт.")} onClose={cancelEditing} busy={saving} className="admin-editor-dialog location-editor-dialog">
        <form className="editor-form location-editor-form" onSubmit={save} aria-busy={saving}>
          {error ? <div className="admin-error" role="alert">{t(error)}</div> : null}
          <fieldset disabled={saving} className="admin-editor-fieldset">
          <div className="location-editor-layout">
            <div className="editor-grid location-fields">
              <label>{t("Название")}<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} required /></label>
              <label>{t("Телефон")}<input type="tel" autoComplete="tel" value={editing.phone} onChange={(event) => setEditing({ ...editing, phone: event.target.value })} required /></label>
              <label className="wide-field">{t("Адрес")}<input value={editing.address} onChange={(event) => updateAddress(event.target.value)} placeholder={t("Город, улица, дом")} disabled={locationBusy} required /></label>
              <details className="wide-field location-link-details">
                <summary>{t("Указать точку ссылкой из Яндекс Карт")}</summary>
                <div className="location-link-field">
                <label htmlFor={`${editorId}-yandex-map-link`}>{t("Ссылка из Яндекс Карт")}</label>
                <div className="location-link-control">
                  <input id={`${editorId}-yandex-map-link`} type="url" value={mapLink} onChange={(event) => { setMapLink(event.target.value); setMapLinkStatus(""); }} placeholder="https://yandex.ru/maps/…" disabled={locationBusy} />
                  <button type="button" onClick={() => void applyMapLink()} disabled={locationBusy || !mapLink.trim()}>{mapLinkBusy ? t("Определяем…") : t("Определить точку")}</button>
                </div>
                <small>{mapLinkStatus ? t(mapLinkStatus) : t("Откройте точку в Яндекс Картах, нажмите «Поделиться» и вставьте ссылку.")}</small>
                </div>
              </details>
              <label>{t("Часы работы")}<input value={editing.hours} onChange={(event) => setEditing({ ...editing, hours: event.target.value })} required /></label>
              <label>{t("Открытие")}<input type="time" value={editing.opensAt} onChange={(event) => setEditing({ ...editing, opensAt: event.target.value })} required /></label>
              <label className="check-field"><input type="checkbox" checked={editing.active} onChange={(event) => setEditing({ ...editing, active: event.target.checked })} />{t("Показывать на сайте")}</label>
              <p className={`location-address-confirmation ${addressConfirmed ? "is-confirmed" : ""}`} role="status">
                {locationBusy ? t("Определяем точку…") : addressConfirmed ? t("Адрес и точка на карте подтверждены") : t("Вставьте ссылку, найдите адрес или выберите точку на карте")}
              </p>
            </div>
            <div className="location-map-editor" inert={saving || mapLinkBusy}>
              <PickupMap
                key={`${editing.id ? `location-${editing.id}` : "new-location"}-${editorSession}`}
                locations={otherLocations}
                editablePosition={position}
                editableAddress={editing.address}
                onPositionInput={updatePosition}
                onAddressInput={updateAddress}
                onLocationResolved={applyResolvedLocation}
                onAddressSearch={searchAddress}
                onAddressResolve={resolveAddress}
                onAddressBusyChange={setAddressBusy}
                ariaLabel={t("Редактор точки на Яндекс Картах")}
              />
            </div>
          </div>
          </fieldset>
          <div className="editor-actions">
            <button type="button" data-dialog-dismiss disabled={saving} onClick={cancelEditing}>{t("Отмена")}</button>
            <button type="submit" className="admin-primary" disabled={saving || locationBusy}>
              {saving ? t("Сохранение…") : locationBusy ? t("Проверка точки…") : t("Сохранить")}
            </button>
          </div>
        </form>
        </AdminDialog>
      ) : null}

      {visibleLocations.length ? <div className="admin-record-list location-admin-list">{visibleLocations.map((location) => <article className="admin-record-card location-card" key={location.id}>
        <header className="admin-record-summary"><h3>{location.name}</h3><Badge variant={location.active ? "success" : "secondary"}>{location.active ? t("На сайте") : t("Скрыта")}</Badge></header>
        <dl className="admin-record-fields">
          <div className="wide-field"><dt>{t("Адрес")}</dt><dd>{location.address}</dd></div>
          <div><dt>{t("Телефон")}</dt><dd><a href={`tel:${location.phone}`}>{location.phone}</a></dd></div>
          <div><dt>{t("Часы работы")}</dt><dd>{location.hours}</dd></div>
        </dl>
        {hasValidCoordinates(location) ? <a className="location-card-map-link" href={`https://yandex.ru/maps/?pt=${location.longitude},${location.latitude}&z=16&l=map`} target="_blank" rel="noreferrer">{t("Открыть на карте ↗")}</a> : <p className="admin-error">{t("Проверьте координаты точки в редакторе.")}</p>}
        <footer className="admin-record-actions">{can("locations.edit") && <Button type="button" disabled={saving || removing} onClick={() => startEditingLocation(location)} aria-label={t("Редактировать точку «{v0}»", { v0: location.name })}>{t("Редактировать")}</Button>}{can("locations.delete") && <Button variant="ghost" type="button" className="danger" disabled={saving || removing} onClick={() => { setDeleting(location); setDeleteError(""); setNotice(""); }} aria-label={t("Архивировать точку «{v0}»", { v0: location.name })}>{t("Архивировать")}</Button>}</footer>
      </article>)}</div> : !list.loading && !t(list.error) ? <div className="admin-empty-state"><h3>{search || status !== "all" ? t("Точки не найдены") : t("Точек пока нет")}</h3><p>{search || status !== "all" ? t("Измените поиск или фильтр видимости.") : t("Добавьте точку, чтобы покупатели могли выбрать место самовывоза.")}</p></div> : null}
      <Pagination page={list.page} total={list.total} limit={list.limit} loading={list.loading} onPage={list.setPage} />
      {deleting ? (
        <AdminDialog title={t("Архивировать точку «{v0}»?", { v0: deleting.name })} description={t("Точка исчезнет с сайта и из списка управления. Ранее оформленные заказы сохранятся.")} onClose={() => { if (!removing) setDeleting(null); }} busy={removing} className="admin-confirm-dialog">
          <form onSubmit={remove} aria-busy={removing}>
            {deleteError ? <div className="admin-error" role="alert">{t(deleteError)}</div> : null}
            <div className="editor-actions">
              <button type="button" disabled={removing} onClick={() => setDeleting(null)}>{t("Отмена")}</button>
              <button type="submit" className="danger-solid" disabled={removing}>{removing ? t("Архивируем…") : t("Архивировать")}</button>
            </div>
          </form>
        </AdminDialog>
      ) : null}
    </section>
  );
}
