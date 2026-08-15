import type { Metadata } from "next";
import SushiApp from "../SushiApp";

export const metadata: Metadata = { title: "Акции" };

export default function PromoPage() {
  return <SushiApp initialView="promo" />;
}

