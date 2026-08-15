import type { Metadata } from "next";
import SushiApp from "../SushiApp";

export const metadata: Metadata = { title: "Корзина" };

export default function OrderPage() {
  return <SushiApp initialView="order" />;
}
