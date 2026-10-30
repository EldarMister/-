export const languages = [
  { code: "ky", name: "Кыргызча", short: "KY", tag: "ky-KG" },
  { code: "ru", name: "Русский", short: "RU", tag: "ru-KG" },
  { code: "en", name: "English", short: "EN", tag: "en-GB" },
  { code: "kk", name: "Қазақша", short: "KK", tag: "kk-KZ" },
  { code: "uz", name: "O‘zbekcha", short: "UZ", tag: "uz-UZ" },
] as const;

export type Locale = typeof languages[number]["code"];
export const DEFAULT_LOCALE: Locale = "ru";
export const LANGUAGE_COOKIE = "daana-language";
export const LANGUAGE_STORAGE_KEY = "daana-language";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && languages.some((language) => language.code === value);
}

export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function localeTag(locale: Locale) {
  return languages.find((language) => language.code === locale)!.tag;
}
