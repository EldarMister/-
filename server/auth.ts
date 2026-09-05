import { createHash, randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import { sql } from "./db";

const DEVELOPMENT_JWT_SECRET = "development-only-change-this-secret";
const ADMIN_SESSION_TTL_SECONDS = 2 * 60 * 60;
const ADMIN_SESSION_COOKIE = "daana_admin_session";

export function resolveAdminJwtSecret(
  configuredSecret: string | undefined,
  environment: string | undefined,
) {
  const candidate = configuredSecret?.trim() || "";
  if (environment === "production") {
    if (
      candidate.length < 32
      || candidate === DEVELOPMENT_JWT_SECRET
    ) {
      throw new Error("JWT_SECRET must contain at least 32 private characters in production");
    }
    return candidate;
  }
  return candidate || DEVELOPMENT_JWT_SECRET;
}

const secret = new TextEncoder().encode(resolveAdminJwtSecret(
  process.env.JWT_SECRET,
  process.env.NODE_ENV,
));

export async function createAdminToken(user: { id: number; name: string }) {
  const token = await new SignJWT({ name: user.name, role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_TTL_SECONDS}s`)
    .sign(secret);
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_SECONDS * 1_000);
  await sql.begin(async (tx) => {
    await tx`DELETE FROM admin_sessions WHERE expires_at <= NOW()`;
    await tx`
      INSERT INTO admin_sessions (token_hash, admin_user_id, expires_at)
      VALUES (${createHash("sha256").update(token).digest("hex")}, ${user.id}, ${expiresAt})
    `;
  });
  return token;
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

export function setAdminSessionCookie(response: Response, token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${ADMIN_SESSION_TTL_SECONDS}; Path=/api/admin; HttpOnly; SameSite=Strict${secure}`,
  );
}

export function clearAdminSessionCookie(response: Response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${ADMIN_SESSION_COOKIE}=; Max-Age=0; Path=/api/admin; HttpOnly; SameSite=Strict${secure}`,
  );
}

export async function requireAdmin(request: Request, response: Response, next: NextFunction) {
  const token = cookieValue(request, ADMIN_SESSION_COOKIE);
  if (!token) return response.status(401).json({ error: "Требуется вход в админку" });
  try {
    const verified = await jwtVerify(token, secret);
    if (verified.payload.role !== "admin") throw new Error("Invalid role");
    const adminId = Number(verified.payload.sub);
    if (!Number.isSafeInteger(adminId) || adminId < 1) throw new Error("Invalid subject");
    const [session] = await sql`
      SELECT token_hash
      FROM admin_sessions
      WHERE token_hash = ${createHash("sha256").update(token).digest("hex")}
        AND admin_user_id = ${adminId}
        AND expires_at > NOW()
      LIMIT 1
    `;
    if (!session) throw new Error("Revoked session");
    response.locals.admin = { id: adminId, name: verified.payload.name };
    next();
  } catch {
    response.status(401).json({ error: "Сессия истекла" });
  }
}

export async function revokeCurrentAdminSession(request: Request) {
  const token = cookieValue(request, ADMIN_SESSION_COOKIE);
  if (!token) return false;
  const removed = await sql`
    DELETE FROM admin_sessions
    WHERE token_hash = ${createHash("sha256").update(token).digest("hex")}
    RETURNING token_hash
  `;
  return removed.length > 0;
}
