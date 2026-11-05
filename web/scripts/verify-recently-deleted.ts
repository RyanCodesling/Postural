/** Opt-in SQL acceptance for Recently Deleted's guide videos: the actual
 * restore, permanent delete and publication SQL against connection-private
 * pg_temp tables and a disposable media folder. No public rows, sequences or
 * real media are changed. Run with a local DATABASE_URL: npm run verify:deleted:db
 *
 * One connection cannot run two requests at once, so a second tab's restore
 * runs after the first, which is the order the bin entry's row lock forces.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { Client } from "pg";
import ts from "typescript";
import * as customVideo from "../src/lib/exercises/customVideo";
import * as storage from "../src/lib/exercises/customVideoStorage";

assert(process.env.DATABASE_URL, "DATABASE_URL is required for private temporary-table acceptance");
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname), "Use a local database");
const client = new Client({ connectionString: process.env.DATABASE_URL });
const nodeRequire = createRequire(import.meta.url);
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
} }).outputText;

const dbSource = readFileSync(new URL("../src/lib/db.ts", import.meta.url), "utf8");
const names = ["setExerciseVideoFile", "setExerciseYouTubeVideo", "inVideoTransaction", "binReplacedExerciseVideo"];
const ast = ts.createSourceFile("db.ts", dbSource, ts.ScriptTarget.Latest, true);
const nodes = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text ?? ""));
assert.equal(nodes.length, names.length);

const EXERCISE = "fixture_guide";
const fileA = `${EXERCISE}.${"a".repeat(32)}.webm`;
const fileB = `${EXERCISE}.${"b".repeat(32)}.webm`;
const fileC = `${EXERCISE}.${"c".repeat(32)}.webm`;
const fileD = `${EXERCISE}.${"d".repeat(32)}.webm`;
const fileE = `${EXERCISE}.${"e".repeat(32)}.webm`;
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x08]);

async function main() {
  const media = mkdtempSync(path.join(tmpdir(), "postural-recently-deleted-"));
  process.env.EXERCISE_VIDEOS_DIR = media;
  await client.connect();
  let cases = 0;
  try {
    // CTAS copies column types only: no rows, defaults, public sequences or FKs.
    await client.query("CREATE TEMP TABLE exercises AS SELECT * FROM public.exercises WITH NO DATA");
    await client.query("SET search_path TO pg_temp");
    const migration = readFileSync(new URL("../../scripts/exercises_pg.sql", import.meta.url), "utf8");
    const videoColumns = migration.match(/^ALTER TABLE exercises ADD COLUMN IF NOT EXISTS (?:video_mime_type|youtube_video_id|video_file_name)[^;]+;/gm) ?? [];
    assert.equal(videoColumns.length, 3);
    for (const sql of videoColumns) await client.query(sql);
    // The bin as scripts/deleted_items_pg.sql creates it, without the foreign keys.
    const binSql = readFileSync(new URL("../../scripts/deleted_items_pg.sql", import.meta.url), "utf8")
      .match(/CREATE TABLE IF NOT EXISTS deleted_items \([\s\S]+?\n\);/)?.[0];
    assert(binSql, "the bin's table definition");
    await client.query(binSql
      .replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE")
      .replace(/\s+REFERENCES \w+\(id\)(?: ON DELETE (?:CASCADE|SET NULL))?/g, ""));
    for (const table of ["exercises", "deleted_items"]) {
      const resolved = await client.query("SELECT to_regclass($1)::oid = to_regclass($2)::oid AS isolated", [table, `pg_temp.${table}`]);
      assert.equal(resolved.rows[0].isolated, true);
    }

    const statements: string[] = [];
    const query = (sql: string, values?: any[]) => {
      assert(!/\bpublic\s*\./i.test(sql), "production SQL must not escape the private fixtures");
      assert(/^\s*(SELECT\b|BEGIN\b|COMMIT\b|ROLLBACK\b|UPDATE exercises\b|INSERT INTO deleted_items\b|DELETE FROM deleted_items\b)/i.test(sql), sql);
      statements.push(sql.trim());
      return client.query(sql, values);
    };
    const pool = { query, connect: async () => ({ query, release() {} }) };
    const dbContext: any = vm.createContext({ exports: {}, pool,
      hasDeletedItemsBin: async () => true, exerciseVideoFileFromRow: customVideo.exerciseVideoFileFromRow });
    vm.runInContext(compile(nodes.map(n => n.getText(ast)).join("\n")), dbContext);
    const notices: string[] = [];
    const binContext: any = vm.createContext({ exports: {}, process, console, Buffer,
      require: (name: string) => ({
        "@/lib/db": { __esModule: true, default: pool, DeletedItemsBinUnavailableError: class extends Error {},
          hasDeletedItemsBin: async () => true, getUserById: async () => null,
          createNotification: async (userId: string, title: string) => { notices.push(`${userId}: ${title}`); },
          setExerciseVideoFile: dbContext.exports.setExerciseVideoFile,
          setExerciseYouTubeVideo: dbContext.exports.setExerciseYouTubeVideo },
        "@/lib/recording/storage": {},
        "@/lib/exercises/customVideoStorage": storage,
        "@/lib/exercises/customVideo": customVideo,
      } as Record<string, any>)[name] ?? nodeRequire(name),
    });
    vm.runInContext(compile(readFileSync(new URL("../src/lib/deletedItems.ts", import.meta.url), "utf8")), binContext);
    const bin = binContext.exports;

    const check = async (name: string, run: () => Promise<void>) => { await run(); cases++; console.log(`PASS ${name}`); };
    const file = (name: string) => existsSync(path.join(media, name));
    const guide = async () => (await client.query("SELECT video_mime_type, video_file_name, youtube_video_id FROM exercises WHERE id = $1", [EXERCISE])).rows[0];
    const entries = async () => (await client.query("SELECT id, details FROM deleted_items ORDER BY id")).rows;
    const snapshot = async () => JSON.stringify({ guide: await guide(), entries: await entries() });
    const binEntry = async (details: Record<string, unknown>) => (await client.query(
      "INSERT INTO deleted_items (kind, exercise_id, label, details) VALUES ('exercise_video', $1, 'Disposable guide', $2) RETURNING id",
      [EXERCISE, JSON.stringify(details)],
    )).rows[0].id as number;

    writeFileSync(path.join(media, fileA), WEBM);
    writeFileSync(path.join(media, fileB), WEBM);
    await client.query(
      `INSERT INTO exercises (id, name, description, is_custom, owner_therapist_id, monitoring_mode, created_at, video_mime_type, video_file_name)
       VALUES ($1, 'Disposable guide', 'Disposable fixture', true, 'fixture-owner', 'manual', now(), 'video/webm', $2)`,
      [EXERCISE, fileB],
    );
    const older = await binEntry({ source: "file", mimeType: "video/webm", fileName: fileA });

    await check("a restore brings the older guide back and bins the one it replaces, in one locked transaction", async () => {
      statements.length = 0;
      const result = await bin.restoreDeletedItem(older, "fixture-admin");
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal((await guide()).video_file_name, fileA);
      const left = await entries();
      assert.deepEqual(left.map((e: any) => e.details.fileName), [fileB], "only the replaced guide is in the bin");
      assert.equal(statements[0], "BEGIN");
      assert.match(statements[1], /FOR UPDATE OF d$/, "the bin entry is read locked");
      assert.equal(statements.filter(sql => sql === "BEGIN").length, 1, "one transaction, not one per step");
      assert.equal(statements.at(-1), "COMMIT");
      assert.deepEqual(notices, ["fixture-owner: Guide Video Restored"]);
    });

    await check("a second restore of the same entry, as from a second tab, is refused and changes nothing", async () => {
      const before = await snapshot();
      statements.length = 0;
      const result = await bin.restoreDeletedItem(older, "fixture-admin");
      assert.deepEqual({ ...result }, { ok: false, status: 404, error: "This item is no longer in Recently Deleted." });
      assert.equal(await snapshot(), before, "the guide in use is not binned a second time");
      assert.equal(statements.at(-1), "ROLLBACK");
      assert.equal(notices.length, 1);
      assert(file(fileA) && file(fileB));
    });

    await check("a permanent delete of an entry already restored is refused", async () => {
      const before = await snapshot();
      assert.equal(await bin.purgeDeletedItem(older), "missing");
      assert.equal(await snapshot(), before);
      assert(file(fileA) && file(fileB));
    });

    // A duplicate entry naming the guide in use, as two restores at once left one before this fix.
    const duplicate = await binEntry({ source: "file", mimeType: "video/webm", fileName: fileA });

    await check("a permanent delete never erases the guide its exercise is showing", async () => {
      const before = await snapshot();
      assert.equal(await bin.purgeDeletedItem(duplicate), "in-use");
      assert.equal(await snapshot(), before);
      assert(await storage.openExerciseVideo(EXERCISE, "video/webm", fileA), "the guide in use still plays");
    });

    await check("a restore of an entry naming the guide in use is refused and changes nothing", async () => {
      const before = await snapshot();
      statements.length = 0;
      const result = await bin.restoreDeletedItem(duplicate, "fixture-admin");
      assert.deepEqual({ ...result }, { ok: false, status: 409, error: "This video is already the exercise's guide video." });
      assert.equal(await snapshot(), before, "the guide in use is not binned once more");
      assert.equal(statements.at(-1), "ROLLBACK");
      assert.equal(notices.length, 1);
      await client.query("DELETE FROM deleted_items WHERE id = $1", [duplicate]);
    });

    await check("a permanent delete erases a replaced guide that is not in use, with its entry", async () => {
      const replaced = (await entries()).find((e: any) => e.details.fileName === fileB).id;
      statements.length = 0;
      assert.equal(await bin.purgeDeletedItem(replaced), "deleted");
      assert.equal(file(fileB), false);
      assert(file(fileA));
      assert.deepEqual(await entries(), []);
      assert.equal(statements[0], "BEGIN");
      assert.match(statements[1], /FOR UPDATE$/, "the bin entry is held while its file is erased");
      assert.equal(statements.at(-1), "COMMIT");
    });

    await check("a YouTube guide restores the same way and bins the uploaded one", async () => {
      const youtube = await binEntry({ source: "youtube", youtubeVideoId: "dQw4w9WgXcQ" });
      const result = await bin.restoreDeletedItem(youtube, "fixture-admin");
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.deepEqual({ ...(await guide()) }, { video_mime_type: null, video_file_name: null, youtube_video_id: "dQw4w9WgXcQ" });
      const left = await entries();
      assert.deepEqual(left.map((e: any) => e.details.fileName), [fileA]);
      assert.equal(await bin.purgeDeletedItem(left[0].id), "deleted", "an upload no longer in use can be deleted for good");
      assert.equal(file(fileA), false);
    });

    // Two entries naming one older file, which two restores at once could leave before this fix.
    writeFileSync(path.join(media, fileC), WEBM);
    const firstC = await binEntry({ source: "file", mimeType: "video/webm", fileName: fileC });
    const secondC = await binEntry({ source: "file", mimeType: "video/webm", fileName: fileC });

    await check("a permanent delete keeps a guide file that another entry still names", async () => {
      statements.length = 0;
      assert.equal(await bin.purgeDeletedItem(firstC), "deleted");
      assert(file(fileC), "the file stays for the other entry");
      assert.deepEqual((await entries()).map((e: any) => e.id), [secondC]);
      assert(statements.some(sql => /^SELECT 1 FROM exercises WHERE id = \$1 FOR UPDATE$/.test(sql)),
        "the exercise's row orders this with restores and other deletes of its guides");
    });

    await check("the other entry then restores that file, which plays", async () => {
      const result = await bin.restoreDeletedItem(secondC, "fixture-admin");
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal((await guide()).video_file_name, fileC);
      assert(await storage.openExerciseVideo(EXERCISE, "video/webm", fileC), "the restored guide plays");
      assert.deepEqual((await entries()).map((e: any) => e.details.youtubeVideoId), ["dQw4w9WgXcQ"],
        "the YouTube guide it replaces is binned");
    });

    await check("a restore of an entry whose file is missing is refused and changes nothing", async () => {
      const missing = await binEntry({ source: "file", mimeType: "video/webm", fileName: fileD });
      const before = await snapshot();
      statements.length = 0;
      const result = await bin.restoreDeletedItem(missing, "fixture-admin");
      assert.deepEqual({ ...result },
        { ok: false, status: 409, error: "The guide video's file is missing from the server, so it cannot be restored." });
      assert.equal(await snapshot(), before, "a missing file is never published");
      assert.equal(statements.at(-1), "ROLLBACK");
      assert.equal(await bin.purgeDeletedItem(missing), "deleted", "its entry can still be deleted for good");
    });

    await check("deleting the last of two entries naming one file erases it", async () => {
      writeFileSync(path.join(media, fileE), WEBM);
      const first = await binEntry({ source: "file", mimeType: "video/webm", fileName: fileE });
      const second = await binEntry({ source: "file", mimeType: "video/webm", fileName: fileE });
      assert.equal(await bin.purgeDeletedItem(first), "deleted");
      assert(file(fileE));
      assert.equal(await bin.purgeDeletedItem(second), "deleted");
      assert.equal(file(fileE), false, "no file is left behind without an entry");
    });

    await check("a refused restore of an archived exercise's guide rolls back", async () => {
      const entry = await binEntry({ source: "youtube", youtubeVideoId: "M7lc1UVf-VE" });
      await client.query("UPDATE exercises SET archived_at = now() WHERE id = $1", [EXERCISE]);
      const before = await snapshot();
      statements.length = 0;
      const result = await bin.restoreDeletedItem(entry, "fixture-admin");
      assert.equal(result.status, 409);
      assert.equal(await snapshot(), before);
      assert.equal(statements.at(-1), "ROLLBACK");
    });
    console.log(`${cases}/${cases} private-table Recently Deleted cases passed; no public rows or sequences changed.`);
  } finally {
    await client.end();
    rmSync(media, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
