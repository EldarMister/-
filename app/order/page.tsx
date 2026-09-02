import type { Metadata } from "next";
import SushiApp from "../SushiApp";
import { createPageMetadata } from "../seo";

export const metadata: Metadata = createPageMetadata({ title: "Корзина и оформление заказа", description: "Проверьте корзину, выберите точку и время самовывоза и оформите заказ в ДААНА СУШИ.", path: "/order", index: false });

export default function OrderPage() {
  return <SushiApp initialView="order" />;
}
