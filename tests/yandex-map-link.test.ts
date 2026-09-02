import assert from "node:assert/strict";
import test from "node:test";
import { coordinatesFromYandexMapUrl, resolveYandexMapLink, YandexMapLinkError } from "../server/yandex-map-link";

test("extracts longitude and latitude from a regular Yandex Maps link", () => {
  assert.deepEqual(
    coordinatesFromYandexMapUrl("https://yandex.ru/maps/63/irkutsk/?ll=104.2898%2C52.2689&z=17"),
    { latitude: 52.2689, longitude: 104.2898 },
  );
});

test("extracts coordinates from a what-is-here link", () => {
  assert.deepEqual(
    coordinatesFromYandexMapUrl("https://yandex.ru/maps/?whatshere%5Bpoint%5D=74.6122%2C42.8746&whatshere%5Bzoom%5D=17"),
    { latitude: 42.8746, longitude: 74.6122 },
  );
});

test("resolves a short Yandex Maps redirect without following foreign hosts", async () => {
  const fetcher = async () => new Response(null, {
    status: 302,
    headers: { location: "https://yandex.ru/maps/?ll=74.6122%2C42.8746&z=16" },
  });
  assert.deepEqual(
    await resolveYandexMapLink("https://yandex.ru/maps/-/example", fetcher as typeof fetch),
    { latitude: 42.8746, longitude: 74.6122 },
  );
});

test("rejects non-Yandex links", () => {
  assert.throws(
    () => coordinatesFromYandexMapUrl("https://example.com/?ll=74.6122,42.8746"),
    (error) => error instanceof YandexMapLinkError && error.status === 400,
  );
});
