const LOCAL_DEVELOPMENT_ORIGIN = "http://localhost:3000";

export function isTrustedAdminOrigin(
  origin: string | undefined,
  requestProtocol: string,
  requestHost: string | undefined,
  configuredOrigins: string[],
) {
  if (!origin) return true;
  try {
    const parsedOrigin = new URL(origin);
    if (!["http:", "https:"].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin) return false;
    if (configuredOrigins.includes(origin)) return true;
    if (!requestHost || !["http", "https"].includes(requestProtocol) || /[\s,\\]/.test(requestHost)) return false;
    const requestUrl = new URL(`${requestProtocol}://${requestHost}`);
    if (requestUrl.username || requestUrl.password || requestUrl.pathname !== "/" || requestUrl.search || requestUrl.hash) return false;
    return origin === requestUrl.origin;
  } catch {
    return false;
  }
}

export function resolveCorsOrigins(
  configuredOrigins: string | undefined,
  environment: string | undefined,
) {
  const configured = configuredOrigins?.trim();
  if (!configured) {
    return environment === "production" ? [] : [LOCAL_DEVELOPMENT_ORIGIN];
  }

  const origins = configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (environment === "production" && origins.some((origin) => {
    try {
      const parsed = new URL(origin);
      return parsed.origin !== origin
        || parsed.protocol !== "https:"
        || ["localhost", "127.0.0.1"].includes(parsed.hostname);
    } catch {
      return true;
    }
  })) {
    throw new Error("CORS_ORIGIN must list valid public HTTPS origins when configured in production");
  }

  return origins;
}
