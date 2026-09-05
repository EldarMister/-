import type { MetadataRoute } from "next";
import { categories } from "./data";
import { SITE_URL } from "./seo";

const lastModified = new Date("2026-09-05T00:00:00+06:00");

export default function sitemap(): MetadataRoute.Sitemap {
  const categoryPages: MetadataRoute.Sitemap = categories
    .filter((category) => category.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category, index) => ({
      url: `${SITE_URL}/catalog/${category.id}`,
      lastModified,
      changeFrequency: "daily",
      priority: index === 0 ? 1 : 0.9,
    }));

  return [
    ...categoryPages,
    { url: `${SITE_URL}/promo`, lastModified, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/legal`, lastModified, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/privacy`, lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/terms`, lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/payment-rule`, lastModified, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/delete-account`, lastModified, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/support`, lastModified, changeFrequency: "monthly", priority: 0.5 },
  ];
}
