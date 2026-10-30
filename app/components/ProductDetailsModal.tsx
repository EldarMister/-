"use client";

import { useEffect, useRef } from "react";
import { useLanguage } from "../i18n/LanguageProvider";
import { localeTag } from "../i18n/locales";
import { localizeProductIngredients, productNutrition } from "../productDetails";
import type { Product } from "../types";

type Props = { product: Product; quantity: number; onIncrease: () => void; onDecrease: () => void; onClose: () => void };

export default function ProductDetailsModal({ product, quantity, onIncrease, onDecrease, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  const { t, locale } = useLanguage();
  const number = new Intl.NumberFormat(localeTag(locale), { maximumFractionDigits: 2 });
  const labels = { weight: product.weightUnit || "г", calories: "ккал", protein: "белки", fat: "жиры", carbohydrates: "угл." };
  const nutrition = productNutrition(product, quantity);
  useEffect(() => { close.current = onClose; }, [onClose]);

  useEffect(() => {
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dismissBackdrop = (event: MouseEvent) => {
      if (!element || event.target !== element) return;
      const bounds = element.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close.current();
    };
    element?.addEventListener("click", dismissBackdrop);
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => { element?.close(); element?.removeEventListener("click", dismissBackdrop); document.body.style.overflow = overflow; if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, []);

  return <dialog ref={dialog} className="product-details-dialog" aria-labelledby="product-details-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <button type="button" className="product-details-close" onClick={onClose} aria-label={t("Закрыть состав товара")}><span aria-hidden="true">×</span></button>
    <div className="product-details-card">
      <div className="product-details-information">
        <img className="product-details-image" src={product.image} alt={t(product.name)} />
        {product.serving && <p className="product-details-serving">{t(product.serving)}</p>}
        <p className="product-details-ingredients"><span className="visually-hidden">{t("Состав")}: </span>{product.ingredients ? localizeProductIngredients(product.ingredients, t) : t("Состав пока не указан")}</p>
        {nutrition.length > 0 && <dl className="product-details-nutrition" aria-label={t(nutrition.some(({ key }) => key !== "weight") ? "Вес и пищевая ценность выбранного количества" : "Вес или объём")}>
          {nutrition.map(({ key, value }) => <div key={key}><dd>{number.format(value)}</dd><dt>{t(labels[key])}</dt></div>)}
        </dl>}
      </div>
      <div className="product-details-purchase">
        <h2 id="product-details-title">{t(product.name)}</h2>
        <div className="product-details-price">{number.format(product.price * Math.max(quantity, 1))} {t("С")}</div>
        <div className="product-details-quantity" aria-label={t("Количество")}>
          <button type="button" disabled={quantity === 0} onClick={onDecrease} aria-label={t("Уменьшить количество")}><span className="material-icons" aria-hidden="true">remove_circle_outline</span></button>
          <strong aria-live="polite">{number.format(quantity)}</strong>
          <button type="button" onClick={onIncrease} aria-label={t("Добавить в корзину")}><span className="material-icons" aria-hidden="true">add_circle_outline</span></button>
        </div>
      </div>
    </div>
  </dialog>;
}
