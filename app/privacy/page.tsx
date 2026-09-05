import type { Metadata } from "next";
import { InfoPage } from "../components/InfoPage";
import { PrivacyPolicy } from "../LegalContent";
import { createPageMetadata } from "../seo";

export const metadata: Metadata = createPageMetadata({
  title: "Политика конфиденциальности",
  description: "Как ДААНА СУШИ обрабатывает данные аккаунта, заказов, геолокации, NAKTA Coin, NFT и заявок на вывод.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <InfoPage title="Политика конфиденциальности">
      <PrivacyPolicy showTitle={false} />
    </InfoPage>
  );
}
