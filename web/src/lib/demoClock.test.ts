/** Admin-controlled demo tools. Run: npx tsx src/lib/demoClock.test.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { DAY_MS, DemoClockError, demoClockAllowed, manilaDayKey } from "./demoClock";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const ast = ts.createSourceFile("db.ts", read("./db.ts"), ts.ScriptTarget.Latest, true);
const functionText = (names: string[]) => {
  const nodes = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text ?? ""));
  assert.equal(nodes.length, names.length);
  return nodes.map(n => n.getText(ast)).join("\n");
};
let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); passed++; console.log(`PASS ${name}`); }

function clock(env: Record<string, string | undefined>, initial = { enabled: false, offset_ms: 0 }, missingCode?: string) {
  let stored = { ...initial };
  const queries: string[] = [];
  const pool = { query: async (sql: string, values?: any[]) => {
    queries.push(sql);
    if (missingCode) throw Object.assign(new Error("missing fixture setup"), { code: missingCode });
    if (sql.startsWith("SELECT")) return { rows: [stored] };
    if (sql.startsWith("UPDATE")) {
      if (!stored.enabled) return { rows: [] };
      stored.offset_ms = values![0]; return { rows: [{ id: 1 }] };
    }
    if (sql.includes("EXCLUDED.enabled")) {
      const enabled = values![0];
      stored = { enabled, offset_ms: enabled && stored.enabled ? stored.offset_ms : 0 };
    } else stored.offset_ms = 0;
    return { rows: [] };
  } };
  const context: any = vm.createContext({ exports: {}, process: { env }, console, pool, DemoClockError, demoClockAllowed, manilaDayKey, DAY_MS });
  vm.runInContext(transpile(functionText(["readDemoClockSettings", "getDemoClockState", "getEffectiveNow", "todayKeyPH", "setDemoClockMode", "setDemoClock", "resetDemoClock"])), context);
  return { db: context.exports, queries, stored: () => stored };
}
function route(db: any, role: string | null) {
  const context: any = vm.createContext({ exports: {}, console, require: (name: string) => {
    if (name === "next/server") return { NextResponse: { json: (body: any, init?: ResponseInit) => new Response(JSON.stringify(body), init) } };
    if (name === "@/lib/auth-server") return { getAuthenticatedUser: async () => role ? { id: "fixture", role } : null };
    if (name === "@/lib/db") return db;
    if (name === "@/lib/demoClock") return { DemoClockError };
    throw new Error(`Unexpected dependency ${name}`);
  } });
  vm.runInContext(transpile(read("../app/api/demo-clock/route.ts")), context);
  return context.exports;
}
const request = (body: unknown = {}) => ({ json: async () => body });

async function main() {
  await test("normal dev/production permit admin controls but stored mode defaults off", async () => {
    for (const NODE_ENV of ["development", "production"]) for (const DEMO_CLOCK of [undefined, "on"]) {
      assert(demoClockAllowed({ NODE_ENV, DEMO_CLOCK }));
      const { db } = clock({ NODE_ENV, DEMO_CLOCK }, { enabled: false, offset_ms: 5 * DAY_MS });
      const state = await db.getDemoClockState();
      assert.equal(state.enabled, false); assert.equal(state.offsetMs, 0); assert.equal(state.isOverridden, false);
      assert(Math.abs((await db.getEffectiveNow()).getTime() - Date.now()) < 1000);
    }
  });
  await test("missing table and pre-upgrade schema ignore legacy offsets safely", async () => {
    for (const code of ["42P01", "42703"]) {
      const { db } = clock({}, undefined, code);
      const state = await db.getDemoClockState();
      assert.equal(state.available, false); assert.equal(state.enabled, false); assert.equal(state.offsetMs, 0);
      assert(Math.abs((await db.getEffectiveNow()).getTime() - Date.now()) < 1000);
    }
  });
  await test("enable, set, reset, disable and re-enable work without an environment change", async () => {
    const { db, stored } = clock({}, { enabled: false, offset_ms: 5 * DAY_MS });
    await db.setDemoClockMode(true, "admin"); assert.deepEqual(stored(), { enabled: true, offset_ms: 0 });
    await db.setDemoClock(new Date(Date.now() + 3 * DAY_MS).toISOString(), "admin");
    const offset = stored().offset_ms; assert(Math.abs(offset - 3 * DAY_MS) < 1000);
    assert.equal((await db.getDemoClockState()).isOverridden, true);
    await db.setDemoClockMode(true, "admin"); assert.equal(stored().offset_ms, offset, "duplicate enable is idempotent");
    await db.resetDemoClock("admin"); assert.deepEqual(stored(), { enabled: true, offset_ms: 0 });
    await db.setDemoClock(new Date(Date.now() + 2 * DAY_MS).toISOString(), "admin");
    await db.setDemoClockMode(false, "admin"); assert.deepEqual(stored(), { enabled: false, offset_ms: 0 });
    await assert.rejects(db.setDemoClock(new Date().toISOString(), "admin"), (error: any) => error.status === 409);
    await db.setDemoClockMode(true, "admin"); assert.deepEqual(stored(), { enabled: true, offset_ms: 0 });
  });
  await test("explicit server lock ignores saved state and rejects mutations without database access", async () => {
    const { db, queries } = clock({ DEMO_CLOCK: "off" }, { enabled: true, offset_ms: 4 * DAY_MS });
    assert.equal((await db.getDemoClockState()).allowed, false);
    assert(Math.abs((await db.getEffectiveNow()).getTime() - Date.now()) < 1000);
    for (const action of [() => db.setDemoClockMode(true, "admin"), () => db.setDemoClock(new Date().toISOString(), "admin"), () => db.resetDemoClock("admin")]) await assert.rejects(action, (error: any) => error.status === 403);
    assert.equal(queries.length, 0);
  });
  await test("all environments require sign-in and only admin may toggle, set or reset", async () => {
    for (const NODE_ENV of ["development", "production"]) for (const role of [null, "patient", "therapist", "admin"]) {
      const { db, queries } = clock({ NODE_ENV }); const api = route(db, role);
      assert.equal((await api.GET(request())).status, role ? 200 : 401);
      const before = queries.length; const expected = role === "admin" ? 200 : role ? 403 : 401;
      for (const response of [await api.PATCH(request({ enabled: true })), await api.PUT(request({ targetAt: new Date().toISOString() })), await api.DELETE(request()), await api.PATCH(request({ enabled: false }))]) assert.equal(response.status, expected);
      if (role !== "admin") assert.equal(queries.length, before);
      assert.equal((await api.GET(request())).headers.get("Cache-Control"), role ? "no-store" : null);
    }
  });
  await test("malformed requests and missing setup fail without enabling tools", async () => {
    const { db, queries } = clock({}); const api = route(db, "admin");
    for (const body of [null, [], {}, { enabled: "true" }, { enabled: true, extra: 1 }]) assert.equal((await api.PATCH(request(body))).status, 400);
    for (const body of [{}, { targetAt: "invalid" }, { targetAt: "2100-01-01T00:00:00Z" }]) assert.equal((await api.PUT(request(body))).status, 400);
    assert.equal(queries.length, 0);
    for (const code of ["42P01", "42703"]) {
      const response = await route(clock({}, undefined, code).db, "admin").PATCH(request({ enabled: true }));
      assert.equal(response.status, 503); assert.match((await response.json()).error, /demo_clock_settings_pg.sql/);
    }
  });
  await test("disabled clients keep discovering mode changes and camera reads only the day", () => {
    const provider = read("./DemoClockContext.tsx");
    assert.doesNotMatch(provider, /process\.env\.NODE_ENV/);
    assert.match(provider, /setEnabled\(Boolean\(state.enabled\)\)/);
    assert.doesNotMatch(provider, /if \(response.status === 404\) window.clearInterval/);
    assert.match(provider, /const value = useMemo\(/); assert.equal((provider.match(/1_000\)/g) ?? []).length, 1);
    assert.match(provider, /setInterval\(check, 30_000\)/);
    assert.match(read("../app/(app)/dashboard/admin/page.tsx"), /activeTab === "demo-clock" && \(/);
    assert.match(read("../app/(app)/camera/CameraClient.tsx"), /const \{ todayKey: effectiveTodayPH \} = useDemoClock\(\);/);
  });
  await test("reminders use the same effective clock for today and tomorrow", () => {
    const sync = functionText(["syncTimeNotifications"]);
    assert.match(sync, /const now = await getEffectiveNow\(\);/);
    assert.match(sync, /const tomorrowStr = manilaDayKey\(now\.getTime\(\) \+ DAY_MS\);/);
  });
  await test("the compatibility launcher selects dev or start, forwards arguments, and propagates failure", () => {
    const scripts = JSON.parse(read("../../package.json")).scripts;
    const launcher = fileURLToPath(new URL("../../scripts/demo-server.mjs", import.meta.url));
    const directory = mkdtempSync(join(tmpdir(), "postural-demo-launcher-"));
    const npm = join(directory, "npm-fixture.mjs");
    writeFileSync(npm, 'console.log(JSON.stringify({ args: process.argv.slice(2), clock: process.env.DEMO_CLOCK })); process.exit(17);');
    try {
      for (const mode of ["dev", "start"]) {
        assert.equal(scripts[`${mode}:demo`], `node scripts/demo-server.mjs ${mode}`);
        const child = spawnSync(process.execPath, [launcher, mode, "--port", "3119"], {
          env: { ...process.env, npm_execpath: npm, DEMO_CLOCK: "off" }, encoding: "utf8",
        });
        assert.equal(child.status, 17, child.stderr);
        assert.deepEqual(JSON.parse(child.stdout), { args: ["run", mode, "--", "--port", "3119"], clock: "on" });
      }
      const invalid = spawnSync(process.execPath, [launcher, "build"], {
        env: { ...process.env, npm_execpath: npm }, encoding: "utf8",
      });
      assert.equal(invalid.status, 1);
      assert.equal(invalid.stdout, "", "an invalid mode does not launch npm");
    } finally {
      unlinkSync(npm);
      rmdirSync(directory);
    }
  });
  console.log(`${passed} checks passed.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
