import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ДААНА СУШИ — меню", template: "%s | ДААНА СУШИ" },
  description: "Роллы, наборы, онигири, напитки и самовывоз из ближайшей точки.",
  icons: { icon: "/assets/icons/favicon.ico", shortcut: "/assets/icons/favicon.ico" },
  openGraph: {
    title: "ДААНА СУШИ",
    description: "Выберите любимые роллы и заберите заказ в ближайшей точке.",
    images: ["/assets/promos/1766921524730.webp"],
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
