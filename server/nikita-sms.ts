import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const SMS_URL = "https://smspro.nikita.kg/api/message";
const TOKEN_PREFIX = "nikita-sms-v1.";
const CODE_LIFETIME_MS = 5 * 60_000;

type SmsOptions = {
  login: string;
  password: string;
  secret: string;
  sender: "NktaSushiKG" | "DaanaSushKG";
  brand: "NAKTA SUSHI" | "DAANA SUSHI";
  phone: string;
  transactionId: string;
  timeoutMs?: number;
};

export class NikitaSmsError extends Error {
  constructor(message: string, readonly providerStatus: string | null = null) {
    super(message);
    this.name = "NikitaSmsError";
  }
}

function requireSecret(secret: string) {
  if (secret.length < 32) throw new NikitaSmsError("Авторизация пока не настроена");
}

function escapeXml(value: string) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new NikitaSmsError("Проверьте настройки SMS");
  }
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]!);
}

function codeDigest(secret: string, sender: string, payload: string, code: string) {
  return createHmac("sha256", secret)
    .update(JSON.stringify(["nikita-sms-v1", sender, payload, code]))
    .digest("hex");
}

function xmlField(xml: string, name: string) {
  const matches = [...xml.matchAll(new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`, "g"))];
  return matches.length === 1 ? matches[0][1] : null;
}

/** Each request selects its sender explicitly; the account-wide OTP defaults are not used. */
export async function sendNikitaSmsCode(options: SmsOptions) {
  const { secret, sender, brand, transactionId } = options;
  const login = options.login.trim();
  const phone = options.phone.replace(/[\s()+-]/g, "");
  if (!login || !options.password) throw new NikitaSmsError("Отправка SMS пока не настроена");
  requireSecret(secret);
  if (!/^996\d{9}$/.test(phone)) throw new NikitaSmsError("Проверьте номер телефона");
  if (!transactionId) throw new NikitaSmsError("Не удалось подготовить SMS");

  const code = randomInt(1_000_000).toString().padStart(6, "0");
  const expiresAt = Date.now() + CODE_LIFETIME_MS;
  const payload = `${expiresAt}.${phone}.${randomBytes(16).toString("hex")}`;
  const token = `${TOKEN_PREFIX}${payload}.${codeDigest(secret, sender, payload, code)}`;
  // Nikita XML IDs are alphanumeric, up to 12 characters. Include the brand to isolate projects.
  const digest = createHash("sha256").update(`${sender}:${transactionId}`).digest("hex");
  const messageId = BigInt(`0x${digest}`).toString(36).slice(0, 12);
  const message = `${brand}: код ${code}. Действует 5 мин.`;
  const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
    `<message><login>${escapeXml(login)}</login><pwd>${escapeXml(options.password)}</pwd>` +
    `<id>${messageId}</id><sender>${sender}</sender><text>${escapeXml(message)}</text>` +
    `<phones><phone>${phone}</phone></phones></message>`;

  let response: Response;
  let body: string;
  try {
    response = await fetch(SMS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/xml; charset=utf-8", Accept: "application/xml" },
      body: xml,
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      redirect: "error",
    });
    body = await response.text();
  } catch {
    throw new NikitaSmsError("Сервис SMS временно недоступен");
  }

  if (!response.ok || body.length > 16_384 || /<!DOCTYPE|<!ENTITY/i.test(body) ||
      !/^\s*(?:<\?xml[^?]*\?>\s*)?<response(?:\s+xmlns="[^"]*")?\s*>[\s\S]*<\/response>\s*$/.test(body)) {
    throw new NikitaSmsError("Сервис SMS вернул некорректный ответ");
  }
  const status = xmlField(body, "status");
  if (status !== "0") {
    if (status === "7") throw new NikitaSmsError("Проверьте номер телефона", status);
    // Status 11 is a test request, not a sent code. Never accept it as a real delivery.
    throw new NikitaSmsError("Не удалось отправить SMS", status);
  }
  if (xmlField(body, "id") !== messageId || xmlField(body, "phones") !== "1" ||
      xmlField(body, "smscnt") !== "1") {
    throw new NikitaSmsError("Сервис SMS не подтвердил отправку кода");
  }
  return token;
}

export function isNikitaSmsToken(token: string) {
  return token.startsWith(TOKEN_PREFIX);
}

/** Only a keyed digest is stored in the existing server-side challenge, never the code. */
export function verifyNikitaSmsCode(secret: string, sender: string, token: string, code: string) {
  requireSecret(secret);
  const match = /^nikita-sms-v1\.(\d{13})\.(996\d{9})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token);
  const result = (status: string) => ({ valid: status === "0", status, description: "" });
  if (!match) return result("12");
  if (Number(match[1]) <= Date.now()) return result("13");
  if (!/^\d{6}$/.test(code)) return result("14");
  const payload = `${match[1]}.${match[2]}.${match[3]}`;
  const expected = Buffer.from(codeDigest(secret, sender, payload, code), "hex");
  return result(timingSafeEqual(expected, Buffer.from(match[4], "hex")) ? "0" : "14");
}
