const NIKITA_OTP_SEND_URL = "https://smspro.nikita.kg/api/otp/send";
const NIKITA_OTP_VERIFY_URL = "https://smspro.nikita.kg/api/otp/verify";
const REQUEST_TIMEOUT_MS = 8_000;

type NikitaOtpPayload = {
  status?: number | string;
  description?: string;
  token?: string;
};

export class NikitaOtpError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly providerStatus: number | null,
    message: string,
  ) {
    super(message);
    this.name = "NikitaOtpError";
  }
}

function providerError(status: number, operation: "send" | "verify") {
  if (status === 7) return new NikitaOtpError(400, status, "Не удалось отправить код на этот номер");
  if (status === 12 || status === 13) return new NikitaOtpError(400, status, "Код устарел. Запросите новый");
  if (status === 14) return new NikitaOtpError(400, status, "Неверный код");
  if (status === 10) return new NikitaOtpError(429, status, "Код уже был запрошен. Подождите и попробуйте ещё раз");
  if ([2, 3, 4, 5].includes(status)) return new NikitaOtpError(503, status, "Отправка SMS временно недоступна");
  return new NikitaOtpError(502, status, operation === "send" ? "Не удалось отправить SMS-код" : "Не удалось проверить код");
}

async function requestNikitaOtp(apiKey: string, url: string, body: Record<string, string>, operation: "send" | "verify") {
  let response: globalThis.Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = name === "AbortError" || name === "TimeoutError"
      ? "SMS-сервис не ответил вовремя"
      : "Не удалось связаться с SMS-сервисом";
    throw new NikitaOtpError(502, null, message);
  }

  let payload: NikitaOtpPayload;
  try {
    payload = await response.json() as NikitaOtpPayload;
  } catch {
    throw new NikitaOtpError(502, null, "SMS-сервис вернул некорректный ответ");
  }

  const status = Number(payload.status);
  if (!Number.isInteger(status)) throw new NikitaOtpError(502, null, "SMS-сервис вернул некорректный статус");
  if (status !== 0) throw providerError(status, operation);
  if (!response.ok) throw new NikitaOtpError(502, status, "SMS-сервис временно недоступен");
  return payload;
}

export async function sendNikitaOtp(apiKey: string, phone: string, transactionId: string) {
  const payload = await requestNikitaOtp(apiKey, NIKITA_OTP_SEND_URL, {
    transaction_id: transactionId,
    phone,
  }, "send");
  const token = String(payload.token || "").trim();
  if (!token) throw new NikitaOtpError(502, null, "SMS-сервис не вернул токен проверки");
  return token;
}

export async function verifyNikitaOtp(apiKey: string, token: string, code: string) {
  await requestNikitaOtp(apiKey, NIKITA_OTP_VERIFY_URL, { token, code }, "verify");
}
