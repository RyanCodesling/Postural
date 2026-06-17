import { Pool } from "pg";
import { readFileSync } from "fs";
import { join } from "path";

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const text = readFileSync(join(process.cwd(), ".env.local"), "utf8");
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
  throw new Error("DATABASE_URL not set and not found in .env.local");
}

async function main() {
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });
  try {
    const result = await pool.query(
      `SELECT id, email, name, role FROM users WHERE role = 'admin'`
    );
    console.log("ADMIN USERS:");
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (err) {
    console.error("Query failed:", err);
  } finally {
    await pool.end();
  }
}

main();
