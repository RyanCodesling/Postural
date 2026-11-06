/**
 * Local backup, and a restore check, for a deployment that runs on one
 * computer: the database (pg_dump, custom format), session recordings and
 * uploaded exercise guides, which a database dump alone does not contain.
 * Read-only on the live database and media.
 *
 *   npm run backup:local -- --out <new directory>
 *     Writes database.dump, copies of both media folders and manifest.json:
 *     every table's row count, every copied file's size and SHA-256, the git
 *     revision, the coaching algorithm version and the trend settings hash.
 *     Run it while no session is in progress, so the two copies agree. Keep
 *     backups on this computer or a drive you control, outside the repository
 *     and outside any cloud-synced folder: they hold patient data and videos.
 *
 *   npm run backup:local -- --verify <backup directory> --into <empty database>
 *     Checks the copied files against the manifest, restores database.dump
 *     into that database with the app's database login, and compares every
 *     table's row count. The database must already exist, be empty, be owned
 *     by the app's login and differ from the live one; a database
 *     administrator creates it once (docs/evaluation-deployment.md). The live
 *     database is never written.
 *
 * The database address comes from DATABASE_URL, else web/.env.local. The
 * PostgreSQL tools are found through PG_BIN, else the newest
 * C:\Program Files\PostgreSQL\<version>\bin, else PATH. The login reaches them
 * through environment variables, never the command line or this output.
 */
import { Client } from "pg";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COACHING_ALGORITHM_VERSION } from "../src/lib/pose/coachingConfig";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function setting(name: string): string | null {
  if (process.env[name]) return process.env[name]!;
  try {
    for (const line of readFileSync(join(web, ".env.local"), "utf8").split(/\r?\n/)) {
      const match = line.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)\\s*$`));
      if (match) return match[1].replace(/^["']|["']$/g, "");
    }
  } catch {
    // no .env.local
  }
  return null;
}

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

const databaseUrl = setting("DATABASE_URL");
if (!databaseUrl) throw new Error("DATABASE_URL not set and not found in web/.env.local");
const live = new URL(databaseUrl);
const liveDatabase = decodeURIComponent(live.pathname.replace(/^\//, ""));

function loginFor(database: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGHOST: live.hostname,
    PGPORT: live.port || "5432",
    PGUSER: decodeURIComponent(live.username),
    PGPASSWORD: decodeURIComponent(live.password),
    PGDATABASE: database,
    ...(live.searchParams.get("sslmode") ? { PGSSLMODE: live.searchParams.get("sslmode")! } : {}),
  };
}

function connectionFor(database: string): string {
  const url = new URL(databaseUrl!);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
}

function pgTool(name: string): string {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  if (process.env.PG_BIN) return join(process.env.PG_BIN, exe);
  const root = "C:\\Program Files\\PostgreSQL";
  if (process.platform === "win32" && existsSync(root)) {
    const versions = readdirSync(root).filter((v) => existsSync(join(root, v, "bin", exe)))
      .sort((a, b) => Number.parseFloat(b) - Number.parseFloat(a));
    if (versions.length) return join(root, versions[0], "bin", exe);
  }
  return name;
}

function run(tool: string, args: string[], database: string): void {
  const result = spawnSync(pgTool(tool), args, { env: loginFor(database), stdio: ["ignore", "inherit", "inherit"] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${tool} exited with ${result.status}`);
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else if (entry.isFile()) out.push(path);
  }
  return out.sort();
}

async function rowCounts(database: string): Promise<Record<string, number>> {
  const client = new Client({ connectionString: connectionFor(database) });
  await client.connect();
  try {
    const tables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
    );
    const counts: Record<string, number> = {};
    for (const { table_name } of tables.rows) {
      const { rows } = await client.query(`SELECT count(*)::bigint AS n FROM public."${String(table_name).replace(/"/g, '""')}"`);
      counts[table_name] = Number(rows[0].n);
    }
    return counts;
  } finally {
    await client.end();
  }
}

