"use client";

import { useId } from "react";
import { languages, type Locale } from "./locales";
import { useLanguage } from "./LanguageProvider";

export default function LanguageSelector({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const { locale, setLocale, t } = useLanguage();
  const id = useId();
  return <label className={`language-selector ${compact ? "is-compact" : ""} ${className}`} htmlFor={id}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></svg>
    <span className="visually-hidden">{t("Язык сайта")}</span>
    <select id={id} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
      {languages.map((language) => <option key={language.code} value={language.code} lang={language.tag}>{compact ? language.short : language.name}</option>)}
    </select>
  </label>;
}
