import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { products } from "../app/data";
import { initialProductDetails, localizeProductIngredients, productNutrition } from "../app/productDetails";
import { parseProductDetails } from "../server/product-details";
import { translate } from "../app/i18n/translate";
import { LanguageProvider } from "../app/i18n/LanguageProvider";
import ProductDetailsModal from "../app/components/ProductDetailsModal";

test("reference details match exact seeded product identity and do not guess missing recipes", () => {
  assert.equal(products[0].ingredients, "Лосось, творожный сыр");
  assert.equal(products[0].weight, 30);
  assert.equal(products[0].calories, 45);
  assert.equal(initialProductDetails({ ...products[0], name: "Другой товар" }).ingredients, "");
  assert.equal(initialProductDetails({ ...products[0], image: "/changed.webp" }).weight, null);
  assert.equal(products.find((item) => item.name === "Хиоко")?.ingredients, "");
});

test("nutrition follows selected quantity while absent data is distinct from zero", () => {
  assert.deepEqual(productNutrition(products[0], 3).map(({ value }) => value), [90, 135, 9, 6, 15]);
  assert.equal(productNutrition(products[0], 0)[0].value, 30);
  assert.deepEqual(productNutrition({ ...products[0], weight: null, calories: 0, protein: null, fat: null, carbohydrates: null }, 2), [{ key: "calories", value: 0 }]);
  assert.deepEqual(productNutrition({ ...products[0], weight: null, calories: 0, protein: 0, fat: 0, carbohydrates: 0 }, 2).map(({ value }) => value), [0, 0, 0, 0]);
});

test("partial KBJU shows only supplied fields while weight and composition remain visible", () => {
  const render = (product: typeof products[number]) => renderToStaticMarkup(<LanguageProvider initialLocale="ru"><ProductDetailsModal product={product} quantity={1} onIncrease={() => {}} onDecrease={() => {}} onClose={() => {}} /></LanguageProvider>);
  const labels = { calories: "ккал", protein: "белки", fat: "жиры", carbohydrates: "угл." };
  for (const missing of ["calories", "protein", "fat", "carbohydrates"] as const) {
    const markup = render({ ...products[0], [missing]: null });
    for (const [key, label] of Object.entries(labels)) {
      assert.equal(markup.includes(`<dt>${label}</dt>`), key !== missing, `${missing}: ${key}`);
    }
    assert.match(markup, /<dd>30<\/dd><dt>г<\/dt>/);
    assert.match(markup, /Лосось, творожный сыр/);
  }
  const partial = render({ ...products[0], calories: 0, protein: 7, fat: null, carbohydrates: undefined });
  assert.match(partial, /<dd>0<\/dd><dt>ккал<\/dt>/);
  assert.match(partial, /<dd>7<\/dd><dt>белки<\/dt>/);
  assert.doesNotMatch(partial, /<dt>(?:жиры|угл\.)<\/dt>/);
  const empty = render({ ...products[0], weight: null, calories: null, protein: null, fat: null, carbohydrates: null });
  assert.doesNotMatch(empty, /<dl/);
  assert.match(empty, /68/);
});

test("metadata validation preserves omitted values, supports explicit clearing and rejects malformed values", () => {
  const existing = initialProductDetails(products[0]);
  assert.deepEqual(parseProductDetails({}, existing), existing);
  assert.equal(parseProductDetails({ weight: null, ingredients: " " }, existing).weight, null);
  assert.equal(parseProductDetails({ weight: "12.25", weightUnit: "мл" }).weight, 12.25);
  for (const weight of [-1, "NaN", false, [], {}, 1000001, "12.345", Infinity]) assert.throws(() => parseProductDetails({ weight }), { status: 400 });
  assert.throws(() => parseProductDetails({ ingredients: "a".repeat(4001) }), { status: 400 });
  assert.throws(() => parseProductDetails({ weightUnit: "kg" }), { status: 400 });
});

test("ingredient localization translates known items and preserves authored text and set quantities", () => {
  const t = (value: string) => translate(value, "en");
  assert.equal(localizeProductIngredients(products[0].ingredients!, t), "Salmon, cream cheese");
  assert.equal(localizeProductIngredients("Наш особый ингредиент, огурец", t), "Наш особый ингредиент, cucumber");
  assert.equal(localizeProductIngredients("Филадельфия (6 шт.)", t), "Philadelphia (6 pcs)");
});

test("product details render ingredients and real quantities in all supported languages without injected HTML", () => {
  for (const locale of ["ru", "ky", "en", "kk", "uz"] as const) {
    const markup = renderToStaticMarkup(<LanguageProvider initialLocale={locale}><ProductDetailsModal product={products[0]} quantity={3} onIncrease={() => {}} onDecrease={() => {}} onClose={() => {}} /></LanguageProvider>);
    assert.match(markup, /<dialog/);
    assert.match(markup, /135/);
    if (locale === "en") assert.match(markup, /aria-label="Quantity"/);
    assert.ok(markup.includes(localizeProductIngredients(products[0].ingredients!, (value) => translate(value, locale))));
  }
  const markup = renderToStaticMarkup(<LanguageProvider initialLocale="ru"><ProductDetailsModal product={{ ...products[0], ingredients: "<img src=x onerror=alert(1)>" }} quantity={0} onIncrease={() => {}} onDecrease={() => {}} onClose={() => {}} /></LanguageProvider>);
  assert.match(markup, /&lt;img/);
  assert.doesNotMatch(markup, /<img src="x"/);
});
