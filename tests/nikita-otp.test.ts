import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { NikitaSmsError, sendNikitaSmsCode, verifyNikitaSmsCode } from "../server/nikita-sms";
import { NikitaOtpError, sendNikitaOtp, verifyNikitaOtp } from "../server/nikita-otp";

const secret = "private-test-secret-with-more-than-32-characters";
const options = {
  login: "shared-account",
  password: "test&password<>\"'",
  secret,
  sender: "NktaSushiKG" as const,
  brand: "NAKTA SUSHI" as const,
  phone: "+996 555 123 456",
  transactionId: "0123456789abcdef0123456789abcdef",
};

function captureSms(context: TestContext) {
  const requests: Array<{ url: string; init: RequestInit; body: string; id: string; code: string }> = [];
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const body = String(init.body);
    const id = /<id>([^<]+)<\/id>/.exec(body)?.[1] || "";
    const code = /код (\d{6})/.exec(body)?.[1] || "";
    requests.push({ url, init, body, id, code });
    return new Response(`<response><id>${id}</id><status>0</status><phones>1</phones><smscnt>1</smscnt></response>`);
  });
  return requests;
}

test("Nikita SMS binds sender, brand, phone and a six-digit code in an escaped XML request", async (context) => {
  const requests = captureSms(context);
  const token = await sendNikitaSmsCode(options);
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.url, "https://smspro.nikita.kg/api/message");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.redirect, "error");
  assert.match(request.body, /<pwd>test&amp;password&lt;&gt;&quot;&apos;<\/pwd>/);
  assert.match(request.body, /<sender>NktaSushiKG<\/sender>/);
  assert.match(request.body, /<phones><phone>996555123456<\/phone><\/phones>/);
  assert.match(request.body, /<text>NAKTA SUSHI: код \d{6}\. Действует 5 мин\.<\/text>/);
  assert.match(request.id, /^[a-z0-9]{12}$/);
  assert.ok(!request.body.includes("<test>"));
  assert.ok(!request.body.includes("transaction_id"));
  assert.ok((/<text>([^<]+)<\/text>/.exec(request.body)?.[1].length || 0) <= 70);
  assert.match(token, /^nikita-sms-v1\.\d{13}\.996555123456\.[a-f0-9]{32}\.[a-f0-9]{64}$/);
  assert.equal(verifyNikitaSmsCode(secret, "NktaSushiKG", token, request.code).valid, true);
  assert.equal(verifyNikitaSmsCode(secret, "DaanaSushKG", token, request.code).valid, false);
  assert.equal(verifyNikitaSmsCode(secret + "changed", "NktaSushiKG", token, request.code).valid, false);
  assert.equal(verifyNikitaSmsCode(secret, "NktaSushiKG", token.replace("996555123456", "996555123457"), request.code).valid, false);
  assert.equal(verifyNikitaSmsCode(secret, "NktaSushiKG", token, "invalid").status, "14");
  const wrongCode = String((Number(request.code) + 1) % 1_000_000).padStart(6, "0");
  assert.equal(verifyNikitaSmsCode(secret, "NktaSushiKG", token, wrongCode).status, "14");
});

test("codes expire after five minutes and repeated sends have distinct salted digests", async (context) => {
  const requests = captureSms(context);
  let now = 1_790_000_000_000;
  context.mock.method(Date, "now", () => now);
  const first = await sendNikitaSmsCode(options);
  const second = await sendNikitaSmsCode({ ...options, transactionId: "another-transaction" });
  assert.notEqual(first, second);
  assert.notEqual(requests[0].id, requests[1].id);
  now += 299_999;
  assert.equal(verifyNikitaSmsCode(secret, "NktaSushiKG", first, requests[0].code).valid, true);
  now += 1;
  assert.equal(verifyNikitaSmsCode(secret, "NktaSushiKG", first, requests[0].code).status, "13");
  assert.equal(verifyNikitaSmsCode(secret, "NktaSushiKG", "nikita-sms-v1.broken", "123456").status, "12");
});

