"use client";

import Script from "next/script";
import { KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  distanceInKilometers,
  hasValidCoordinates,
  pickupStatus,
  type LocationGeocodeResult,
  type MapPosition,
} from "./locationUtils";
import type { PickupLocation } from "./types";

type LngLat = [number, number];

type YandexMapEntity = {
  update(changedProps: Record<string, unknown>): void;
};

type YandexMapInstance = YandexMapEntity & {
  addChild(entity: YandexMapEntity): YandexMapInstance;
  removeChild(entity: YandexMapEntity): YandexMapInstance;
  setLocation(location: {
    center: LngLat;
    zoom: number;
    duration?: number;
    easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out";
  }): void;
  destroy(): void;
};

type YandexMapEvent = {
  coordinates: LngLat;
};

type YandexMapApi = {
  ready: Promise<unknown>;
  YMap: new (container: HTMLElement, props: Record<string, unknown>) => YandexMapInstance;
  YMapDefaultSchemeLayer: new (props?: Record<string, unknown>) => YandexMapEntity;
  YMapDefaultFeaturesLayer: new (props?: Record<string, unknown>) => YandexMapEntity;
  YMapMarker: new (
    props: {
      coordinates: LngLat;
      draggable?: boolean;
      mapFollowsOnDrag?: boolean;
      onDragMove?: (coordinates: LngLat) => void;
      onDragEnd?: (coordinates: LngLat) => void;
      zIndex?: number;
    },
    element?: HTMLElement,
  ) => YandexMapEntity;
  YMapListener: new (props: {
    layer?: string;
    onClick?: (object: { type?: string } | undefined, event: YandexMapEvent) => void;
    onUpdate?: (event: { location?: { center?: LngLat; zoom?: number } }) => void;
  }) => YandexMapEntity;
};

declare global {
  interface Window {
    ymaps3?: YandexMapApi;
  }
}

type PickupMapProps = {
  locations: PickupLocation[];
  selectedId?: number | null;
  onSelect?: (location: PickupLocation) => void;
  editablePosition?: MapPosition | null;
  editableAddress?: string;
  onPositionInput?: (position: MapPosition) => void;
  onAddressInput?: (address: string) => void;
  onLocationResolved?: (result: LocationGeocodeResult) => void;
  onAddressSearch?: (address: string) => Promise<LocationGeocodeResult>;
  onAddressResolve?: (position: MapPosition) => Promise<LocationGeocodeResult>;
  onAddressBusyChange?: (busy: boolean) => void;
  onUserPosition?: (position: MapPosition) => void;
  className?: string;
  ariaLabel?: string;
};

const DEFAULT_CENTER: LngLat = [104.305, 52.287];
const DEFAULT_ZOOM = 12;
const SELECTED_LOCATION_ZOOM = 15;
const SELECTED_LOCATION_TRANSITION_MS = 450;
const YANDEX_MAPS_API_KEY = process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY?.trim() || "";

function yandexMapsScriptUrl() {
  return `https://api-maps.yandex.ru/v3/?apikey=${encodeURIComponent(YANDEX_MAPS_API_KEY)}&lang=ru_RU`;
}

function toLngLat(position: MapPosition): LngLat {
  return [position.longitude, position.latitude];
}

function fromLngLat(coordinates: LngLat): MapPosition {
  return {
    latitude: Number(coordinates[1].toFixed(6)),
    longitude: Number(coordinates[0].toFixed(6)),
  };
}

function viewForLocations(locations: PickupLocation[]) {
  if (locations.length === 0) return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
  const longitudes = locations.map((location) => location.longitude);
  const latitudes = locations.map((location) => location.latitude);
  const west = Math.min(...longitudes);
  const east = Math.max(...longitudes);
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);
  const spread = Math.max(east - west, north - south);
  const zoom = locations.length === 1 ? 15 : spread < 0.02 ? 14 : spread < 0.06 ? 13 : spread < 0.15 ? 12 : spread < 0.3 ? 11 : 10;
  return { center: [(west + east) / 2, (south + north) / 2] as LngLat, zoom };
}

