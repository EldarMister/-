import { emptyProductDetails, referenceProductDetails, type ProductDetails } from "../app/productDetails";
import { sql } from "./db";

export const productDetailColumns = sql`ingredients, serving, weight_unit AS "weightUnit", weight::float8 AS weight, calories::float8 AS calories, protein::float8 AS protein, fat::float8 AS fat, carbohydrates::float8 AS carbohydrates`;

export function parseProductDetails(body: Record<string, unknown>, existing: ProductDetails = emptyProductDetails): ProductDetails {
  const result = { ...existing };
  for (const [key, limit] of [["ingredients", 4000], ["serving", 120], ["weightUnit", 12]] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "string" || body[key].length > limit || [...body[key]].some((character) => character.charCodeAt(0) < 32 && !["\n", "\r", "\t"].includes(character))) {
      throw Object.assign(new Error("Проверьте состав, порцию и единицу измерения"), { status: 400 });
    }
    result[key] = body[key].trim();
  }
  if (result.weightUnit === "гр") result.weightUnit = "г";
  if (!["г", "мл", "шт."].includes(result.weightUnit)) throw Object.assign(new Error("Выберите единицу измерения из списка"), { status: 400 });
  for (const key of ["weight", "calories", "protein", "fat", "carbohydrates"] as const) {
    if (body[key] === undefined) continue;
    const value = body[key];
    if (value === null || value === "") { result[key] = null; continue; }
    if ((typeof value !== "number" && typeof value !== "string") || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1_000_000 || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) {
      throw Object.assign(new Error("Вес и пищевая ценность должны быть числами от 0 до 1 000 000, до двух знаков после запятой"), { status: 400 });
    }
    result[key] = Number(value);
  }
  return result;
}

/** Fill only empty metadata on unchanged reference rows; never replace an employee's edits. */
export async function migrateProductDetails() {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('2026-10-30-product-details'))`;
    const [applied] = await tx`SELECT key FROM app_migrations WHERE key='2026-10-30-product-details'`;
    if (applied) return;
    for (const [id, row] of Object.entries(referenceProductDetails)) {
      await tx`UPDATE products SET ingredients=CASE WHEN ingredients='' THEN ${row.ingredients} ELSE ingredients END,
        serving=CASE WHEN serving='' THEN ${row.serving} ELSE serving END,
        weight=COALESCE(weight,${row.weight}), weight_unit=CASE WHEN weight IS NULL THEN ${row.weightUnit} ELSE weight_unit END,
        calories=COALESCE(calories,${row.calories}), protein=COALESCE(protein,${row.protein}), fat=COALESCE(fat,${row.fat}), carbohydrates=COALESCE(carbohydrates,${row.carbohydrates})
        WHERE id=${Number(id)} AND name=${row.name} AND image=${row.image} AND deleted_at IS NULL`;
    }
    await tx`INSERT INTO app_migrations(key) VALUES ('2026-10-30-product-details')`;
  });
}
