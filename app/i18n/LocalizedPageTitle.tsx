"use client";

import { useEffect } from "react";
import { useLanguage } from "./LanguageProvider";

export default function LocalizedPageTitle({ title }: { title: string }) {
  const { locale, t } = useLanguage();
  useEffect(() => {
    // Streamed route metadata can still contain a <title> in the body while hydrating.
    // Update only the actual head title so that its server placeholder stays intact.
    const updateTitle = () => {
      const element = document.head.querySelector("title");
      if (!element) return false;
      element.textContent = `${t(title)} | ${t("ДААНА СУШИ")}`;
      return true;
    };
    if (updateTitle()) return;
    const observer = new MutationObserver(() => { if (updateTitle()) observer.disconnect(); });
    observer.observe(document.head, { childList: true });
    return () => observer.disconnect();
  }, [locale, t, title]);
  return null;
}
