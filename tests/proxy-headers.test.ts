import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTrustedProxyConfiguration,
  buildProxyHeaders,
  resolveExternalProtocol,
  resolveTrustedProxyAddresses,
  resolveTrustedProxyHops,
} from "../server/proxy-headers";

test("external protocol comes from trusted configuration, not request headers", () => {
  assert.equal(resolveExternalProtocol(undefined, "production"), "https");
  assert.equal(resolveExternalProtocol(undefined, "development"), "http");
  assert.equal(resolveExternalProtocol("HTTPS", "development"), "https");
  assert.throws(() => resolveExternalProtocol("ftp", "production"), /http or https/);
});

test("trusted proxy hop count is explicit and bounded", () => {
  assert.equal(resolveTrustedProxyHops(undefined), 0);
  assert.equal(resolveTrustedProxyHops("1"), 1);
  assert.throws(() => resolveTrustedProxyHops("all"), /integer/);
  assert.throws(() => resolveTrustedProxyHops("11"), /0 to 10/);
  assert.deepEqual(resolveTrustedProxyAddresses("10.0.0.4, 192.168.0.0/16"), ["10.0.0.4", "192.168.0.0/16"]);
  assert.throws(() => resolveTrustedProxyAddresses("10.0.0.0/99"), /subnet/);
  assert.throws(() => assertTrustedProxyConfiguration(1, []), /TRUSTED_PROXY_ADDRESSES/);
  assert.doesNotThrow(() => assertTrustedProxyConfiguration(1, ["10.0.0.0/8"]));
});

test("gateway replaces spoofable forwarding headers with socket facts", () => {
  const headers = buildProxyHeaders({
    host: "attacker.example",
    authorization: "Bearer safe-token",
    forwarded: "for=203.0.113.10;proto=https",
    "x-forwarded-for": "203.0.113.11",
    "x-forwarded-host": "admin.example",
    "x-forwarded-port": "443",
    "x-forwarded-proto": "https",
    connection: "keep-alive, x-remove-me",
    "keep-alive": "timeout=5",
    "x-remove-me": "smuggled",
    "content-type": "application/json",
  }, "::ffff:198.51.100.20", 4010);

  assert.equal(headers.host, "127.0.0.1:4010");
  assert.equal(headers["x-forwarded-for"], "198.51.100.20");
  assert.equal(headers["x-forwarded-proto"], "http");
  assert.equal(headers.authorization, "Bearer safe-token");
  assert.equal(headers["content-type"], "application/json");
  assert.equal(headers.forwarded, undefined);
  assert.equal(headers["x-forwarded-host"], undefined);
  assert.equal(headers["x-forwarded-port"], undefined);
  assert.equal(headers.connection, undefined);
  assert.equal(headers["keep-alive"], undefined);
  assert.equal(headers["x-remove-me"], undefined);
});

test("gateway selects the rightmost untrusted address for configured TLS proxy hops", () => {
  const directOnly = buildProxyHeaders({
    "x-forwarded-for": "192.0.2.99, 203.0.113.8",
  }, "10.0.0.4", 4010, "https", 0);
  assert.equal(directOnly["x-forwarded-for"], "10.0.0.4");

  const oneProxy = buildProxyHeaders({
    "x-forwarded-for": "192.0.2.99, 203.0.113.8",
  }, "10.0.0.4", 4010, "https", 1, ["10.0.0.0/8"]);
  assert.equal(oneProxy["x-forwarded-for"], "203.0.113.8");

  const twoProxies = buildProxyHeaders({
    "x-forwarded-for": "192.0.2.99, 203.0.113.8",
  }, "10.0.0.4", 4010, "https", 2, ["10.0.0.4"]);
  assert.equal(twoProxies["x-forwarded-for"], "192.0.2.99");

  const insufficientChain = buildProxyHeaders({
    "x-forwarded-for": "not-an-ip",
  }, "10.0.0.4", 4010, "https", 1, ["10.0.0.0/8"]);
  assert.equal(insufficientChain["x-forwarded-for"], "10.0.0.4");

  const untrustedDirectPeer = buildProxyHeaders({
    "x-forwarded-for": "203.0.113.8",
  }, "198.51.100.40", 4010, "https", 1, ["10.0.0.0/8"]);
  assert.equal(untrustedDirectPeer["x-forwarded-for"], "198.51.100.40");
});

test("connection-nominated sensitive headers are not proxied", () => {
  const headers = buildProxyHeaders({
    authorization: "Bearer must-not-pass",
    connection: "authorization",
  }, "2001:db8::5", 3010, "https");
  assert.equal(headers.authorization, undefined);
  assert.equal(headers["x-forwarded-for"], "2001:db8::5");
  assert.equal(headers["x-forwarded-proto"], "https");
});