test("missing XML credentials, a short secret or an invalid phone cannot use the generic OTP sender", async (context) => {
  const requests = captureSms(context);
  for (const changes of [{ login: "" }, { password: "" }, { secret: "short" }, { phone: "+79991234567" }]) {
    await assert.rejects(sendNikitaSmsCode({ ...options, ...changes }), NikitaSmsError);
  }
  assert.equal(requests.length, 0);
});

for (const status of ["2", "3", "4", "5", "7", "9", "10", "11"]) {
  test(`Nikita status ${status} rejects the send without a fallback or an automatic retry`, async (context) => {
    let count = 0;
    context.mock.method(globalThis, "fetch", async () => {
      count += 1;
      return new Response(`<response><status>${status}</status></response>`);
    });
    await assert.rejects(sendNikitaSmsCode(options), (error: unknown) =>
      error instanceof NikitaSmsError && error.providerStatus === status);
    assert.equal(count, 1);
  });
}

for (const body of [
  "<html><status>0</status></html>",
  "<response><status>0</status></response>",
  "<response><status>0</status><status>0</status></response>",
  '<!DOCTYPE response [<!ENTITY x "test">]><response><status>0</status></response>',
]) {
  test(`Nikita malformed response is rejected: ${body.slice(0, 35)}`, async (context) => {
    context.mock.method(globalThis, "fetch", async () => new Response(body));
    await assert.rejects(sendNikitaSmsCode(options), NikitaSmsError);
  });
}

test("network errors and failed HTTP responses do not expose credentials", async (context) => {
  context.mock.method(globalThis, "fetch", async () => { throw new Error(options.password); });
  await assert.rejects(sendNikitaSmsCode(options), { message: "Сервис SMS временно недоступен" });
  context.mock.restoreAll();
  context.mock.method(globalThis, "fetch", async () => new Response(options.password, { status: 503 }));
  await assert.rejects(sendNikitaSmsCode(options), { message: "Сервис SMS вернул некорректный ответ" });
});

function configureEnvironment(context: TestContext, changes: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(changes)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    context.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
}

test("Daana fixes DaanaSushKG even with the same legacy OTP key as NAKTA", async (context) => {
  const requests = captureSms(context);
  configureEnvironment(context, {
    NIKITA_SMS_LOGIN: options.login,
    NIKITA_SMS_PASSWORD: options.password,
    JWT_SECRET: secret,
    NIKITA_OTP_API_KEY: "same-legacy-key-for-both-sites",
  });
  const token = await sendNikitaOtp(options.phone, options.transactionId);
  assert.match(requests[0].body, /<sender>DaanaSushKG<\/sender>/);
  assert.match(requests[0].body, /<text>DAANA SUSHI:/);
  assert.ok(!requests[0].body.includes("NktaSushiKG"));
  await verifyNikitaOtp(token, requests[0].code);
  assert.equal(requests.length, 1);
  const wrongCode = String((Number(requests[0].code) + 1) % 1_000_000).padStart(6, "0");
  await assert.rejects(verifyNikitaOtp(token, wrongCode), (error: unknown) =>
    error instanceof NikitaOtpError && error.providerStatus === 14);
});

test("a shared OTP key alone cannot send Daana codes from NAKTA's default sender", async (context) => {
  const requests = captureSms(context);
  configureEnvironment(context, {
    NIKITA_SMS_LOGIN: undefined,
    NIKITA_SMS_PASSWORD: undefined,
    JWT_SECRET: secret,
    NIKITA_OTP_API_KEY: "same-legacy-key-for-both-sites",
  });
  await assert.rejects(sendNikitaOtp(options.phone, options.transactionId), (error: unknown) =>
    error instanceof NikitaOtpError && error.httpStatus === 503);
  assert.equal(requests.length, 0);
});

test("Daana can finish verifying an old OTP challenge during rollout", async (context) => {
  configureEnvironment(context, { NIKITA_OTP_API_KEY: "legacy-key" });
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://smspro.nikita.kg/api/otp/verify");
    assert.deepEqual(JSON.parse(String(init.body)), { token: "old-provider-token", code: "123456" });
    return Response.json({ status: 0 });
  });
  await verifyNikitaOtp("old-provider-token", "123456");
});

