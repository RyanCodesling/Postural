import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const text = readFileSync(join(here, "..", "web", ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
      if (m) {
        let v = m[1].trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        if (v) return v;
      }
    }
  } catch {
    /* fall through */
  }
  throw new Error("DATABASE_URL not set and not found in web/.env.local");
}

async function main() {
  const connectionString = resolveDatabaseUrl();
  console.log("Connecting to PostgreSQL database...");
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const sqlPath = join(here, "notifications_pg.sql");
    console.log(`Reading migration file: ${sqlPath}`);
    const sql = readFileSync(sqlPath, "utf8");

    console.log("Executing migration queries...");
    await client.query(sql);
    console.log("Migration executed successfully!");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Runner failed:", err);
  process.exit(1);
});
