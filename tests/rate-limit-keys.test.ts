import assert from "node:assert/strict";
import test from "node:test";
import {
  opaqueClientRateLimitKey,
  opaquePhoneRateLimitKey,
  opaqueRateLimitKey,
  trustedClientIp,
} from "../server/rate-limit-keys";

test("phone rate-limit keys normalize formatting without exposing the phone", () => {
  const compact = opaquePhoneRateLimitKey("otp", "996555123456");
  const formatted = opaquePhoneRateLimitKey("otp", "+996 (555) 123-456");
  assert.equal(compact, formatted);
  assert.match(compact, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(compact, /996555123456/);
});

test("session rate-limit keys are scoped one-way hashes", () => {
  const token = "a".repeat(64);
  const reward = opaqueRateLimitKey("reward", token);
  assert.match(reward, /^[a-f0-9]{64}$/);
  assert.notEqual(reward, token);
  assert.notEqual(reward, opaqueRateLimitKey("another-scope", token));
});

test("forwarded client addresses are trusted only across the loopback gateway", () => {
  assert.equal(trustedClientIp("::ffff:127.0.0.1", "203.0.113.25"), "203.0.113.25");
  assert.equal(trustedClientIp("198.51.100.4", "203.0.113.25"), "198.51.100.4");
  assert.equal(trustedClientIp("::1", "not-an-ip"), "::1");

  const key = opaqueClientRateLimitKey("otp", "127.0.0.1", "203.0.113.25");
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(key, /203\.0\.113\.25/);
});
