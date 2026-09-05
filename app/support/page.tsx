import type { Metadata } from "next";
import { InfoPage } from "../components/InfoPage";
import { LegalOperatorDetails } from "../components/LegalOperatorDetails";
import { LEGAL_DETAILS } from "../legalDetails";
import { createPageMetadata } from "../seo";

export const metadata: Metadata = createPageMetadata({
  title: "Поддержка",
  description: "Связь с поддержкой ДААНА СУШИ по заказам, данным, NAKTA Coin, NFT и выводу наград.",
  path: "/support",
});

export default function SupportPage() {
  return (
    <InfoPage
      title="Поддержка"
      action={{ label: "Открыть чат поддержки", href: LEGAL_DETAILS.supportUrl }}
    >
      <p>Поможем с заказом, оплатой при получении, входом в аккаунт, NAKTA Coin, NFT, выводом наград и запросами о персональных данных.</p>

      <h2>Как обратиться</h2>
      <p>Напишите в <a href={LEGAL_DETAILS.supportUrl}>чат поддержки в Telegram</a>. Для быстрого поиска заказа укажите его номер и телефон, с которого он был оформлен.</p>
      <p>Поддержка никогда не просит сообщить одноразовый SMS-код, полный номер банковской карты, CVV/CVC-код, приватный ключ или seed-фразу криптокошелька.</p>

      <h2>Оператор сервиса</h2>
      <LegalOperatorDetails />
    </InfoPage>
  );
}
