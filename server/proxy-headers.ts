import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import { BlockList, isIP } from "node:net";

const ALWAYS_HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const UNTRUSTED_PROXY_HEADERS = new Set([
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
]);

function connectionHeaderTokens(value: string | string[] | undefined) {
  const joined = Array.isArray(value) ? value.join(",") : value || "";
  return new Set(joined.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean));
}

function normalizedRemoteAddress(value: string | undefined) {
  if (!value) return "127.0.0.1";
  const ipv4Mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  return ipv4Mapped?.[1] || value;
}

export function resolveTrustedProxyHops(value: string | undefined) {
  if (!value?.trim()) return 0;
  const hops = Number(value);
  if (!Number.isSafeInteger(hops) || hops < 0 || hops > 10) {
    throw new Error("TRUSTED_PROXY_HOPS must be an integer from 0 to 10");
  }
  return hops;
}

export function resolveTrustedProxyAddresses(value: string | undefined) {
  const entries = (value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  const blockList = new BlockList();
  for (const entry of entries) {
    const [address, rawPrefix, ...extra] = entry.split("/");
    const family = isIP(address);
    if (!family || extra.length) throw new Error(`Invalid trusted proxy address: ${entry}`);
    if (rawPrefix === undefined) {
      blockList.addAddress(address, family === 4 ? "ipv4" : "ipv6");
      continue;
    }
    const prefix = Number(rawPrefix);
    const maximum = family === 4 ? 32 : 128;
    if (!Number.isSafeInteger(prefix) || prefix < 0 || prefix > maximum) {
      throw new Error(`Invalid trusted proxy subnet: ${entry}`);
    }
    blockList.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
  }
  return entries;
}

export function assertTrustedProxyConfiguration(hops: number, addresses: string[]) {
  if (hops > 0 && addresses.length === 0) {
    throw new Error("TRUSTED_PROXY_ADDRESSES is required when TRUSTED_PROXY_HOPS is greater than 0");
  }
}

function isTrustedProxyPeer(remoteAddress: string, trustedProxyAddresses: string[]) {
  if (!isIP(remoteAddress) || trustedProxyAddresses.length === 0) return false;
  const blockList = new BlockList();
  for (const entry of trustedProxyAddresses) {
    const [address, rawPrefix] = entry.split("/");
    const family = isIP(address);
    if (!family) continue;
    const type = family === 4 ? "ipv4" : "ipv6";
    if (rawPrefix === undefined) blockList.addAddress(address, type);
    else blockList.addSubnet(address, Number(rawPrefix), type);
  }
  return blockList.check(remoteAddress, isIP(remoteAddress) === 4 ? "ipv4" : "ipv6");
}

function trustedClientAddress(
  incoming: IncomingHttpHeaders,
  remoteAddress: string | undefined,
  trustedProxyHops: number,
  trustedProxyAddresses: string[],
) {
  const direct = normalizedRemoteAddress(remoteAddress);
  if (trustedProxyHops === 0 || !isTrustedProxyPeer(direct, trustedProxyAddresses)) return direct;
  const raw = Array.isArray(incoming["x-forwarded-for"])
    ? incoming["x-forwarded-for"].join(",")
    : incoming["x-forwarded-for"] || "";
  const chain = raw
    .split(",")
    .map((entry) => normalizedRemoteAddress(entry.trim()))
    .filter((entry) => isIP(entry));
  return chain.length >= trustedProxyHops ? chain[chain.length - trustedProxyHops] : direct;
}

export function resolveExternalProtocol(
  configuredProtocol: string | undefined,
  environment: string | undefined,
): "http" | "https" {
  const candidate = configuredProtocol?.trim().toLowerCase();
  if (!candidate) return environment === "production" ? "https" : "http";
  if (candidate === "http" || candidate === "https") return candidate;
  throw new Error("EXTERNAL_PROTOCOL must be either http or https");
}

export function buildProxyHeaders(
  incoming: IncomingHttpHeaders,
  remoteAddress: string | undefined,
  targetPort: number,
  protocol: "http" | "https" = "http",
  trustedProxyHops = 0,
  trustedProxyAddresses: string[] = [],
) {
  const nominatedHopByHop = connectionHeaderTokens(incoming.connection);
  const result: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(incoming)) {
    const normalizedName = name.toLowerCase();
    if (
      value === undefined
      || ALWAYS_HOP_BY_HOP.has(normalizedName)
      || UNTRUSTED_PROXY_HEADERS.has(normalizedName)
      || nominatedHopByHop.has(normalizedName)
      || normalizedName === "host"
    ) continue;
    result[normalizedName] = value;
  }
  result.host = `127.0.0.1:${targetPort}`;
  result["x-forwarded-for"] = trustedClientAddress(
    incoming,
    remoteAddress,
    trustedProxyHops,
    trustedProxyAddresses,
  );
  result["x-forwarded-proto"] = protocol;
  return result;
}
