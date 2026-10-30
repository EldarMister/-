"use client";

import { useCallback } from "react";
import { useLanguage } from "../i18n/LanguageProvider";
import { languages, localeTag, type Locale } from "../i18n/locales";
import { translate } from "../i18n/translate";
import dictionary from "./messages.json";

const indexes: Record<Exclude<Locale, "ru">, number> = { ky: 0, en: 1, kk: 2, uz: 3 };
export const adminMessages: Record<string, string[]> = dictionary;
const templates = Object.keys(adminMessages).filter((source) => /\{[a-zA-Z0-9_]+\}/.test(source)).map((source) => ({
  source,
  names: [...source.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]),
  pattern: new RegExp(`^${source.split(/\{[a-zA-Z0-9_]+\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.+?)")}$`),
}));
export function translateAdmin(source: string, locale: Locale, vars?: Record<string, string | number>): string {
  if (typeof source !== "string" || !source) return "";
  const key = source.replace(/\s+/g, " ").trim();
  let translated = locale === "ru" ? source : adminMessages[key]?.[indexes[locale]] ?? translate(source, locale);
  let values = vars;
  if (locale !== "ru" && !adminMessages[key] && translated === source) {
    for (const template of templates) {
      const match = key.match(template.pattern);
      if (!match) continue;
      translated = adminMessages[template.source][indexes[locale]];
      values = Object.fromEntries(template.names.map((name, index) => [name, match[index + 1]]));
      break;
    }
  }
  // Captured values are kept verbatim: customer text, product names and numbers are never translated.
  const result = translated.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => values && Object.hasOwn(values, name) ? String(values[name]) : match);
  return `${/^\s/.test(source) && !/^\s/.test(result) ? " " : ""}${result}${/\s$/.test(source) && !/\s$/.test(result) ? " " : ""}`;
}

export function useAdminLanguage() {
  const { locale, setLocale } = useLanguage();
  const t = useCallback((source: string, vars?: Record<string, string | number>) => translateAdmin(source, locale, vars), [locale]);
  const formatNumber = useCallback((value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(localeTag(locale), options).format(Number(value || 0)), [locale]);
  const formatDate = useCallback((value: string | number | Date, options?: Intl.DateTimeFormatOptions) => {
    const input = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+06:00` : value;
    const date = new Date(input);
    return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat(localeTag(locale), { dateStyle: options ? undefined : "medium", timeZone: "Asia/Bishkek", ...options }).format(date);
  }, [locale]);
  return { t, locale, setLocale, formatNumber, formatDate };
}

export function AdminLanguageSwitcher() {
  const { t, locale, setLocale } = useAdminLanguage();
  return <label className="admin-language-switcher"><span className="sr-only">{t("Язык интерфейса")}</span><select aria-label={t("Язык интерфейса")} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>{languages.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}</select></label>;
}
