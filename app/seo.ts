import type { Metadata } from "next";

export const SITE_NAME = "ДААНА СУШИ";
export const SITE_URL = "https://daanasushi.com";
export const DEFAULT_DESCRIPTION = "Закажите роллы, наборы, онигири и напитки в ДААНА СУШИ. Выберите удобную точку самовывоза и оформите заказ онлайн.";
export const SOCIAL_IMAGE = `${SITE_URL}/og.png`;

type PageMetadataOptions = {
  title: string;
  description: string;
  path: string;
  index?: boolean;
};

export function createPageMetadata({ title, description, path, index = true }: PageMetadataOptions): Metadata {
  const canonical = new URL(path, SITE_URL).toString();
  const socialTitle = `${title} | ${SITE_NAME}`;
  return {
    title,
    description,
    alternates: { canonical },
    robots: index
      ? { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } }
      : { index: false, follow: false, googleBot: { index: false, follow: false } },
    openGraph: {
      title: socialTitle,
      description,
      url: canonical,
      siteName: SITE_NAME,
      locale: "ru_KG",
      type: "website",
      images: [{ url: SOCIAL_IMAGE, width: 1200, height: 630, alt: `${SITE_NAME} — роллы, наборы и онигири` }],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [SOCIAL_IMAGE],
    },
  };
}
