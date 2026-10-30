"use client";

import { useLanguage } from "./LanguageProvider";

/** A string boundary for prose authored in a Server Component. */
export default function TranslatedText({ source }: { source: string }) {
  const { t } = useLanguage();
  return <>{t(source)}</>;
}
