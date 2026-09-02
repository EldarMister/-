export type YandexMapPosition = { latitude: number; longitude: number };

const allowedYandexDomains = ["yandex.ru", "yandex.com", "yandex.kz", "yandex.uz", "yandex.by", "yandex.com.tr"];
const coordinateParameters = ["ll", "sll", "pt", "whatshere[point]"];
const maximumRedirects = 5;
const maximumLinkLength = 2_048;

export class YandexMapLinkError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function isYandexHost(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return allowedYandexDomains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

function parseYandexUrl(value: string, base?: URL) {
  let url: URL;
  try {
    url = base ? new URL(value, base) : new URL(value);
  } catch {
    throw new YandexMapLinkError(400, "Вставьте корректную ссылку из Яндекс Карт");
  }
  if (url.protocol !== "https:" || !isYandexHost(url.hostname)) {
    throw new YandexMapLinkError(400, "Разрешены только HTTPS-ссылки Яндекс Карт");
  }
  return url;
}

function parseCoordinatePair(value: string | null): YandexMapPosition | null {
  if (!value) return null;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,~]\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const longitude = Number(match[1]);
  const latitude = Number(match[2]);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function coordinatesFromParameters(parameters: URLSearchParams) {
  for (const name of coordinateParameters) {
    const coordinates = parseCoordinatePair(parameters.get(name));
    if (coordinates) return coordinates;
  }
  return null;
}

export function coordinatesFromYandexMapUrl(value: string): YandexMapPosition | null {
  if (!value.trim() || value.length > maximumLinkLength) throw new YandexMapLinkError(400, "Ссылка Яндекс Карт слишком длинная или пустая");
  const url = parseYandexUrl(value.trim());
  const directCoordinates = coordinatesFromParameters(url.searchParams);
  if (directCoordinates) return directCoordinates;

  const hash = url.hash.replace(/^#/, "");
  if (hash) {
    const hashCoordinates = coordinatesFromParameters(new URLSearchParams(hash));
    if (hashCoordinates) return hashCoordinates;
  }
  return null;
}

function linkedUrlsFromHtml(html: string, currentUrl: URL) {
  const urls: URL[] = [];
  const tagPattern = /<(?:meta|link)\b[^>]*(?:content|href)=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(tagPattern)) {
    const value = match[1].replaceAll("&amp;", "&");
    try {
      urls.push(parseYandexUrl(value, currentUrl));
    } catch {
      // Ignore unrelated metadata URLs such as images and application links.
    }
  }
  return urls;
}

export async function resolveYandexMapLink(value: string, fetcher: typeof fetch = fetch): Promise<YandexMapPosition> {
  let currentUrl = parseYandexUrl(value.trim());

  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
    const directCoordinates = coordinatesFromYandexMapUrl(currentUrl.toString());
    if (directCoordinates) return directCoordinates;

    let response: Response;
    try {
      response = await fetcher(currentUrl, {
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "DAANA-SUSHI-Map-Link-Resolver/1.0",
        },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new YandexMapLinkError(502, "Не удалось открыть ссылку Яндекс Карт");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new YandexMapLinkError(422, "Яндекс Карты не вернули адрес перенаправления");
      currentUrl = parseYandexUrl(location, currentUrl);
      continue;
    }
    if (!response.ok) throw new YandexMapLinkError(502, "Яндекс Карты не смогли открыть эту ссылку");

    const responseUrl = response.url ? parseYandexUrl(response.url, currentUrl) : currentUrl;
    const responseCoordinates = coordinatesFromYandexMapUrl(responseUrl.toString());
    if (responseCoordinates) return responseCoordinates;

    const html = await response.text();
    for (const linkedUrl of linkedUrlsFromHtml(html.slice(0, 1_500_000), responseUrl)) {
      const linkedCoordinates = coordinatesFromYandexMapUrl(linkedUrl.toString());
      if (linkedCoordinates) return linkedCoordinates;
    }
    break;
  }

  throw new YandexMapLinkError(422, "В ссылке не удалось найти координаты. Откройте точку в Яндекс Картах и скопируйте ссылку через «Поделиться»");
}
