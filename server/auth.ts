import type { NextFunction, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.JWT_SECRET || "development-only-change-this-secret");

export async function createAdminToken(user: { id: number; email: string; name: string }) {
  return new SignJWT({ email: user.email, name: user.name, role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret);
}

export async function requireAdmin(request: Request, response: Response, next: NextFunction) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return response.status(401).json({ error: "Требуется вход в админку" });
  try {
    await jwtVerify(token, secret);
    next();
  } catch {
    response.status(401).json({ error: "Сессия истекла" });
  }
}

