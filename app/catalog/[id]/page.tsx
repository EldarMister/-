import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SushiApp from "../../SushiApp";
import { categories, products } from "../../data";
import { createPageMetadata } from "../../seo";

const categoryDescriptions: Record<number, string> = {
  1: "Выбирайте роллы ДААНА СУШИ: Филадельфия, Калифорния и другие любимые позиции. Актуальное меню, цены и удобный самовывоз.",
  2: "Онигири с лососем и креветкой в меню ДААНА СУШИ. Выберите блюда, ближайшую точку и оформите заказ на самовывоз онлайн.",
  3: "Наборы роллов ДААНА СУШИ для одного, двоих и компании. Сравните состав и цены, закажите онлайн и заберите в удобной точке.",
  4: "Напитки к роллам и наборам в меню ДААНА СУШИ. Добавьте напиток к заказу и заберите всё в выбранной точке самовывоза.",
  5: "Соусы, имбирь и другие дополнения к заказу в ДААНА СУШИ. Добавьте нужные позиции в корзину и оформите самовывоз.",
  7: "Суширрито ДААНА СУШИ — сытный формат с любимыми сочетаниями. Изучите меню, добавьте в корзину и выберите точку самовывоза.",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const category = categories.find((item) => item.id === Number(id) && item.active);
  if (!category) return createPageMetadata({ title: "Меню", description: "Меню ДААНА СУШИ.", path: `/catalog/${id}`, index: false });
  const names = products.filter((product) => product.categoryId === category.id && product.active).slice(0, 3).map((product) => product.name).join(", ");
  const description = categoryDescriptions[category.id] || `${category.name} в меню ДААНА СУШИ: ${names}. Актуальные цены и самовывоз из удобной точки.`;
  return createPageMetadata({ title: `${category.name} — заказать онлайн`, description, path: `/catalog/${category.id}` });
}

export default async function CatalogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const categoryId = Number(id);
  if (!categories.some((category) => category.id === categoryId && category.active)) notFound();
  return <SushiApp initialCategoryId={categoryId} />;
}
