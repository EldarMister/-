import type { Metadata } from "next";
import SushiApp from "../SushiApp";
import { createPageMetadata } from "../seo";

export const metadata: Metadata = createPageMetadata({
  title: "Акции и скидки",
  description: "Актуальные акции ДААНА СУШИ: скидки для именинников и выгодные предложения на роллы, наборы и другие блюда.",
  path: "/promo",
});

export default function PromoPage() {
  return <SushiApp initialView="promo" />;
}
