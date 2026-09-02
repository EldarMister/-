"use client";

import { FormEvent, useCallback, useMemo, useState } from "react";
import { hasValidCoordinates, type LocationGeocodeResult, type MapPosition } from "../locationUtils";
import PickupMap from "../PickupMap";
import type { PickupLocation } from "../types";

type LocationDraft = Omit<PickupLocation, "id" | "latitude" | "longitude"> & {
  id?: number;
  latitude: number | "";
  longitude: number | "";
};

type LocationsSectionProps = {
  locations: PickupLocation[];
  request: (path: string, options?: RequestInit) => Promise<unknown>;
  onRefresh: () => Promise<void>;
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

export default function LocationsSection({ locations, request, onRefresh }: LocationsSectionProps) {
  const [editing, setEditing] = useState<LocationDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [addressBusy, setAddressBusy] = useState(false);
  const [mapLink, setMapLink] = useState("");
  const [mapLinkBusy, setMapLinkBusy] = useState(false);
  const [mapLinkStatus, setMapLinkStatus] = useState("");
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const [editorSession, setEditorSession] = useState(0);
  const [error, setError] = useState("");
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
    if (!editing || !mapLink.trim()) {
      setError("Вставьте ссылку из Яндекс Карт.");
      return;
    }
    setMapLinkBusy(true);
    setMapLinkStatus("");
    setError("");
    try {
      const result = asMapLinkResult(await request("yandex-map-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: mapLink.trim() }),
      }));
      const address = result.address || editing.address.trim();
      setEditing((current) => current ? { ...current, ...result, address: result.address || current.address } : current);
      setAddressConfirmed(Boolean(address));
      setMapLinkStatus(`Координаты определены: ${result.latitude.toFixed(6)}, ${result.longitude.toFixed(6)}`);
      if (!address) setError("Координаты определены. Теперь укажите адрес точки.");
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Не удалось обработать ссылку Яндекс Карт");
    } finally {
      setMapLinkBusy(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    if (locationBusy) {
      setError("Дождитесь завершения поиска адреса.");
      return;
    }
    if (!position || !addressConfirmed) {
      setError("Подтвердите адрес кнопкой «Найти» или выберите точку на карте.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await request(editing.id ? `locations/${editing.id}` : "locations", {
        method: editing.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editing, address: editing.address.trim() }),
      });
      setEditing(null);
      setAddressConfirmed(false);
      await onRefresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить точку");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (location: PickupLocation) => {
    if (!window.confirm(`Удалить точку «${location.name}»?`)) return;
    setError("");
    try {
      await request(`locations/${location.id}`, { method: "DELETE" });
      await onRefresh();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Не удалось удалить точку");
    }
  };

  const updatePosition = useCallback((next: MapPosition) => {
    setEditing((current) => current ? { ...current, ...next } : current);
    setAddressConfirmed(false);
    setError("");
    setMapLinkStatus("");
  }, []);

  const updateAddress = useCallback((address: string) => {
    setEditing((current) => current ? { ...current, address } : current);
    setAddressConfirmed(false);
    setError("");
  }, []);

  const applyResolvedLocation = useCallback((result: LocationGeocodeResult) => {
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
    setEditorSession((current) => current + 1);
    setEditing(newLocation());
    setAddressConfirmed(false);
    setAddressBusy(false);
    setMapLink("");
    setMapLinkBusy(false);
    setMapLinkStatus("");
    setError("");
  };

  const startEditingLocation = (location: PickupLocation) => {
    setEditorSession((current) => current + 1);
    setEditing({ ...location });
    setAddressConfirmed(true);
    setAddressBusy(false);
    setMapLink("");
    setMapLinkBusy(false);
    setMapLinkStatus("");
    setError("");
  };

  const cancelEditing = () => {
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
      <div className="section-title">
        <div>
          <h2>Точки самовывоза</h2>
          <p>Адрес и метка на Яндекс Картах редактируются здесь.</p>
        </div>
        <button className="admin-primary" type="button" onClick={startNewLocation}>+ Добавить</button>
      </div>

      {error ? <div className="admin-error banner">{error}</div> : null}

      {editing ? (
        <form className="editor-form location-editor-form" onSubmit={save}>
          <h3>{editing.id ? "Редактирование точки" : "Новая точка"}</h3>
          <div className="location-editor-layout">
            <div className="editor-grid location-fields">
              <label>Название<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} required /></label>
              <label>Телефон<input value={editing.phone} onChange={(event) => setEditing({ ...editing, phone: event.target.value })} required /></label>
              <label className="wide-field">Адрес<input value={editing.address} onChange={(event) => updateAddress(event.target.value)} placeholder="Город, улица, дом" disabled={locationBusy} required /></label>
              <div className="wide-field location-link-field">
                <label htmlFor="yandex-map-link">Ссылка из Яндекс Карт</label>
                <div className="location-link-control">
                  <input id="yandex-map-link" type="url" value={mapLink} onChange={(event) => { setMapLink(event.target.value); setMapLinkStatus(""); }} placeholder="https://yandex.ru/maps/…" disabled={locationBusy} />
                  <button type="button" onClick={() => void applyMapLink()} disabled={locationBusy || !mapLink.trim()}>{mapLinkBusy ? "Определяем…" : "Определить точку"}</button>
                </div>
                <small>{mapLinkStatus || "Откройте точку в Яндекс Картах, нажмите «Поделиться» и вставьте ссылку."}</small>
              </div>
              <label>Часы работы<input value={editing.hours} onChange={(event) => setEditing({ ...editing, hours: event.target.value })} required /></label>
              <label>Открытие<input type="time" value={editing.opensAt} onChange={(event) => setEditing({ ...editing, opensAt: event.target.value })} required /></label>
              <label>Широта<input type="number" value={editing.latitude} placeholder="Определится автоматически" readOnly /></label>
              <label>Долгота<input type="number" value={editing.longitude} placeholder="Определится автоматически" readOnly /></label>
              <label className="check-field"><input type="checkbox" checked={editing.active} onChange={(event) => setEditing({ ...editing, active: event.target.checked })} />Показывать на сайте</label>
              <p className={`location-address-confirmation ${addressConfirmed ? "is-confirmed" : ""}`} role="status">
                {locationBusy ? "Определяем точку…" : addressConfirmed ? "Адрес и точка на карте подтверждены" : "Вставьте ссылку, найдите адрес или выберите точку на карте"}
              </p>
            </div>
            <div className="location-map-editor">
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
                ariaLabel="Редактор точки на Яндекс Картах"
              />
            </div>
          </div>
          <div className="editor-actions">
            <button type="button" onClick={cancelEditing}>Отмена</button>
            <button className="admin-primary" disabled={saving || locationBusy || !addressConfirmed}>
              {saving ? "Сохранение…" : locationBusy ? "Проверка точки…" : "Сохранить"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="admin-table-wrap">
        <table>
          <thead><tr><th>Точка</th><th>Адрес</th><th>Координаты</th><th>Статус</th><th /></tr></thead>
          <tbody>
            {locations.map((location) => (
              <tr key={location.id}>
                <td><strong>{location.name}</strong><br /><small>{location.phone}</small></td>
                <td>{location.address}</td>
                <td className="coordinate-cell">{location.latitude.toFixed(6)}<br />{location.longitude.toFixed(6)}</td>
                <td>{location.active ? "На сайте" : "Скрыта"}</td>
                <td className="row-actions">
                  <button type="button" onClick={() => startEditingLocation(location)}>Изменить</button>
                  <button type="button" className="danger" onClick={() => void remove(location)}>Удалить</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
