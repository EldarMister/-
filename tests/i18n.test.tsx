import assert from "node:assert/strict";
import test from "node:test";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { languages, localeTag, resolveLocale } from "../app/i18n/locales";
import { messages, translate } from "../app/i18n/translate";
import Localized, { localizeContent } from "../app/i18n/Localized";
import { LanguageProvider } from "../app/i18n/LanguageProvider";
import { categories, products, promotions } from "../app/data";

test("all five language choices and safe locale fallbacks are available", () => {
  assert.deepEqual(languages.map((language) => language.code), ["ky", "ru", "en", "kk", "uz"]);
  assert.equal(localeTag("ky"), "ky-KG");
  assert.equal(resolveLocale("en"), "en");
  assert.equal(resolveLocale("<script>"), "ru");
  assert.equal(resolveLocale(undefined), "ru");
});

test("every translated message has four complete translations with the same variables", () => {
  for (const [source, translations] of Object.entries(messages)) {
    assert.equal(translations.length, 4, source);
    const variables = source.match(/\{\d+\}/g)?.sort() || [];
    for (const value of translations) {
      assert.ok(value.trim(), source);
      assert.deepEqual(value.match(/\{\d+\}/g)?.sort() || [], variables, source);
    }
  }
  for (const item of [...categories, ...products]) assert.ok(messages[item.name], item.name);
  for (const promotion of promotions) {
    assert.ok(messages[promotion.title], promotion.title);
    assert.ok(messages[promotion.description], promotion.description);
  }
});

test("localized dynamic labels retain names, totals, codes and whitespace", () => {
  assert.equal(translate(" Удалить Филадельфия ", "en"), " Remove Philadelphia ");
  assert.equal(translate("ОФОРМИТЬ ЗАКАЗ · 123 С", "en"), "PLACE ORDER · 123 KGS");
  assert.equal(translate("Код отправлен. Код для локального запуска: 0000.", "en"), "Code sent. Local development code: 0000.");
  assert.equal(translate("Выбрано: Улица клиента 7", "en"), "Selected: Улица клиента 7");
  assert.equal(translate("  Сообщение клиента  ", "uz"), "  Сообщение клиента  ");
  assert.equal(translate(" Корзина ", "ru"), " Корзина ");
});

test("display localization leaves form values, URLs, identifiers and legal details intact", () => {
  const markup = renderToStaticMarkup(<LanguageProvider initialLocale="en"><Localized>
    <section><h1>Корзина</h1><label>Имя<input id="customer-name" name="name" defaultValue="Имя" placeholder="Имя" /></label>
      <textarea aria-label="Комментарий к заказу" defaultValue="Корзина" /><a href="/order" aria-label="Корзина">Оформление заказа</a><p translate="no">ИНН: 123</p></section>
  </Localized></LanguageProvider>);
  assert.match(markup, /<h1>Cart<\/h1>/);
  assert.match(markup, /value="Имя"/);
  assert.match(markup, /placeholder="Name"/);
  assert.match(markup, /id="customer-name"/);
  assert.match(markup, /aria-label="Order notes">Корзина<\/textarea>/);
  assert.match(markup, /href="\/order" aria-label="Cart">Checkout/);
  assert.match(markup, /translate="no">ИНН: 123/);
});

test("language changes keep child keys stable so forms and dialogs retain state", () => {
  const children = [createElement("input", { defaultValue: "Имя" }), createElement("button", { key: "save" }, "Продолжить")];
  const ru = localizeContent(children, (value) => translate(value, "ru"));
  const en = localizeContent(children, (value) => translate(value, "en"));
  assert.ok(Array.isArray(ru) && Array.isArray(en));
  assert.deepEqual(ru.map((child) => isValidElement(child) ? child.key : null), en.map((child) => isValidElement(child) ? child.key : null));
  assert.equal(ru[1].key, "save");
});

test("server rendering starts in each selected language", () => {
  for (const { code } of languages) {
    const markup = renderToStaticMarkup(<LanguageProvider initialLocale={code}><Localized><h1>Корзина</h1><button>Войти</button></Localized></LanguageProvider>);
    assert.ok(markup.includes(translate("Корзина", code)));
    assert.ok(markup.includes(translate("Войти", code)));
  }
});
