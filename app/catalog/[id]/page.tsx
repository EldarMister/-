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
  const title = category.id === 1
    ? "ДААНА СУШИ — роллы и суши на самовывоз"
    : `${category.name} — заказать онлайн`;
  return createPageMetadata({ title, description, path: `/catalog/${category.id}`, absoluteTitle: category.id === 1 });
}

export default async function CatalogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const categoryId = Number(id);
  const category = categories.find((item) => item.id === categoryId && item.active);
  if (!category) notFound();
  const categoryProducts = products.filter((product) => product.categoryId === categoryId && product.active);
  const canonical = `https://daanasushi.com/catalog/${categoryId}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${canonical}#webpage`,
    url: canonical,
    name: `${category.name} — ДААНА СУШИ`,
    isPartOf: { "@id": "https://daanasushi.com/#website" },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "ДААНА СУШИ", item: "https://daanasushi.com/catalog/1" },
        { "@type": "ListItem", position: 2, name: category.name, item: canonical },
      ],
    },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: categoryProducts.length,
      itemListElement: categoryProducts.map((product, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "Product",
          name: product.name,
          image: `https://daanasushi.com${product.image}`,
          category: category.name,
          offers: {
            "@type": "Offer",
            price: product.price,
            priceCurrency: "KGS",
            availability: "https://schema.org/InStock",
            url: canonical,
          },
        },
      })),
    },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      <SushiApp initialCategoryId={categoryId} />
    </>
  );
}
