import assert from "node:assert/strict";
import test from "node:test";
import { resolveOtpBypassPhone } from "../server/otp-bypass";

test("OTP bypass is disabled when no phone is configured", () => {
  assert.equal(resolveOtpBypassPhone(undefined), null);
  assert.equal(resolveOtpBypassPhone(""), null);
});

test("OTP bypass normalizes one Kyrgyz phone", () => {
  assert.equal(resolveOtpBypassPhone("+996 220 203 021"), "996220203021");
});

test("OTP bypass rejects invalid phone configuration", () => {
  assert.throws(() => resolveOtpBypassPhone("220203021"), /\+996 format/);
});
