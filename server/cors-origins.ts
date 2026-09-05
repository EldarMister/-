const LOCAL_DEVELOPMENT_ORIGIN = "http://localhost:3000";

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
