import { createHash } from "node:crypto";
import { isIP } from "node:net";

export function opaqueRateLimitKey(scope: string, value: unknown) {
  const normalized = String(value || "").replace(/\s+/g, "").toLowerCase();
  return createHash("sha256").update(`${scope}:${normalized}`).digest("hex");
}

export function opaquePhoneRateLimitKey(scope: string, value: unknown) {
  return opaqueRateLimitKey(scope, String(value || "").replace(/\D/g, ""));
}

function normalizeIp(value: unknown) {
  const candidate = String(Array.isArray(value) ? value[0] || "" : value || "")
    .split(",", 1)[0]
    .trim()
    .replace(/^::ffff:/i, "");
  return isIP(candidate) ? candidate.toLowerCase() : "unknown";
}

export function trustedClientIp(remoteAddress: unknown, forwardedFor: unknown) {
  const remote = normalizeIp(remoteAddress);
  if (["127.0.0.1", "::1"].includes(remote)) {
    const forwarded = normalizeIp(forwardedFor);
    if (forwarded !== "unknown") return forwarded;
  }
  return remote;
}

export function opaqueClientRateLimitKey(
  scope: string,
  remoteAddress: unknown,
  forwardedFor: unknown,
) {
  return opaqueRateLimitKey(scope, trustedClientIp(remoteAddress, forwardedFor));
}
