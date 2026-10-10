/**
 * The demo clock is off unless the development server runs in demo mode
 * (`npm run dev:demo`). Outside it the app's time is the real time and a demo
 * date left in the database is never read; in demo mode the saved offset moves
 * the time, and a missing table reads as unavailable. The demo-clock API
 * answers only in demo mode, pages read the demo day (which changes once a
 * day) rather than a clock ticking every second, and reminders take
 * "tomorrow" from the same clock as "today".
 *
 *   npx tsx src/lib/demoClock.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { transpile } from "../../scripts/lib/cameraReplayHarness";
import { DAY_MS, demoClockEnabled, manilaDayKey } from "./demoClock";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const dbSource = read("./db.ts");
const dbAst = ts.createSourceFile("db.ts", dbSource, ts.ScriptTarget.Latest, true);
const functionText = (names: string[]) =>
  dbAst.statements
    .filter((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && names.includes(n.name?.text ?? ""))
    .map((n) => n.getText(dbAst))
    .join("\n");

/** The demo-clock functions of db.ts, run against a fake pool and environment. */
function clock(env: Record<string, string | undefined>, reply: () => { rows: unknown[] }) {
  const queries: string[] = [];
  const context: any = vm.createContext({
    exports: {}, console, process: { env }, demoClockEnabled, manilaDayKey, DAY_MS,
    pool: { query: async (sql: string) => { queries.push(sql); return reply(); } },
  });
  vm.runInContext(transpile(functionText(["readDemoClockOffsetMs", "getDemoClockState", "getEffectiveNow", "todayKeyPH"])), context);
  return { context, queries };
}

const withinRealTime = (date: Date, before: number) =>
  date.getTime() >= before && date.getTime() <= Date.now();

