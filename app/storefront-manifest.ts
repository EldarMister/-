import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ДААНА СУШИ — меню и самовывоз",
    short_name: "ДААНА СУШИ",
    description: "Онлайн-меню и оформление заказов ДААНА СУШИ.",
    start_url: "/catalog/1",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#e60000",
    lang: "ru-KG",
    icons: [
      { src: "/assets/icons/favicon.ico", sizes: "any", type: "image/x-icon" },
    ],
  };
}
