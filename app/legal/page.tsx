import TranslatedText from "../i18n/TranslatedText";
import type { Metadata } from "next";
import { InfoPage } from "../components/InfoPage";
import { LegalOperatorDetails } from "../components/LegalOperatorDetails";
import { createPageMetadata } from "../seo";

export const metadata: Metadata = createPageMetadata({
  title: "Правовая информация",
  description: "Реквизиты оператора и документы сайта ДААНА СУШИ.",
  path: "/legal",
});

export default function LegalPage() {
  return (
    <InfoPage title="Правовая информация">
      <p><TranslatedText source={"Здесь собраны реквизиты и документы сайта ДААНА СУШИ."} /></p>
      <h2><TranslatedText source={"Реквизиты оператора сервиса"} /></h2>
      <LegalOperatorDetails />
      <ul className="legal-document-list">
        <li><a href="/privacy"><strong><TranslatedText source={"Политика конфиденциальности"} /></strong></a><br /><TranslatedText source={"Какие данные используются для входа, заказа, карты, NAKTA Coin, NFT и вывода наград."} /></li>
        <li><a href="/terms"><strong><TranslatedText source={"Условия использования и заказа"} /></strong></a><br /><TranslatedText source={"Правила заказа, начисления и вывода NAKTA Coin и NFT."} /></li>
        <li><a href="/payment-rule"><strong><TranslatedText source={"Оплата, отмена и возврат"} /></strong></a><br /><TranslatedText source={"Оплата при получении, изменение заказа и обращение по качеству."} /></li>
        <li><a href="/delete-account"><strong><TranslatedText source={"Удаление аккаунта и данных"} /></strong></a><br /><TranslatedText source={"Как направить запрос и какие сведения могут сохраняться."} /></li>
      </ul>
      <h2><TranslatedText source={"Обращения"} /></h2>
      <p><TranslatedText source={"По вопросам данных, заказа, оплаты и наград обратитесь в "} /><a href="/support"><TranslatedText source={"поддержку ДААНА СУШИ"} /></a>.</p>
    </InfoPage>
  );
}
