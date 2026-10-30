import storefront from "./messages/storefront.json";
import catalog from "./messages/catalog.json";
import legal from "./messages/legal.json";
import information from "./messages/information.json";
import api from "./messages/api.json";
import productDetails from "./messages/product-details.json";
import { type Locale } from "./locales";

type Dictionary = Record<string, string[]>;
export const messages: Dictionary = { ...storefront, ...catalog, ...legal, ...information, ...api, ...productDetails };
const indexes: Record<Exclude<Locale, "ru">, number> = { ky: 0, en: 1, kk: 2, uz: 3 };
const templates = Object.keys(messages).filter((key) => /\{\d+\}/.test(key)).map((key) => ({
  key,
  pattern: new RegExp(`^${key.split(/\{\d+\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.+?)")}$`),
}));

/** Only display strings are translated. Unknown, user-authored content stays intact. */
export function translate(source: string, locale: Locale): string {
  if (locale === "ru" || !source) return source;
  const key = source.replace(/\s+/g, " ").trim();
  const index = indexes[locale];
  let result = messages[key]?.[index];
  if (result === undefined) {
    for (const template of templates) {
      const match = key.match(template.pattern);
      if (!match) continue;
      result = messages[template.key][index].replace(/\{(\d+)\}/g, (_, position: string) => translate(match[Number(position) + 1], locale));
      break;
    }
  }
  if (result === undefined) return source;
  return `${/^\s/.test(source) ? " " : ""}${result}${/\s$/.test(source) ? " " : ""}`;
}
