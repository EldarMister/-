import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { closeDatabase, sql } from "./db";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

export async function migrate() {
  const schema = await readFile(join(currentDirectory, "schema.sql"), "utf8");
  await sql.unsafe(schema);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate()
    .then(() => console.log("Database schema is ready."))
    .finally(closeDatabase);
}

