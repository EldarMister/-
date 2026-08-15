import SushiApp from "../../SushiApp";

export default async function CatalogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const categoryId = Number(id);
  return <SushiApp initialCategoryId={Number.isFinite(categoryId) ? categoryId : 1} />;
}

