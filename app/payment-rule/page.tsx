import type { Metadata } from "next";
import { InfoPage } from "../components/InfoPage";
import { PaymentRules } from "../LegalContent";
import { createPageMetadata } from "../seo";

export const metadata: Metadata = createPageMetadata({
  title: "Оплата, отмена и возврат",
  description: "Как оформить и оплатить заказ ДААНА СУШИ при получении, отменить его или сообщить о проблеме.",
  path: "/payment-rule",
});

export default function PaymentRulePage() {
  return (
    <InfoPage title="Оплата, отмена и возврат">
      <PaymentRules showTitle={false} />
    </InfoPage>
  );
}
