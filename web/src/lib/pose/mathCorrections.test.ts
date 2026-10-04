import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { DynamicRepQualityBuffer, isDynamicRepQuality } from "./repQuality";
import { EXERCISE_REGISTRY } from "../exercises/registry";
import { createCameraReplay, transpile } from "../../../scripts/lib/cameraReplayHarness";
import { captureCoachingProvenance } from "./coachingConfig";
import { roundFilteredMetric } from "./metricPrecision";

function curve(seconds: number, scale = 1, offset = 0, gap = false) {
  const b = new DynamicRepQualityBuffer();
  for (let i = 0; i <= seconds * 30; i++) {
    if (gap && i >= 25 && i <= 31) continue;
    b.add("single", { tMs: i * 1000 / 30,
      rawPrimary: offset + scale * 50 * (1 - Math.cos(2 * Math.PI * i / (seconds * 30))),
      liveScore: 100, rawRuleScore: 100,
      rawCompensations: { trunkLean: 0, scapularElevation: 0, shoulderSymmetry: 0 } });
  }
  return b.finalize("single", { index: 1, startTimeMs: 0, endTimeMs: seconds * 1000,
    peakTimeMs: seconds * 500, peakValue: 100, ascentDurationMs: seconds * 500,
    descentDurationMs: seconds * 500, holdDurationMs: 0, totalDurationMs: seconds * 1000,
    classification: "complete" }, EXERCISE_REGISTRY.ex_001.compensationMetrics);
}

async function main() {
  const normal = curve(2), slow = curve(4), scaled = curve(2, 3, 15), gap = curve(2, 1, 0, true);
  const a = normal.rawFeatures!, b = slow.rawFeatures!;
  assert.equal(a.coveragePct, 100, "floating-point timestamps must not lose exact targets");
  assert.equal(b.coveragePct, 100);
  assert.equal(a.temporalStatus, "complete");
  assert(Number.isFinite(a.negLogDimensionlessJerk));
  assert(Math.abs(a.negLogDimensionlessJerk! - b.negLogDimensionlessJerk!) < .01, "time stretching preserves dimensionless jerk");
  assert(Math.abs(a.negLogDimensionlessJerk! - scaled.rawFeatures!.negLogDimensionlessJerk!) < 1e-5, "amplitude and offset invariance");
  // For x=A/2*(1-cos(2*pi*t/T)), the normalized integral is 8*pi^6.
  assert(Math.abs(a.negLogDimensionlessJerk! + Math.log(8 * Math.PI ** 6)) < .03, "analytic cosine reference");
  const g = gap.rawFeatures!;
  assert(g.coveragePct > 80 && g.coveragePct < 100);
  assert.equal(g.temporalStatus, "gapped");
  assert.equal(g.mlEligible, false);
  for (const key of ["tempoRatio", "negLogDimensionlessJerk", "submovementCount", "shapeP25", "shapeP50", "shapeP75"] as const) assert.equal(g[key], null);
  assert(g.compensations.trunkLean, "observed compensation aggregates survive");
  assert.equal(curve(2, 0).rawFeatures!.temporalStatus, "insufficient-motion");
  for (const q of [normal, slow, scaled, gap, curve(2, 0)]) assert(isDynamicRepQuality(JSON.parse(JSON.stringify(q))));
  assert(!isDynamicRepQuality({ ...gap, rawFeatures: { ...g, mlEligible: true } }));
  assert(!isDynamicRepQuality({ ...gap, rawFeatures: { ...g, negLogDimensionlessJerk: 1 } }));
  assert(!isDynamicRepQuality({ ...normal, version: 2 }), "new features cannot masquerade as legacy");
  // Execute the real API validator and SQL serializer with a disposable transport.
  const stored: unknown[] = [];
  const client = { release() {}, async query(sql: string, values: unknown[] = []) {
    if (sql.includes("INSERT INTO rep_events")) {
      stored.push(JSON.parse(values[11] as string));
      return { rowCount: 1 };
    }
    return { rowCount: 0 };
  } };
  const dbSource = readFileSync(new URL("../db.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("db.ts", dbSource, ts.ScriptTarget.Latest, true);
  const insert = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "insertRepEvents");
  assert(insert);
  const db = vm.createContext({ exports: {} as Record<string, (...args: unknown[]) => unknown>, pool: { connect: async () => client } });
  vm.runInContext(transpile(insert.getText(ast)), db);
  const route = vm.createContext({ exports: {} as Record<string, (...args: unknown[]) => Promise<Response>>, console,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } };
      if (name === "@/lib/auth-server") return { getAuthenticatedUser: async () => ({ id: "fixture", role: "patient" }) };
      if (name === "@/lib/db") return { getSessionOwner: async () => "fixture", insertRepEvents: db.exports.insertRepEvents };
      if (name === "@/lib/pose/repQuality") return { isDynamicRepQuality };
      throw new Error(name);
    } });
  vm.runInContext(transpile(readFileSync(new URL("../../app/api/sessions/[id]/rep-events/route.ts", import.meta.url), "utf8")), route);
  const response = await route.exports.POST({ json: async () => ({ reps: [normal, gap].map((q, i) => ({
    repIndex: i + 1, setIndex: 1, side: "left", peakValue: 100, targetRom: 90, timeToPeakMs: 1000,
    holdMs: 0, descentMs: 1000, totalMs: 2000, classification: "complete", compensations: q,
    startTs: "2026-09-27T00:00:00Z", endTs: "2026-09-27T00:00:02Z",
  })) }) }, { params: Promise.resolve({ id: "1" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).inserted, 2);
  assert.deepEqual(stored, [normal, gap], "V3 and null temporal features survive API and SQL JSON serialization");
  assert.equal(roundFilteredMetric("scapularElevation", .25126), .251);
  assert.equal(roundFilteredMetric("trunkLean", 1.234), 1.2, "angular counter precision unchanged");
  // Actual camera caller, with deterministic metric inputs.
  const def = EXERCISE_REGISTRY.ex_005;
  const replay = createCameraReplay(def, await captureCoachingProvenance(def));
  const primary = 21, scap = -.023 + .01306 * primary, neck = 11.7093 + 1.50466 * primary;
  replay.context.computePoseMetricsForExercise = () => ({ tiltReference: { cameraTiltDeg: 0, confidence: "high", divergenceDeg: 0 },
    metrics: { trunkLateralFlexion: primary, neckTilt: neck }, perSideMetrics: null, compensationScore: null });
  replay.context.computeTrunkLateralFlexionFromNeutralSigned = () => primary;
  replay.context.computeScapularElevation = () => .5 - scap;
  for (let i = 0; i < 40; i++) replay.tick({ tMs: 1000 + i * 33,
    landmarks: Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 1 })),
    baselines: { scapLeft: .5, scapRight: .5, bidirectionalPrimary: 0 } });
  assert.equal(replay.context.setFrameMetricsOutput.compensationScore, 100);
  const signal = replay.context.compensationWarningSignalsRef.current.get("scapularElevation");
  assert(Math.abs(signal.value) < .001, "camera must not manufacture a ~0.05 residual");
  assert(replay.frames.every(f => f.renderedTexts.length === 0), "no false cue after persistence window");
  console.log("PASS math corrections: analytic invariance, gap exclusion, schema and actual camera caller");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
