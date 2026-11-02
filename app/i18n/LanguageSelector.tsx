"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { languages } from "./locales";
import { useLanguage } from "./LanguageProvider";

export default function LanguageSelector({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const { locale, setLocale, t } = useLanguage();
  const id = useId();
  const dropdown = useRef<HTMLDetailsElement>(null);
  const current = languages.find((language) => language.code === locale)!;
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !dropdown.current?.contains(event.target) && dropdown.current) dropdown.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  const closeOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && dropdown.current?.open) {
      event.preventDefault();
      dropdown.current.open = false;
      dropdown.current.querySelector("summary")?.focus();
    }
  };
  return <details ref={dropdown} className={`language-selector ${compact ? "is-compact" : ""} ${className}`} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
  }}>
    <summary aria-label={`${t("Язык сайта")}: ${current.name}`} aria-controls={id} onKeyDown={closeOnEscape}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></svg>
      <span lang={current.tag}>{compact ? current.short : current.name}</span>
      <svg className="language-chevron" aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m5 7 5 5 5-5" /></svg>
    </summary>
    <ul id={id} className="language-options" aria-label={t("Язык сайта")}>
      {languages.map((language) => <li key={language.code}><button type="button" lang={language.tag} aria-pressed={locale === language.code} onKeyDown={closeOnEscape} onClick={() => {
        setLocale(language.code);
        if (dropdown.current) {
          dropdown.current.open = false;
          dropdown.current.querySelector("summary")?.focus();
        }
      }}><span className="language-option-code">{language.short}</span><span>{language.name}</span><span className="language-check" aria-hidden="true">{locale === language.code ? "✓" : ""}</span></button></li>)}
    </ul>
  </details>;
}