function createLocationMarkerElement(location: PickupLocation, selected: boolean) {
  const status = pickupStatus(location);
  const element = document.createElement("button");
  element.type = "button";
  element.className = `yandex-location-marker${selected ? " is-selected" : ""}`;
  element.setAttribute("aria-label", `${location.name}, ${location.address}, ${status.label} ${status.time}`);

  const pin = document.createElement("span");
  pin.className = "yandex-location-pin";
  pin.textContent = "С";

  const label = document.createElement("span");
  label.className = "yandex-location-label";
  const title = document.createElement("strong");
  title.textContent = location.name;
  const hours = document.createElement("small");
  hours.textContent = `${status.label} ${status.time}`;
  label.append(title, hours);
  element.append(pin, label);
  return element;
}

function createEditMarkerElement() {
  const element = document.createElement("div");
  element.className = "yandex-edit-marker";
  element.setAttribute("aria-label", "Редактируемая точка");
  element.setAttribute("role", "img");
  return element;
}

function createUserMarkerElement() {
  const element = document.createElement("div");
  element.className = "yandex-user-marker";
  element.setAttribute("aria-label", "Ваше местоположение");
  element.setAttribute("role", "img");
  return element;
}

export default function PickupMap({
  locations,
  selectedId = null,
  onSelect,
  editablePosition,
  editableAddress = "",
  onPositionInput,
  onAddressInput,
  onLocationResolved,
  onAddressSearch,
  onAddressResolve,
  onAddressBusyChange,
  onUserPosition,
  className = "",
  ariaLabel = "Карта точек самовывоза",
}: PickupMapProps) {
  const [apiReady, setApiReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [geoMessage, setGeoMessage] = useState("");
  const [addressMessage, setAddressMessage] = useState("");
  const [searchingAddress, setSearchingAddress] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<YandexMapInstance | null>(null);
  const locationMarkersRef = useRef<YandexMapEntity[]>([]);
  const editMarkerRef = useRef<YandexMapEntity | null>(null);
  const userMarkerRef = useRef<YandexMapEntity | null>(null);
  const syncRef = useRef<(() => void) | null>(null);
  const currentCenterRef = useRef<LngLat>(DEFAULT_CENTER);
  const currentZoomRef = useRef(DEFAULT_ZOOM);
  const previousLocationKeyRef = useRef("");
  const selectedFocusKeyRef = useRef("");
  const previousEditablePositionRef = useRef("");
  const addressRequestRef = useRef(0);
  const mountedRef = useRef(false);
  const latestLocationsRef = useRef<PickupLocation[]>([]);
  const latestSelectedIdRef = useRef<number | null>(selectedId);
  const latestEditablePositionRef = useRef<MapPosition | null | undefined>(editablePosition);
  const latestEditableAddressRef = useRef(editableAddress);
  const onSelectRef = useRef(onSelect);
  const onPositionInputRef = useRef(onPositionInput);
  const onAddressInputRef = useRef(onAddressInput);
  const onLocationResolvedRef = useRef(onLocationResolved);
  const onAddressSearchRef = useRef(onAddressSearch);
  const onAddressResolveRef = useRef(onAddressResolve);
  const onAddressBusyChangeRef = useRef(onAddressBusyChange);
  const onUserPositionRef = useRef(onUserPosition);

  const validLocations = useMemo(
    () => locations.filter((location) => location.active && hasValidCoordinates(location)),
    [locations],
  );
  const selectedLocation = validLocations.find((location) => location.id === selectedId) || validLocations[0] || null;

  const updateCamera = useCallback((center: LngLat, zoom: number, duration = 250) => {
    currentCenterRef.current = center;
    currentZoomRef.current = zoom;
    mapRef.current?.setLocation({ center, zoom, duration, easing: "ease-in-out" });
  }, []);

  const setAddressBusy = useCallback((busy: boolean) => {
    if (!mountedRef.current) return;
    setSearchingAddress(busy);
    onAddressBusyChangeRef.current?.(busy);
  }, []);

  const resolvePosition = useCallback(async (position: MapPosition) => {
    onPositionInputRef.current?.(position);
    const resolveAddress = onAddressResolveRef.current;
    if (!resolveAddress) return;

    const requestId = ++addressRequestRef.current;
    setAddressBusy(true);
    setAddressMessage("Определяем адрес по точке…");
    try {
      const result = await resolveAddress(position);
      if (!mountedRef.current || requestId !== addressRequestRef.current) return;
      onLocationResolvedRef.current?.(result);
      updateCamera(toLngLat(result), Math.max(currentZoomRef.current, 16));
      setAddressMessage("Адрес и координаты подтверждены.");
    } catch (error) {
      if (mountedRef.current && requestId === addressRequestRef.current) {
        setAddressMessage(error instanceof Error ? error.message : "Не удалось определить адрес. Попробуйте ещё раз.");
      }
    } finally {
      if (mountedRef.current && requestId === addressRequestRef.current) setAddressBusy(false);
    }
  }, [setAddressBusy, updateCamera]);

  const findAddress = useCallback(async (address?: string) => {
    const query = (address ?? latestEditableAddressRef.current).trim();
    const searchAddress = onAddressSearchRef.current;
    if (!query) {
      setAddressMessage("Введите город, улицу и номер дома.");
      return;
    }
    if (!searchAddress) {
      setAddressMessage("Поиск адреса пока не настроен.");
      return;
    }

    const requestId = ++addressRequestRef.current;
    setAddressBusy(true);
    setAddressMessage("Ищем адрес в Яндекс Картах…");
    try {
      const result = await searchAddress(query);
      if (!mountedRef.current || requestId !== addressRequestRef.current) return;
      onLocationResolvedRef.current?.(result);
      updateCamera(toLngLat(result), 16);
      setAddressMessage("Адрес найден — метка установлена.");
    } catch (error) {
      if (mountedRef.current && requestId === addressRequestRef.current) {
        setAddressMessage(error instanceof Error ? error.message : "Адрес не найден. Уточните город, улицу и номер дома.");
      }
    } finally {
      if (mountedRef.current && requestId === addressRequestRef.current) setAddressBusy(false);
    }
  }, [setAddressBusy, updateCamera]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      addressRequestRef.current += 1;
      onAddressBusyChangeRef.current?.(false);
    };
  }, []);

  useEffect(() => {
    latestLocationsRef.current = validLocations;
    latestSelectedIdRef.current = selectedId;
    latestEditablePositionRef.current = editablePosition;
    latestEditableAddressRef.current = editableAddress;
    onSelectRef.current = onSelect;
    onPositionInputRef.current = onPositionInput;
    onAddressInputRef.current = onAddressInput;
    onLocationResolvedRef.current = onLocationResolved;
    onAddressSearchRef.current = onAddressSearch;
    onAddressResolveRef.current = onAddressResolve;
    onAddressBusyChangeRef.current = onAddressBusyChange;
    onUserPositionRef.current = onUserPosition;
    syncRef.current?.();
  }, [
    validLocations,
    selectedId,
    editablePosition,
    editableAddress,
    onSelect,
    onPositionInput,
    onAddressInput,
    onLocationResolved,
    onAddressSearch,
    onAddressResolve,
    onAddressBusyChange,
    onUserPosition,
  ]);

  const handleApiReady = useCallback(async () => {
    const maps = window.ymaps3;
    if (!maps) {
      if (mountedRef.current) setLoadError("Яндекс Карты не загрузились.");
      return;
    }
    try {
      await maps.ready;
      if (!mountedRef.current) return;
      setLoadError("");
      setApiReady(true);
    } catch {
      if (mountedRef.current) setLoadError("Не удалось подготовить Яндекс Карты.");
    }
  }, []);

  useEffect(() => {
    if (!apiReady) return;
    const maps = window.ymaps3;
    const container = containerRef.current;
    if (!maps || !container || mapRef.current) return;

    const initialEditablePosition = latestEditablePositionRef.current;
    const initialView = hasValidCoordinates(initialEditablePosition) && initialEditablePosition
      ? { center: toLngLat(initialEditablePosition), zoom: 16 }
      : viewForLocations(latestLocationsRef.current);
    currentCenterRef.current = initialView.center;
    currentZoomRef.current = initialView.zoom;

    const map = new maps.YMap(container, {
      location: initialView,
      behaviors: ["drag", "scrollZoom", "dblClick", "pinchZoom"],
    });
    mapRef.current = map;
    map.addChild(new maps.YMapDefaultSchemeLayer({}));
    map.addChild(new maps.YMapDefaultFeaturesLayer({}));

    const listener = new maps.YMapListener({
      layer: "any",
      onClick: (object, event) => {
        if (!onPositionInputRef.current || object?.type === "marker") return;
        void resolvePosition(fromLngLat(event.coordinates));
      },
      onUpdate: (event) => {
        if (event.location?.center) currentCenterRef.current = event.location.center;
        if (typeof event.location?.zoom === "number") currentZoomRef.current = event.location.zoom;
      },
    });
    map.addChild(listener);

    syncRef.current = () => {
      const currentMap = mapRef.current;
      const currentMaps = window.ymaps3;
      if (!currentMap || !currentMaps) return;

      for (const marker of locationMarkersRef.current) currentMap.removeChild(marker);
      locationMarkersRef.current = [];
      const currentLocations = latestLocationsRef.current;
      const currentSelectedId = latestSelectedIdRef.current;
      const locationKey = [...currentLocations]
        .sort((left, right) => left.id - right.id)
        .map((location) => `${location.id}:${location.latitude}:${location.longitude}`)
        .join("|");

      currentLocations.forEach((location) => {
        const element = createLocationMarkerElement(location, location.id === currentSelectedId);
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          onSelectRef.current?.(location);
        });
        const marker = new currentMaps.YMapMarker({
          coordinates: toLngLat(location),
          zIndex: location.id === currentSelectedId ? 1800 : 1000,
        }, element);
        currentMap.addChild(marker);
        locationMarkersRef.current.push(marker);
      });

      const currentEditablePosition = latestEditablePositionRef.current;
      if (hasValidCoordinates(currentEditablePosition) && currentEditablePosition) {
        const coordinates = toLngLat(currentEditablePosition);
        if (!editMarkerRef.current) {
          const marker: YandexMapEntity = new currentMaps.YMapMarker({
            coordinates,
            draggable: true,
            mapFollowsOnDrag: true,
            zIndex: 2500,
            onDragMove: (nextCoordinates) => marker.update({ coordinates: nextCoordinates }),
            onDragEnd: (nextCoordinates) => {
              marker.update({ coordinates: nextCoordinates });
              void resolvePosition(fromLngLat(nextCoordinates));
            },
          }, createEditMarkerElement());
          editMarkerRef.current = marker;
          currentMap.addChild(marker);
        } else {
          editMarkerRef.current.update({ coordinates });
        }

        const editableKey = `${currentEditablePosition.latitude}:${currentEditablePosition.longitude}`;
        if (editableKey !== previousEditablePositionRef.current) {
          updateCamera(coordinates, Math.max(currentZoomRef.current, 15));
          previousEditablePositionRef.current = editableKey;
        }
      } else if (editMarkerRef.current) {
        currentMap.removeChild(editMarkerRef.current);
        editMarkerRef.current = null;
        previousEditablePositionRef.current = "";
      }

      if (!onPositionInputRef.current && currentLocations.length > 0) {
        if (locationKey !== previousLocationKeyRef.current) {
          const view = viewForLocations(currentLocations);
          updateCamera(view.center, view.zoom);
        }
      }

      previousLocationKeyRef.current = locationKey;
    };

    syncRef.current();

    return () => {
      syncRef.current = null;
      locationMarkersRef.current = [];
      editMarkerRef.current = null;
      userMarkerRef.current = null;
      map.destroy();
      mapRef.current = null;
      previousLocationKeyRef.current = "";
      selectedFocusKeyRef.current = "";
      previousEditablePositionRef.current = "";
    };
  }, [apiReady, resolvePosition, updateCamera]);

  useEffect(() => {
    if (!apiReady || onPositionInput || selectedId === null) return;
    const selected = validLocations.find((location) => location.id === selectedId);
    if (!selected) return;
    const focusKey = `${selected.id}:${selected.latitude}:${selected.longitude}`;
    if (focusKey === selectedFocusKeyRef.current) return;
    selectedFocusKeyRef.current = focusKey;
    updateCamera(
      toLngLat(selected),
      Math.max(currentZoomRef.current, SELECTED_LOCATION_ZOOM),
      SELECTED_LOCATION_TRANSITION_MS,
    );
  }, [apiReady, onPositionInput, selectedId, updateCamera, validLocations]);

  const changeZoom = (difference: number) => {
    const nextZoom = Math.min(20, Math.max(2, currentZoomRef.current + difference));
    updateCamera(currentCenterRef.current, nextZoom, 180);
  };

  const locateUser = () => {
    const maps = window.ymaps3;
    const map = mapRef.current;
    if (!navigator.geolocation || !maps || !map) {
      setGeoMessage("Не удалось запустить определение местоположения.");
      return;
    }
    setGeoMessage("Определяем ваше местоположение…");
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (!mountedRef.current || !mapRef.current || !window.ymaps3) return;
      const userPosition = { latitude: coords.latitude, longitude: coords.longitude };
      if (userMarkerRef.current) mapRef.current.removeChild(userMarkerRef.current);
      const marker = new window.ymaps3.YMapMarker({ coordinates: toLngLat(userPosition), zIndex: 2200 }, createUserMarkerElement());
      userMarkerRef.current = marker;
      mapRef.current.addChild(marker);
      onUserPositionRef.current?.(userPosition);

      const nearest = latestLocationsRef.current.reduce<PickupLocation | null>((closest, location) => {
        if (!closest) return location;
        return distanceInKilometers(userPosition, location) < distanceInKilometers(userPosition, closest) ? location : closest;
      }, null);
      if (nearest && latestSelectedIdRef.current === null) {
        onSelectRef.current?.(nearest);
        updateCamera(toLngLat(nearest), 16);
        setGeoMessage(`Ближайшая точка: ${nearest.name}`);
      } else {
        updateCamera(toLngLat(userPosition), Math.max(currentZoomRef.current, 14));
        setGeoMessage("Местоположение найдено.");
      }
    }, () => {
      if (mountedRef.current) setGeoMessage("Не удалось определить местоположение. Проверьте разрешение браузера.");
    }, {
      enableHighAccuracy: true,
      maximumAge: 60000,
      timeout: 10000,
    });
  };

  const handleAddressKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    void findAddress(event.currentTarget.value);
  };

  const mapLink = selectedLocation
    ? `https://yandex.ru/maps/?pt=${selectedLocation.longitude},${selectedLocation.latitude}&z=16&l=map`
    : "https://yandex.ru/maps/";

  const configurationError = !YANDEX_MAPS_API_KEY
    ? "Добавьте ключ JavaScript API Яндекс Карт, чтобы карта заработала."
    : loadError;
  const editorEnabled = Boolean(onPositionInput && onAddressInput);

  return (
    <div className={`pickup-map-shell yandex-map-shell ${editorEnabled ? "is-editor" : ""} ${className}`.trim()}>
      {YANDEX_MAPS_API_KEY ? (
        <Script
          id="yandex-maps-api-v3"
          src={yandexMapsScriptUrl()}
          strategy="afterInteractive"
          onReady={() => void handleApiReady()}
          onError={() => setLoadError("Не удалось загрузить Яндекс Карты. Проверьте API-ключ и ограничение домена.")}
        />
      ) : null}
      <div className="pickup-map-canvas" ref={containerRef} role="region" aria-label={ariaLabel} />
      {configurationError ? <div className="pickup-map-error" role="alert">{configurationError}</div> : null}
      {!configurationError && !apiReady ? <div className="pickup-map-loading" role="status">Загрузка Яндекс Карт…</div> : null}
      {editorEnabled ? (
        <div className="pickup-map-address-search" role="search">
          <input
            value={editableAddress}
            onChange={(event) => onAddressInput?.(event.target.value)}
            onKeyDown={handleAddressKeyDown}
            disabled={searchingAddress}
            placeholder="Иркутск, улица, дом"
            aria-label="Адрес точки для поиска на карте"
          />
          <button type="button" onClick={() => void findAddress()} disabled={!apiReady || searchingAddress}>
            {searchingAddress ? "Ищем…" : "Найти"}
          </button>
        </div>
      ) : null}
      {apiReady ? (
        <div className="pickup-map-zoom" aria-label="Масштаб карты">
          <button type="button" onClick={() => changeZoom(1)} aria-label="Приблизить">+</button>
          <button type="button" onClick={() => changeZoom(-1)} aria-label="Отдалить">−</button>
        </div>
      ) : null}
      {!editorEnabled ? <button className="pickup-map-locate" type="button" onClick={locateUser} aria-label="Показать моё местоположение">◎</button> : null}
      {!editorEnabled ? <a className="pickup-map-open" href={mapLink} target="_blank" rel="noreferrer">Открыть в Яндекс Картах</a> : null}
      {!editorEnabled && geoMessage ? <p className="pickup-map-geostatus" role="status" aria-live="polite">{geoMessage}</p> : null}
      {editorEnabled && addressMessage ? <p className="pickup-map-address-status" role="status" aria-live="polite">{addressMessage}</p> : null}
      {editorEnabled ? <p className="pickup-map-editor-hint">Введите адрес, нажмите на карту или перетащите красную метку</p> : null}
    </div>
  );
}
