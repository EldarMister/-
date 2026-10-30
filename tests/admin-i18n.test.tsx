import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { LanguageProvider } from "../app/i18n/LanguageProvider";
import { languages } from "../app/i18n/locales";
import { messages as sharedMessages } from "../app/i18n/translate";
import { adminMessages, AdminLanguageSwitcher, translateAdmin, useAdminLanguage } from "../app/admin/i18n";

test("every admin message has all four translations with matching placeholders", () => {
  assert.ok(Object.keys(adminMessages).length > 100, "admin screens need their own complete dictionary");
  const placeholders = (value: string) => [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
  for (const [source, translations] of Object.entries(adminMessages)) {
    assert.equal(translations.length, 4, source);
    for (const translation of translations) {
      assert.ok(translation.trim(), source);
      assert.deepEqual(placeholders(translation), placeholders(source), source);
    }
  }
});

test("every explicit admin UI translation has an authored dictionary entry", () => {
  const missing = new Set<string>();
  const root = new URL("../app/admin/", import.meta.url);
  for (const file of readdirSync(root).filter((name) => name.endsWith(".tsx"))) {
    const source = ts.createSourceFile(file, readFileSync(new URL(file, root), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const inspect = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t" && node.arguments[0]) {
        const checkArgument = (argument: ts.Node): void => {
          if (ts.isStringLiteralLike(argument)) {
            const key = argument.text.replace(/\s+/g, " ").trim();
            if (/[А-Яа-яЁё]/.test(key) && !adminMessages[key] && !sharedMessages[key]) missing.add(`${file}: ${key}`);
          } else if (ts.isConditionalExpression(argument)) {
            checkArgument(argument.whenTrue); checkArgument(argument.whenFalse);
          } else if (ts.isBinaryExpression(argument) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(argument.operatorToken.kind)) {
            checkArgument(argument.left); checkArgument(argument.right);
          }
        };
        checkArgument(node.arguments[0]);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(source);
  }
  assert.deepEqual([...missing], []);
});

test("admin interpolation preserves business values and unknown authored text", () => {
  assert.equal(translateAdmin("Заказ №{number}", "ru", { number: "123-456" }), "Заказ №123-456");
  assert.equal(translateAdmin("{name}: {count}", "en", { name: "Заказ клиента", count: 12 }), "Заказ клиента: 12");
  assert.equal(translateAdmin("Индивидуальное описание клиента №182", "en"), "Индивидуальное описание клиента №182");
  assert.equal(translateAdmin("Неизвестное {value}", "uz"), "Неизвестное {value}");
  assert.equal(translateAdmin("Значение {constructor}", "en", {}), "Значение {constructor}");
  assert.equal(translateAdmin("Товар «Сохранить» сохранён.", "en"), "Product “Сохранить” saved.");
  assert.equal(translateAdmin(" (скрыта)", "en"), " (hidden)");
});

function LanguageProbe() {
  const { t, formatNumber, formatDate } = useAdminLanguage();
  return <section><h1>{t("Заказы")}</h1><span>{formatNumber(123456.5)}</span><time>{formatDate("2026-10-27T20:30:00Z", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</time><p>{t("{value}", { value: '<img src=x onerror="alert(1)">' })}</p><AdminLanguageSwitcher /></section>;
}

test("all admin locales render through React with Bishkek dates and safe user values", () => {
  for (const { code } of languages) {
    const markup = renderToStaticMarkup(<LanguageProvider initialLocale={code}><LanguageProbe /></LanguageProvider>);
    assert.ok(markup.includes(translateAdmin("Заказы", code)), code);
    assert.match(markup, /2026/);
    assert.match(markup, /28/);
    assert.match(markup, /02:30/);
    assert.match(markup, /&lt;img/);
    assert.doesNotMatch(markup, /<img/);
    assert.match(markup, new RegExp(`value="${code}" selected=""`));
    assert.equal((markup.match(/<option/g) || []).length, 5);
  }
});