async function run() {
  console.log("\nDemo clock\n");

  await test("it is on only in a development server started in demo mode", () => {
    assert.equal(demoClockEnabled({ NODE_ENV: "development", DEMO_CLOCK: "on" }), true);
    assert.equal(demoClockEnabled({ NODE_ENV: "development" }), false, "a normal start");
    assert.equal(demoClockEnabled({ NODE_ENV: "development", DEMO_CLOCK: "1" }), false, "only the demo command's value");
    assert.equal(demoClockEnabled({ NODE_ENV: "production", DEMO_CLOCK: "on" }), false, "never in a production build");
    assert.equal(manilaDayKey(Date.parse("2026-10-13T16:30:00Z")), "2026-10-14", "the day is Manila's");
  });

  await test("outside demo mode the time is real and a saved demo date is not even read", async () => {
    const savedFiveDaysAhead = () => ({ rows: [{ offset_ms: String(5 * DAY_MS) }] });
    for (const env of [{ NODE_ENV: "development" }, { NODE_ENV: "production", DEMO_CLOCK: "on" }]) {
      const { context, queries } = clock(env, savedFiveDaysAhead);
      const before = Date.now();
      assert(withinRealTime(await context.exports.getEffectiveNow(), before), `real time (${JSON.stringify(env)})`);
      assert.equal(await context.todayKeyPH(), manilaDayKey(Date.now()), "today is the real day");
      assert.equal(queries.length, 0, "the database is not asked");
    }
  });

  await test("in demo mode the saved offset moves the time; a missing table reads as unavailable", async () => {
    const { context, queries } = clock({ NODE_ENV: "development", DEMO_CLOCK: "on" }, () => ({ rows: [{ offset_ms: String(5 * DAY_MS) }] }));
    const moved = await context.exports.getEffectiveNow();
    assert(Math.abs(moved.getTime() - (Date.now() + 5 * DAY_MS)) < 1000, "five days ahead");
    assert.equal(queries.length, 1);
    const state = await context.exports.getDemoClockState();
    assert.deepEqual([state.available, state.isOverridden, state.offsetMs], [true, true, 5 * DAY_MS]);

    const missing = clock({ NODE_ENV: "development", DEMO_CLOCK: "on" }, () => {
      throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    });
    const before = Date.now();
    assert(withinRealTime(await missing.context.exports.getEffectiveNow(), before), "real time without the table");
    assert.equal((await missing.context.exports.getDemoClockState()).available, false, "the controls say the table is missing");
  });

  await test("the demo-clock API answers only in demo mode", async () => {
    const route = (env: Record<string, string | undefined>) => {
      const context: any = vm.createContext({
        exports: {}, console: { error() {} }, process: { env },
        require: (name: string) => {
          if (name === "next/server") {
            return { NextResponse: { json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), { status: init?.status ?? 200 }) } };
          }
          if (name === "@/lib/auth-server") return { getAuthenticatedUser: async () => ({ id: "admin_001", role: "admin" }) };
          if (name === "@/lib/db") {
            return {
              getDemoClockState: async () => ({ available: true, isOverridden: false, offsetMs: 0, effectiveAt: new Date().toISOString() }),
              setDemoClock: async () => {}, resetDemoClock: async () => {},
            };
          }
          if (name === "@/lib/demoClock") return { demoClockEnabled };
          throw new Error(`Unexpected demo-clock route import ${name}`);
        },
      });
      vm.runInContext(transpile(read("../app/api/demo-clock/route.ts")), context);
      return context.exports;
    };
    const off = route({ NODE_ENV: "development" });
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = await off[method](new Request("http://localhost/api/demo-clock", { method, body: method === "PUT" ? "{}" : undefined }));
      assert.equal(response.status, 404, `${method} outside demo mode`);
    }
    assert.match((await (await off.GET(new Request("http://localhost/api/demo-clock"))).json()).error, /npm run dev:demo/);
    const on = route({ NODE_ENV: "development", DEMO_CLOCK: "on" });
    assert.equal((await on.GET(new Request("http://localhost/api/demo-clock"))).status, 200, "GET in demo mode");
    assert.equal((await on.DELETE(new Request("http://localhost/api/demo-clock", { method: "DELETE" }))).status, 200, "reset in demo mode");
  });

  await test("pages read the demo day, not a clock ticking every second (source)", () => {
    const provider = read("./DemoClockContext.tsx");
    assert.match(provider, /const value = useMemo\(/, "the context value is kept between renders");
    assert.doesNotMatch(provider, /effectiveNow/, "no per-second time in the context");
    assert.equal((provider.match(/1_000\)/g) ?? []).length, 1, "one 1-second timer");
    assert.match(provider, /export function useTickingLabel[\s\S]*?setInterval\(tick, 1_000\)/, "and it is the badge's and panel's label");
    assert.match(provider, /setInterval\(check, 30_000\)/, "the day is checked twice a minute");
    const camera = read("../app/(app)/camera/CameraClient.tsx");
    assert.match(camera, /const \{ todayKey: effectiveTodayPH \} = useDemoClock\(\);/, "the camera page takes the day");
    assert.doesNotMatch(camera, /effectiveNow|logout/, "no ticking clock and no Log Out on the camera page");
    for (const page of ["../app/(app)/dashboard/admin/page.tsx", "../app/(app)/dashboard/patient/page.tsx",
      "../app/(app)/dashboard/patient/ConsistencyCalendar.tsx", "../app/(app)/dashboard/therapist/assign/page.tsx"]) {
      assert.doesNotMatch(read(page), /effectiveNow/, `${page} reads the day`);
    }
  });

  await test("reminders take tomorrow from the same clock, and the demo command switches the clock on (source)", () => {
    const sync = functionText(["syncTimeNotifications"]);
    assert.match(sync, /const now = await getEffectiveNow\(\);/);
    assert.match(sync, /const tomorrowStr = manilaDayKey\(now\.getTime\(\) \+ DAY_MS\);/);
    assert.doesNotMatch(sync, /new Date\(\);\s*tomorrow\.setDate/, "no real-clock tomorrow");
    const scripts = JSON.parse(read("../../package.json")).scripts;
    assert.equal(scripts["dev:demo"], "node scripts/dev-demo.mjs");
    const launcher = read("../../scripts/dev-demo.mjs");
    assert.match(launcher, /DEMO_CLOCK: "on"/);
    assert.match(launcher, /\["run", "dev"/, "it runs the normal dev script with the clock on");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

void run();
