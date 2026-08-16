import bcrypt from "bcryptjs";
import { sql } from "./db";

export const internalAdminEmail = "admin@sushitochka.local";

export function getAdminPassword() {
  const password = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === "production" ? "" : "ChangeMe123!");
  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD must contain at least 8 characters");
  }
  return password;
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
