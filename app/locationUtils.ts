import type { PickupLocation } from "./types";

type Coordinates = Pick<PickupLocation, "latitude" | "longitude">;

export type MapPosition = Coordinates;

export type LocationGeocodeResult = MapPosition & {
  address: string;
};

export function hasValidCoordinates(position: MapPosition | null | undefined) {
  return Boolean(
    position
    && Number.isFinite(position.latitude)
    && Number.isFinite(position.longitude)
    && position.latitude >= -90
    && position.latitude <= 90
    && position.longitude >= -180
    && position.longitude <= 180,
  );
}

export function distanceInKilometers(from: Coordinates, to: Coordinates) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadius = 6371;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(a));
}

export function pickupStatus(location: PickupLocation, now = new Date()) {
  const match = location.hours.match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
  if (!match) return { label: "часы работы", time: location.hours };

  const opening = Number(match[1]) * 60 + Number(match[2]);
  const closing = Number(match[3]) * 60 + Number(match[4]);
  const current = now.getHours() * 60 + now.getMinutes();
  const isOpen = closing > opening
    ? current >= opening && current < closing
    : current >= opening || current < closing;

  return isOpen
    ? { label: "открыто до", time: `${match[3].padStart(2, "0")}:${match[4]}` }
    : { label: "закрыто до", time: location.opensAt || `${match[1].padStart(2, "0")}:${match[2]}` };
}
