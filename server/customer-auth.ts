import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { sql } from "./db";

const CUSTOMER_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const CUSTOMER_SESSION_COOKIE = "daana_customer_session";

export type CustomerIdentity = {
  id: number;
  phone: string;
  name: string | null;
};

export function customerSessionTokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function cookieValue(request: Request, name: string) {
  const raw = request.headers.cookie || "";
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function verificationTokenFrom(request: Request) {
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "").trim() || "";
  return bearer || cookieValue(request, CUSTOMER_SESSION_COOKIE);
}

export function setCustomerSessionCookie(response: Response, verificationToken: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${CUSTOMER_SESSION_COOKIE}=${encodeURIComponent(verificationToken)}; Max-Age=${CUSTOMER_SESSION_TTL_SECONDS}; Path=/api/auth; HttpOnly; SameSite=Strict${secure}`,
  );
}

export function clearCustomerSessionCookie(response: Response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${CUSTOMER_SESSION_COOKIE}=; Max-Age=0; Path=/api/auth; HttpOnly; SameSite=Strict${secure}`,
  );
}

export async function createCustomerSession(customer: CustomerIdentity) {
  const verificationToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_TTL_SECONDS * 1_000);
  await sql.begin(async (tx) => {
    await tx`DELETE FROM customer_sessions WHERE expires_at <= NOW()`;
    await tx`
      INSERT INTO customer_sessions (token_hash, customer_id, expires_at)
      VALUES (${customerSessionTokenHash(verificationToken)}, ${customer.id}, ${expiresAt})
    `;
  });
  return { verificationToken, expiresInSeconds: CUSTOMER_SESSION_TTL_SECONDS };
}

export async function requireCustomer(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const verificationToken = verificationTokenFrom(request);
  if (!/^[a-f0-9]{64}$/i.test(verificationToken)) {
    response.status(401).json({ error: "Войдите в профиль ещё раз" });
    return;
  }

  const [customer] = await sql<CustomerIdentity[]>`
    SELECT customers.id::int, customers.phone, customers.name
    FROM customer_sessions sessions
    INNER JOIN customers ON customers.id = sessions.customer_id
    WHERE sessions.token_hash = ${customerSessionTokenHash(verificationToken)}
      AND sessions.expires_at > NOW()
    LIMIT 1
  `;
  if (!customer) {
    response.status(401).json({ error: "Войдите в профиль ещё раз" });
    return;
  }

  response.locals.customer = customer;
  next();
}

export function authenticatedCustomer(response: Response) {
  return response.locals.customer as CustomerIdentity;
}

export async function revokeCurrentCustomerSession(request: Request, customerId: number) {
  const verificationToken = verificationTokenFrom(request);
  if (!/^[a-f0-9]{64}$/i.test(verificationToken)) return false;
  const removed = await sql`
    DELETE FROM customer_sessions
    WHERE token_hash = ${customerSessionTokenHash(verificationToken)}
      AND customer_id = ${customerId}
    RETURNING token_hash
  `;
  return removed.length > 0;
}
