import type { Metadata } from "next";
import "./globals.css";
import { LEGAL_DETAILS } from "./legalDetails";
import { DEFAULT_DESCRIPTION, SITE_NAME, SITE_URL, SOCIAL_IMAGE } from "./seo";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: { default: `${SITE_NAME} — роллы, наборы и онигири`, template: `%s | ${SITE_NAME}` },
  description: DEFAULT_DESCRIPTION,
  keywords: ["суши", "роллы", "наборы роллов", "онигири", "суширрито", "самовывоз", "заказать суши", SITE_NAME, "Daana Sushi"],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: LEGAL_DETAILS.operator,
  category: "food",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/assets/icons/favicon.ico", shortcut: "/assets/icons/favicon.ico" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  openGraph: {
    title: `${SITE_NAME} — роллы, наборы и онигири`,
    description: DEFAULT_DESCRIPTION,
    url: `${SITE_URL}/catalog/1`,
    siteName: SITE_NAME,
    locale: "ru_KG",
    images: [{ url: SOCIAL_IMAGE, width: 1200, height: 630, alt: `${SITE_NAME} — роллы, наборы и онигири` }],
    type: "website",
  },
  twitter: { card: "summary_large_image", title: `${SITE_NAME} — меню`, description: DEFAULT_DESCRIPTION, images: [SOCIAL_IMAGE] },
};

const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    alternateName: ["Даана Суши", "Daana Sushi"],
    inLanguage: "ru-KG",
    publisher: { "@id": `${SITE_URL}/#organization` },
  },
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    legalName: LEGAL_DETAILS.operator,
    url: SITE_URL,
    logo: `${SITE_URL}/assets/icons/favicon.ico`,
    image: SOCIAL_IMAGE,
    taxID: LEGAL_DETAILS.inn,
    identifier: { "@type": "PropertyValue", propertyID: "Регистрационный номер", value: LEGAL_DETAILS.registrationNumber },
    address: {
      "@type": "PostalAddress",
      streetAddress: "ул. Токтогула, дом 4",
      addressLocality: "с. Отуз-Адыр",
      addressRegion: "Ошская область, Кара-Суйский район",
      addressCountry: "KG",
    },
  },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru-KG">
      <body>
        {children}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      </body>
    </html>
  );
}
