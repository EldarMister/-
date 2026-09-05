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
      <p>Здесь собраны реквизиты и документы сайта ДААНА СУШИ.</p>
      <h2>Реквизиты оператора сервиса</h2>
      <LegalOperatorDetails />
      <ul className="legal-document-list">
        <li><a href="/privacy"><strong>Политика конфиденциальности</strong></a><br />Какие данные используются для входа, заказа, карты, NAKTA Coin, NFT и вывода наград.</li>
        <li><a href="/terms"><strong>Условия использования и заказа</strong></a><br />Правила заказа, начисления и вывода NAKTA Coin и NFT.</li>
        <li><a href="/payment-rule"><strong>Оплата, отмена и возврат</strong></a><br />Оплата при получении, изменение заказа и обращение по качеству.</li>
        <li><a href="/delete-account"><strong>Удаление аккаунта и данных</strong></a><br />Как направить запрос и какие сведения могут сохраняться.</li>
      </ul>
      <h2>Обращения</h2>
      <p>По вопросам данных, заказа, оплаты и наград обратитесь в <a href="/support">поддержку ДААНА СУШИ</a>.</p>
    </InfoPage>
  );
}
