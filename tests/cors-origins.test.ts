import assert from "node:assert/strict";
import test from "node:test";
import { isTrustedAdminOrigin, resolveCorsOrigins } from "../server/cors-origins";

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

test("admin mutations accept their own HTTPS origin without cross-origin configuration", () => {
  assert.equal(isTrustedAdminOrigin("https://daanasushi.com", "https", "daanasushi.com", []), true);
  assert.equal(isTrustedAdminOrigin("https://daanasushi.com", "https", "daanasushi.com:443", []), true);
  assert.equal(isTrustedAdminOrigin("http://localhost:3100", "http", "localhost:3100", []), true);
  assert.equal(isTrustedAdminOrigin(undefined, "https", "daanasushi.com", []), true);
});

test("admin mutations reject foreign or malformed origins and retain explicit CORS support", () => {
  assert.equal(isTrustedAdminOrigin("https://attacker.example", "https", "daanasushi.com", []), false);
  assert.equal(isTrustedAdminOrigin("null", "https", "daanasushi.com", []), false);
  assert.equal(isTrustedAdminOrigin("http://daanasushi.com", "https", "daanasushi.com", []), false);
  assert.equal(isTrustedAdminOrigin("https://daanasushi.com/path", "https", "daanasushi.com", []), false);
  assert.equal(isTrustedAdminOrigin("https://attacker.example", "https", "daanasushi.com@attacker.example", []), false);
  assert.equal(isTrustedAdminOrigin("https://admin.example.com", "https", "daanasushi.com", ["https://admin.example.com"]), true);
});