function git(args: string[]): string | null {
  const result = spawnSync("git", ["-C", resolve(web, ".."), ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

type Manifest = {
  createdAt: string;
  database: { name: string; rowCounts: Record<string, number>; dumpSha256: string };
  recordings: { source: string; files: { path: string; bytes: number; sha256: string }[] };
  exerciseVideos?: { source: string; files: { path: string; bytes: number; sha256: string }[] };
  release: { gitRevision: string | null; uncommittedChanges: boolean | null; coachingAlgorithm: string; trendSettingsSha256: string };
};

function copyMedia(source: string, destination: string): NonNullable<Manifest["exerciseVideos"]> {
  const files = filesUnder(source).map((file) => ({ path: relative(source, file), bytes: statSync(file).size, sha256: sha256(file) }));
  if (existsSync(source)) cpSync(source, destination, { recursive: true });
  for (const file of files) {
    if (sha256(join(destination, file.path)) !== file.sha256) throw new Error(`copy of ${file.path} does not match its source`);
  }
  return { source, files };
}

function checkMedia(dir: string, folder: string, media: Manifest["exerciseVideos"], problems: string[]): void {
  for (const file of media?.files ?? []) {
    const copy = join(dir, folder, file.path);
    if (!existsSync(copy) || sha256(copy) !== file.sha256) problems.push(`${folder}/${file.path} is missing or changed`);
  }
}

async function backup(out: string): Promise<void> {
  if (existsSync(out)) throw new Error(`${out} already exists; backups are never overwritten.`);
  mkdirSync(out, { recursive: true });
  const recordingsRoot = resolve(web, setting("RECORDINGS_DIR") ?? ".recordings");
  const exerciseVideosRoot = resolve(web, setting("EXERCISE_VIDEOS_DIR") ?? ".exercise-videos");
  const rowCountsBefore = await rowCounts(liveDatabase);
  const dump = join(out, "database.dump");
  run("pg_dump", ["--format=custom", `--file=${dump}`], liveDatabase);
  const recordings = copyMedia(recordingsRoot, join(out, "recordings"));
  const exerciseVideos = copyMedia(exerciseVideosRoot, join(out, "exercise-videos"));
  const files = recordings.files;
  const rowCountsAfter = await rowCounts(liveDatabase);
  if (JSON.stringify(rowCountsAfter) !== JSON.stringify(rowCountsBefore)) {
    throw new Error("row counts changed during the backup; run it again while no session is in progress");
  }
  const status = git(["status", "--porcelain", "--untracked-files=no"]);
  const manifest: Manifest = {
    createdAt: new Date().toISOString(),
    database: { name: liveDatabase, rowCounts: rowCountsBefore, dumpSha256: sha256(dump) },
    recordings,
    exerciseVideos,
    release: {
      gitRevision: git(["rev-parse", "HEAD"]),
      uncommittedChanges: status === null ? null : status.length > 0,
      coachingAlgorithm: COACHING_ALGORITHM_VERSION,
      trendSettingsSha256: sha256(join(web, "src", "lib", "analytics", "trendModelConfig.json")),
    },
  };
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const rows = Object.values(rowCountsBefore).reduce((a, b) => a + b, 0);
  console.log(`Backup written to ${out}: ${Object.keys(rowCountsBefore).length} tables (${rows} rows), ` +
    `${files.length} recording files (${(files.reduce((a, f) => a + f.bytes, 0) / 1e6).toFixed(1)} MB), ` +
    `${exerciseVideos.files.length} exercise guide files, all copies verified.`);
}

async function verify(dir: string, into: string): Promise<void> {
  if (into === liveDatabase) throw new Error("--into must name a separate, empty database, never the live one.");
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Manifest;
  const problems: string[] = [];
  if (sha256(join(dir, "database.dump")) !== manifest.database.dumpSha256) problems.push("database.dump does not match the manifest");
  checkMedia(dir, "recordings", manifest.recordings, problems);
  checkMedia(dir, "exercise-videos", manifest.exerciseVideos, problems);
  const existing = await rowCounts(into);
  if (Object.keys(existing).length > 0) throw new Error(`${into} is not empty; restore checks only use an empty database.`);
  run("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", `--dbname=${into}`, join(dir, "database.dump")], into);
  const restored = await rowCounts(into);
  for (const [table, count] of Object.entries(manifest.database.rowCounts)) {
    if (restored[table] !== count) problems.push(`table ${table}: ${restored[table] ?? "missing"} rows restored, ${count} backed up`);
  }
  if (problems.length) {
    console.log(`Restore check FAILED for ${dir}:`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Restore check passed: ${Object.keys(restored).length} tables with matching row counts in ${into}, ` +
    `${manifest.recordings.files.length} recording files matching their hashes. ` +
    `${manifest.exerciseVideos?.files.length ?? 0} exercise guide files matching their hashes. ` +
    `The restored copy is still in ${into}; drop it when finished.`);
}

const out = argValue("--out");
const check = argValue("--verify");
const into = argValue("--into");
(out ? backup(resolve(out)) : check && into ? verify(resolve(check), into) : Promise.reject(new Error(
  "Usage: npm run backup:local -- --out <new directory> | --verify <backup directory> --into <empty database>",
))).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
