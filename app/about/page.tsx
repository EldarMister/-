import TranslatedText from "../i18n/TranslatedText";
import type { Metadata } from "next";
import { InfoPage } from "../components/InfoPage";
import { LegalOperatorDetails } from "../components/LegalOperatorDetails";
import { createPageMetadata } from "../seo";

export const metadata: Metadata = createPageMetadata({
  title: "О нас",
  description: "Информация о сервисе ДААНА СУШИ, заказах и программе наград.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <InfoPage title="О нас">
      <p><TranslatedText source={"ДААНА СУШИ — сервис заказа суши и роллов с самовывозом."} /></p>
      <p><TranslatedText source={"За завершённые заказы участникам программы наград могут начисляться Bonus DAANA Coin и цифровые награды NFT. Награды доступны в личном кабинете и могут быть выведены на совместимый криптокошелёк."} /></p>
      <h2><TranslatedText source={"Оператор сервиса"} /></h2>
      <LegalOperatorDetails />
      <p><TranslatedText source={"Условия заказа, обработки данных и программы наград собраны в разделе "} /><a href="/legal"><TranslatedText source={"«Правовая информация»"} /></a>.</p>
    </InfoPage>
  );
}
