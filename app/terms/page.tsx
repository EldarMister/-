import type { Metadata } from "next";
import { InfoPage } from "../components/InfoPage";
import { TermsOfUse } from "../LegalContent";
import { createPageMetadata } from "../seo";

export const metadata: Metadata = createPageMetadata({
  title: "Условия использования и заказа",
  description: "Условия заказа, оплаты при получении, начисления и вывода NAKTA Coin и NFT в ДААНА СУШИ.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <InfoPage title="Условия использования и заказа">
      <TermsOfUse showTitle={false} />
    </InfoPage>
  );
}
