import type { Metadata } from "next";
import SushiApp from "../SushiApp";
import { createPageMetadata } from "../seo";

export const metadata: Metadata = createPageMetadata({ title: "Политика обработки персональных данных", description: "Политика обработки и защиты персональных данных пользователей сайта ДААНА СУШИ и сведения об операторе сервиса.", path: "/privacy" });

export default function PrivacyPage() {
  return <SushiApp initialView="privacy" />;
}
