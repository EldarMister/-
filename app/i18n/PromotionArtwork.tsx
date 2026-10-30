"use client";

import { useLanguage } from "./LanguageProvider";
import Localized from "./Localized";

export default function PromotionArtwork({ image, title, description }: { image: string; title: string; description: string }) {
  const { locale, t } = useLanguage();
  if (locale === "ru") return <img src={image} alt={title} />;
  return <Localized><span className="translated-promotion" role="img" aria-label={`${t(title)}. ${t(description)}`}>
    <span className="translated-promotion-copy"><strong>{title}</strong><span>{description}</span><small translate="no">DAANA SUSHI</small></span>
    <img className="translated-promotion-image" src="/assets/products/1735210545313.webp" alt="" />
  </span></Localized>;
}
