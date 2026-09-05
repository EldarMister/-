import assert from "node:assert/strict";
import test from "node:test";
import { resolveCorsOrigins } from "../server/cors-origins";

test("production uses same-origin requests when CORS_ORIGIN is absent", () => {
  assert.deepEqual(resolveCorsOrigins(undefined, "production"), []);
});

test("development allows the local frontend by default", () => {
  assert.deepEqual(resolveCorsOrigins(undefined, "development"), ["http://localhost:3000"]);
});

test("production accepts explicitly configured public HTTPS origins", () => {
  assert.deepEqual(
    resolveCorsOrigins("https://frontend.example.com, https://admin.example.com", "production"),
    ["https://frontend.example.com", "https://admin.example.com"],
  );
});

test("production rejects unsafe configured origins", () => {
  assert.throws(
    () => resolveCorsOrigins("http://localhost:3000", "production"),
    /valid public HTTPS origins/,
  );
});
