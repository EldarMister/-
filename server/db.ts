import "dotenv/config";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL || "postgres://sushi:sushi@localhost:5434/sushi_tochka";

export const sql = postgres(databaseUrl, {
  max: Number(process.env.DB_POOL_SIZE || 10),
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => undefined,
});

export async function closeDatabase() {
  await sql.end({ timeout: 5 });
}
