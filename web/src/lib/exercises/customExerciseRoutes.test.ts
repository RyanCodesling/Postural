/** Actual exercise routes/client helper with fixture auth/metadata and real
 * temporary video files. Database SQL is also covered by verify:exercises:db.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import * as customVideo from "./customVideo";
import * as storage from "./customVideoStorage";
import { parseRange } from "../recording/http";

const nodeRequire = createRequire(import.meta.url);
const tests: { name: string; run: () => Promise<void> }[] = [];
const test = (name: string, run: () => Promise<void>) => tests.push({ name, run });
const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 7]);
const WEBM = new Uint8Array([26, 69, 223, 163, 159, 66, 134, 129, 1, 8]);
const body = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
const params = { params: Promise.resolve({ id: "ex_fixture" }) };
const request = (mime: string, bytes: Uint8Array) => ({ headers: new Headers({ "content-type": mime }), body: body(bytes) });
const user = { id: "fixture-owner", role: "therapist" };
const next = { NextResponse: { json: (data: any, init?: any) => new Response(JSON.stringify(data), { status: init?.status ?? 200 }) } };

function load(relative: string, mocks: Record<string, any>, globals: Record<string, any> = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const context: any = vm.createContext({ exports: {}, console: { error() {} }, Response, ...globals,
    require(name: string) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("node:")) return nodeRequire(name);
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText, context);
  return context.exports;
}

function videoFixture(options: { publish?: (mime: string, name: string) => Promise<any>; files?: any } = {}) {
  let row: any = { id: "ex_fixture", is_custom: true, owner_therapist_id: user.id, archived_at: null };
  const route = load("../../app/api/exercises/[id]/video/route.ts", {
    "next/server": next, "@/lib/auth-server": { getAuthenticatedUser: async () => user },
    "@/lib/exercises/customVideo": customVideo,
    "@/lib/exercises/customVideoStorage": options.files ?? storage,
    "@/lib/recording/http": { parseRange },
    "@/lib/db": {
      getExerciseById: async () => row, canViewExerciseVideo: async () => true,
      isMissingColumnError: (error: any) => error?.code === "42703",
      setExerciseVideoFile: async (_id: string, mime: string, name: string) => {
        if (options.publish) return options.publish(mime, name);
        const previousVideo = customVideo.exerciseVideoFileFromRow(row);
        row = { ...row, video_mime_type: mime, video_file_name: name, youtube_video_id: null };
        return { exercise: row, previousVideo };
      },
    },
  });
  return { route, get row() { return row; }, set row(value: any) { row = value; } };
}

async function withFiles(run: (root: string) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), "custom-exercise-regression-"));
  const previous = process.env.EXERCISE_VIDEOS_DIR;
  process.env.EXERCISE_VIDEOS_DIR = root;
  try { await run(root); }
  finally {
    if (previous === undefined) delete process.env.EXERCISE_VIDEOS_DIR;
    else process.env.EXERCISE_VIDEOS_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

async function saveExisting(fixture: ReturnType<typeof videoFixture>) {
  const saved = await storage.saveExerciseVideo("ex_fixture", "video/mp4", body(MP4));
  if (typeof saved === "string") throw new Error(saved);
  fixture.row = { ...fixture.row, video_mime_type: "video/mp4", video_file_name: saved.fileName };
  return saved.fileName;
}

test("database failure preserves the current guide, including a legacy filename", async () => {
  await withFiles(async root => {
    const fixture = videoFixture({ publish: async () => { throw new Error("database unavailable"); } });
    writeFileSync(path.join(root, "ex_fixture.mp4"), MP4);
    fixture.row = { ...fixture.row, video_mime_type: "video/mp4", video_file_name: null };
    const response = await fixture.route.PUT(request("video/mp4", MP4), params);
    assert.equal(response.status, 500);
    const playback = await fixture.route.GET({ headers: new Headers() }, params);
    assert.equal(playback.status, 200);
    assert.deepEqual(new Uint8Array(await playback.arrayBuffer()), MP4);
  });
});

test("missing migration removes only the unpublished upload", async () => {
  await withFiles(async root => {
    const fixture = videoFixture({ publish: async () => { throw Object.assign(new Error("missing column"), { code: "42703" }); } });
    const current = await saveExisting(fixture);
    const response = await fixture.route.PUT(request("video/webm", WEBM), params);
    assert.equal(response.status, 503);
    assert.deepEqual(readdirSync(root), [current]);
  });
});

test("a lost commit acknowledgement retains the newly selected guide", async () => {
  await withFiles(async () => {
    const fixture = videoFixture({ publish: async (mime, name) => {
      fixture.row = { ...fixture.row, video_mime_type: mime, video_file_name: name };
      throw new Error("connection lost after commit");
    } });
    await saveExisting(fixture);
    assert.equal((await fixture.route.PUT(request("video/webm", WEBM), params)).status, 500);
    const playback = await fixture.route.GET({ headers: new Headers() }, params);
    assert.equal(playback.status, 200);
    assert.deepEqual(new Uint8Array(await playback.arrayBuffer()), WEBM);
  });
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

for (const first of ["mp4", "webm"] as const) {
  test(`overlapping uploads both succeed with ${first} publishing first`, async () => {
    await withFiles(async root => {
      const entered = { mp4: gate(), webm: gate() }, proceed = { mp4: gate(), webm: gate() };
      const fixture = videoFixture({ publish: async (mime, name) => {
        const kind = mime === "video/mp4" ? "mp4" : "webm";
        entered[kind].resolve(); await proceed[kind].promise;
        const previousVideo = customVideo.exerciseVideoFileFromRow(fixture.row);
        fixture.row = { ...fixture.row, video_mime_type: mime, video_file_name: name };
        return { exercise: fixture.row, previousVideo };
      } });
      await saveExisting(fixture);
      const requests = {
        mp4: fixture.route.PUT(request("video/mp4", MP4), params),
        webm: fixture.route.PUT(request("video/webm", WEBM), params),
      };
      await Promise.all([entered.mp4.promise, entered.webm.promise]);
      const last = first === "mp4" ? "webm" : "mp4";
      proceed[first].resolve(); assert.equal((await requests[first]).status, 200);
      proceed[last].resolve(); assert.equal((await requests[last]).status, 200);
      const playback = await fixture.route.GET({ headers: new Headers() }, params);
      assert.equal(playback.status, 200);
      assert.deepEqual(new Uint8Array(await playback.arrayBuffer()), last === "mp4" ? MP4 : WEBM);
      assert.deepEqual(readdirSync(root), [fixture.row.video_file_name]);
    });
  });
}

test("obsolete-file cleanup failure does not turn a committed upload into an error", async () => {
  await withFiles(async () => {
    const fixture = videoFixture({ files: { ...storage, deleteExerciseVideoFile: async () => { throw new Error("file busy"); } } });
    await saveExisting(fixture);
    assert.equal((await fixture.route.PUT(request("video/webm", WEBM), params)).status, 200);
    assert(await storage.openExerciseVideo("ex_fixture", "video/webm", fixture.row.video_file_name));
  });
});

test("an archived-during-upload result removes only that request's staged file", async () => {
  await withFiles(async root => {
    const fixture = videoFixture({ publish: async () => null });
    const current = await saveExisting(fixture);
    assert.equal((await fixture.route.PUT(request("video/webm", WEBM), params)).status, 404);
    assert.deepEqual(readdirSync(root), [current]);
  });
});

test("archive conflicts and refused draft cleanup return 409 without compensating mutations", async () => {
  class ExerciseInUseError extends Error {}
  let archives = 0;
  const route = load("../../app/api/exercises/[id]/route.ts", {
    "next/server": next, "@/lib/auth-server": { getAuthenticatedUser: async () => user },
    "@/lib/exercises/customVideoStorage": storage, "@/lib/exercises/customVideo": customVideo,
    "@/lib/db": { ExerciseInUseError,
      getExerciseById: async () => ({ id: "ex_fixture", is_custom: true, owner_therapist_id: user.id }),
      archiveExercise: async () => { archives++; throw new ExerciseInUseError("exercise in use"); },
      discardNewExercise: async () => "has-history",
      restoreExercise: async () => { throw new Error("cleanup must not restore anything"); },
    },
  });
  assert.equal((await route.DELETE({ nextUrl: new URL("http://fixture.invalid/api/exercises/ex_fixture") }, params)).status, 409);
  assert.equal(archives, 1);
  assert.equal((await route.DELETE({ nextUrl: new URL("http://fixture.invalid/api/exercises/ex_fixture?discardNew=true") }, params)).status, 409);
  assert.equal(archives, 1, "draft cleanup must not run archive side effects");
});

test("patient catalog requests use authenticated prescription scope", async () => {
  const patient = { id: "fixture-patient", role: "patient" };
  const route = load("../../app/api/exercises/route.ts", {
    "next/server": next, "@/lib/auth-server": { getAuthenticatedUser: async () => patient },
    "@/lib/exercises/customVideo": customVideo, "@/lib/exercises/deprecated": { DEPRECATED_EXERCISE_IDS: new Set() },
    "@/lib/db": { getExercises: async (options: any) => {
      assert.equal(options.patientId, patient.id);
      assert.equal(options.includeArchived, false);
      return [{ id: "ex_assigned", youtube_video_id: "dQw4w9WgXcQ" }];
    } },
  });
  const response = await route.GET({ nextUrl: new URL("http://fixture.invalid/api/exercises?includeArchived=true&patientId=someone-else") });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).exercises.map((e: any) => e.id), ["ex_assigned"]);
});

test("invalid exercise names and bodies return 400 before any write", async () => {
  let writes = 0;
  const mocks = {
    "next/server": next, "@/lib/auth-server": { getAuthenticatedUser: async () => user },
    "@/lib/exercises/customVideo": customVideo, "@/lib/exercises/customVideoStorage": storage,
    "@/lib/exercises/deprecated": { DEPRECATED_EXERCISE_IDS: new Set() },
    "@/lib/db": {
      getExerciseById: async () => ({ id:"ex_fixture", is_custom:true, owner_therapist_id:user.id }),
      createExercise: async () => { writes++; }, updateExercise: async () => { writes++; },
      isMissingColumnError: () => false,
    },
  };
  const create = load("../../app/api/exercises/route.ts", mocks);
  const edit = load("../../app/api/exercises/[id]/route.ts", mocks);
  for (const value of [null, [], {name:7,description:"Fixture"}, {name:"x".repeat(256),description:"Fixture"}, {name:"Fixture",description:{}}]) {
    assert.equal((await create.POST({json:async()=>value})).status,400);
    assert.equal((await edit.PUT({json:async()=>value},params)).status,400);
  }
  assert.equal(writes,0);
});

for (const outcome of ["removed", "kept", "unknown"] as const) {
  test(`failed upload reports cleanup outcome: ${outcome}`, async () => {
    const helper = load("../../app/(app)/dashboard/_components/ExerciseVideoField.tsx", {
      react: {}, "react/jsx-runtime": {}, "@/lib/exercises/customVideo": customVideo,
    }, { fetch: async (_url: string, options: any) => {
      if (options.method === "POST") return { ok: true, json: async () => ({ exercise: { id: "ex_fixture" } }) };
      if (options.method === "PUT") return { ok: false, json: async () => ({ error: "upload failed" }) };
      if (outcome === "unknown") throw new Error("network lost");
      return { ok: outcome === "removed", status: outcome === "removed" ? 200 : 409, json: async () => ({ error: "already in use" }) };
    } });
    const result = await helper.createCustomExercise({ name: "Fixture", description: "Fixture" }, { source: "file", file: { name: "fixture.mp4", type: "video/mp4" } });
    assert.equal(result.error.includes("The exercise was not added."), outcome === "removed");
    if (outcome === "kept") assert(result.error.includes("The exercise was kept."));
    if (outcome === "unknown") assert(result.error.includes("could not be confirmed"));
  });
}

(async () => {
  let failed = 0;
  for (const { name, run } of tests) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([run(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("test timed out")), 10_000); })]);
      console.log(`PASS ${name}`);
    } catch (error) { failed++; console.error(`FAIL ${name}`, error); }
    finally { clearTimeout(timeout); }
  }
  console.log(`${tests.length - failed}/${tests.length} exercise-route regression cases passed`);
  if (failed) process.exitCode = 1;
})();
