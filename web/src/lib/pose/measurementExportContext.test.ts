import assert from "node:assert/strict";
import type { SessionContextSnapshot } from "../prescriptionContext";
import { measurementExportContext } from "./measurementExportContext";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import vm from "node:vm";
import ts from "typescript";

assert.equal(measurementExportContext(null), null);
const context = {
  version: 3,
  exercise: { id: "ex_001", definition: { target: 12 } },
  versions: { exerciseConfig: "historical-hash", poseMetrics: "historical-version" },
  prescription: { exerciseId: "ex_001", sets: 2, reps: 10, holdSeconds: 0,
    prescribedSide: "left", patientExerciseId: 99, resistance: { label: "private" } },
  preSessionPain: { score: 3 }, videoConsent: { consentedAt: "private" },
} as unknown as SessionContextSnapshot;
const result = measurementExportContext(context)!;
assert.deepEqual(result.exercise, context.exercise);
assert.deepEqual(result.versions, context.versions);
assert.equal(result.prescription?.prescribedSide, "left");
assert(!JSON.stringify(result).includes("private"));
assert(!("preSessionPain" in result));
assert(!("patientExerciseId" in result.prescription!));

// Execute the actual export command with a disposable database/filesystem
// transport. This verifies the SELECT and JSON wiring, without DB access.
async function verifyExporter() {
  const sourceUrl = new URL("../../../scripts/export-tuning-traces.ts", import.meta.url);
  const source = readFileSync(sourceUrl, "utf8").replaceAll("import.meta.url", JSON.stringify(sourceUrl.href));
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const files = new Map<string, string>();
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  let error: unknown;
  class Client {
    async connect() {}
    async end() { finish(); }
    async query(sql: string) {
      if (sql.includes("SELECT s.id")) {
        assert(sql.includes("s.context_snapshot"));
        return { rows: [{ id: 7, exercise_id: "ex_001", context_snapshot: context }] };
      }
      if (sql.includes("FROM raw_frames")) return { rows: [{ captured_at: "2026-09-27T01:00:00Z", trace_kind: "upper_body_v4" }] };
      if (sql.includes("FROM rep_events")) return { rows: [] };
      if (sql.includes("FROM set_events")) return { rows: [{ set_index: 1, start_ts: "2026-09-27T01:00:00Z", end_ts: "2026-09-27T01:00:02Z" }] };
      throw new Error("Unexpected exporter query");
    }
  }
  vm.runInNewContext(code, {
    exports: {},
    process: { argv: ["node", "export", "--session", "7"], env: { DATABASE_URL: "fixture-only" }, exit: () => { finish(); } },
    console: { log() {}, error: (e: unknown) => { error = e; } },
    require: (name: string) => {
      if (name === "pg") return { Client };
      if (name === "node:fs") return { mkdirSync() {}, readFileSync, writeFileSync: (p: string, value: string) => files.set(p, value) };
      if (name === "node:path") return path;
      if (name === "node:url") return url;
      if (name.endsWith("measurementExportContext")) return { measurementExportContext };
      throw new Error(`Unexpected exporter dependency ${name}`);
    },
  });
  await finished;
  assert.equal(error, undefined);
  const saved = [...files].find(([name]) => name.endsWith("session_7_meta.json"));
  assert(saved, "actual exporter must write session metadata");
  assert.deepEqual(JSON.parse(saved[1]).measurementContext, result);
  assert.equal(JSON.parse(saved[1]).setCount, 1);
  const setFile = [...files].find(([name]) => name.endsWith("session_7_sets.ndjson"));
  assert(setFile);
  assert.equal(JSON.parse(setFile[1]).set_index, 1);
  console.log("measurementExportContext: projection and actual exporter transport passed");
}
verifyExporter().catch(error => { console.error(error); process.exitCode = 1; });
