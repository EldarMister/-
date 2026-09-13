const RETRYABLE_CONNECTION_ERRORS = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "CONNECT_TIMEOUT",
  "57P03", // PostgreSQL is starting up.
]);

function isRetryableConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  return RETRYABLE_CONNECTION_ERRORS.has(String(candidate.code))
    || isRetryableConnectionError(candidate.cause);
}

export async function waitForDatabaseConnection(
  checkConnection: () => Promise<unknown>,
  timeoutMs = 180_000,
  retryDelayMs = 2_000,
  onRetry: (error: unknown) => void = () => undefined,
) {
  const deadline = Date.now() + timeoutMs;
  let reported = false;

  for (;;) {
    try {
      await checkConnection();
      return;
    } catch (error) {
      if (!isRetryableConnectionError(error) || Date.now() >= deadline) throw error;
      if (!reported) {
        onRetry(error);
        reported = true;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(retryDelayMs, deadline - Date.now())));
    }
  }
}
