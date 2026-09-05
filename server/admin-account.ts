import bcrypt from "bcryptjs";
import { sql } from "./db";

export const internalAdminEmail = "admin@sushitochka.local";
const DEVELOPMENT_ADMIN_PASSWORD = "ChangeMe123!";

export function resolveAdminPassword(
  configuredPassword: string | undefined,
  environment: string | undefined,
) {
  const password = configuredPassword || (environment === "production" ? "" : DEVELOPMENT_ADMIN_PASSWORD);
  if (environment === "production") {
    if (password.length < 12 || password === DEVELOPMENT_ADMIN_PASSWORD) {
      throw new Error("ADMIN_PASSWORD must contain at least 12 private characters in production");
    }
    return password;
  }
  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD must contain at least 8 characters");
  }
  return password;
}

export function getAdminPassword() {
  return resolveAdminPassword(process.env.ADMIN_PASSWORD, process.env.NODE_ENV);
}

export async function syncAdminPassword() {
  const passwordHash = await bcrypt.hash(getAdminPassword(), 12);
  const [admin] = await sql`SELECT id FROM admin_users ORDER BY id LIMIT 1`;
  if (admin) {
    await sql`UPDATE admin_users SET password_hash = ${passwordHash} WHERE id = ${admin.id}`;
  } else {
    await sql`INSERT INTO admin_users (email, password_hash, name)
      VALUES (${internalAdminEmail}, ${passwordHash}, 'Администратор')`;
  }
}
