import type { Metadata } from "next";
import SushiApp from "../SushiApp";
import { createPageMetadata } from "../seo";

export const metadata: Metadata = createPageMetadata({ title: "Правила оплаты и реквизиты", description: "Инструкция по оплате заказа на сайте ДААНА СУШИ, условия возврата и юридические реквизиты оператора сервиса.", path: "/payment-rule" });

export default function PaymentRulePage() {
  return <SushiApp initialView="payment" />;
}
