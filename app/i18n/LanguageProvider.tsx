"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, isLocale, LANGUAGE_COOKIE, LANGUAGE_STORAGE_KEY, localeTag, type Locale } from "./locales";
import { translate } from "./translate";

type LanguageContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (source: string) => string };
const LanguageContext = createContext<LanguageContextValue>({ locale: DEFAULT_LOCALE, setLocale: () => {}, t: (source) => source });

export function LanguageProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, updateLocale] = useState(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    updateLocale(next);
    document.documentElement.lang = localeTag(next);
    try { document.cookie = `${LANGUAGE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; } catch { /* Local storage remains a fallback when cookies are blocked. */ }
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Cookie persistence still works if storage is blocked. */ }
  }, []);
  useEffect(() => {
    let timer: number | undefined;
    if (!document.cookie.split("; ").some((entry) => entry.startsWith(`${LANGUAGE_COOKIE}=`))) {
      try {
        const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (isLocale(saved)) timer = window.setTimeout(() => setLocale(saved), 0);
      } catch { /* Use the server locale when storage is unavailable. */ }
    }
    const sync = (event: StorageEvent) => { if (event.key === LANGUAGE_STORAGE_KEY && isLocale(event.newValue)) setLocale(event.newValue); };
    window.addEventListener("storage", sync);
    return () => { window.clearTimeout(timer); window.removeEventListener("storage", sync); };
  }, [setLocale]);
  const t = useCallback((source: string) => translate(source, locale), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() { return useContext(LanguageContext); }
