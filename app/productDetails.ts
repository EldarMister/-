import reference from "./product-details.json";
import type { Product } from "./types";

export type ProductDetails = Required<Pick<Product, "ingredients" | "serving" | "weight" | "weightUnit" | "calories" | "protein" | "fat" | "carbohydrates">>;
export const emptyProductDetails: ProductDetails = { ingredients: "", serving: "", weight: null, weightUnit: "г", calories: null, protein: null, fat: null, carbohydrates: null };
export const referenceProductDetails = reference as Record<string, ProductDetails & { name: string; image: string }>;

/** The reference is a dated import, never a live dependency or a name-based guess. */
export function initialProductDetails(product: Pick<Product, "id" | "name" | "image">): ProductDetails {
  const row = referenceProductDetails[product.id];
  if (!row || row.name !== product.name || row.image !== product.image) return { ...emptyProductDetails };
  return { ingredients: row.ingredients, serving: row.serving, weight: row.weight, weightUnit: row.weightUnit, calories: row.calories, protein: row.protein, fat: row.fat, carbohydrates: row.carbohydrates };
}

export function localizeProductIngredients(source: string, t: (value: string) => string) {
  return source.split(/(,\s*)/).map((part, index) => {
    if (index % 2 === 1) return part;
    const portion = part.trim().match(/^(.*?)\s*\((\d+)\s*шт\.\)$/);
    return portion ? `${t(portion[1].trim())} (${t(`${portion[2]} шт.`)})` : t(part.trim());
  }).join("");
}

export function productNutrition(product: Product, quantity: number) {
  const multiplier = Math.max(1, quantity);
  // Each supplied value is independent; missing values never become zeroes.
  return (["weight", "calories", "protein", "fat", "carbohydrates"] as const).flatMap((key) => {
    const value = product[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? [{ key, value: Math.round(value * multiplier * 100) / 100 }] : [];
  });
}
