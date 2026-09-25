/** Deterministic, offline pilot replay. No model inference or database access. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { getExerciseDefinition } from "../src/lib/exercises/registry";
import { captureCoachingProvenance } from "../src/lib/pose/coachingConfig";
import { validSetMeasurement } from "../src/lib/pose/holdQuality";
import { createCameraReplay, cameraPath } from "./lib/cameraReplayHarness";

const indices: Record<string, number> = { leftEar: 7, rightEar: 8, leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16, leftHip: 23, rightHip: 24 };
export function traceLandmarks(record: Record<string, any>) {
  const landmarks: any[] = [];
  for (const [name, index] of Object.entries(indices)) if (record[name]) landmarks[index] = { ...record[name] };
  return landmarks;
}
const hash = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1];

async function main() {
  assert(process.argv.includes("--manifest") && process.argv.includes("--out"), "Usage: npm run replay:coaching -- --manifest manifest.json --out NEW_DIRECTORY");
  const manifestPath = resolve(arg("--manifest"));
  const out = resolve(arg("--out"));
  assert(!existsSync(out), "Output directory must be new; inputs and prior runs are never overwritten.");
  const inputHashes: Record<string, string> = {};
  const read = (path: string) => { const p = resolve(dirname(manifestPath), path); const b = readFileSync(p); inputHashes[p] = hash(b); return b.toString("utf8"); };
  const manifest = JSON.parse(read(manifestPath));
  const baselineCamera = manifest.baselineCamera ? read(manifest.baselineCamera) : undefined;
  assert.equal(manifest.evidenceUse, "pilot-tuning");
  assert(Array.isArray(manifest.recordings) && manifest.recordings.length);
  const outputs: any[] = [];
  for (const entry of manifest.recordings) {
    const snapshot = JSON.parse(read(entry.snapshot));
    const labelSource = entry.labels ? read(entry.labels) : null;
    const labels = labelSource && entry.labelFormat !== "windows" ? JSON.parse(labelSource) : null;
    const rows = snapshot.rows.filter((r: any) => r.session_id === entry.sessionId);
    assert(rows.length, `No frames for ${entry.id}`);
    const definition = getExerciseDefinition(entry.exerciseId);
    assert(definition);
    const provenance = await captureCoachingProvenance(definition);
    const storedReps = (snapshot.reps ?? []).filter((r: any) => r.session_id === entry.sessionId);
    const sessions = snapshot.sessions ?? [];
    const session = sessions.find((s: any) => s.id === entry.sessionId);
    const gaps: any[] = [];
    let missingFrameIndices = 0;
    const validRows: any[] = [];
    const rejected: any[] = [];
    for (const row of rows) {
      const previous = validRows.at(-1);
      if (!Number.isFinite(row.elapsed_ms) || !Number.isInteger(row.frame_index) ||
          !row.landmarks || !Number.isFinite(row.metrics?.tiltReference?.cameraTiltDeg) ||
          previous && (row.elapsed_ms <= previous.elapsed_ms || row.frame_index <= previous.frame_index)) {
        rejected.push({ frame: row.frame_index, reason: "missing/invalid timing, landmarks, frozen tilt, or ordering" }); continue;
      }
      if (previous) {
        const ms = row.elapsed_ms - previous.elapsed_ms;
        if (ms > 300) gaps.push({ fromFrame: previous.frame_index, toFrame: row.frame_index, ms });
        missingFrameIndices += Math.max(0, row.frame_index - previous.frame_index - 1);
      }
      validRows.push(row);
    }
    assert(validRows.length, `No reconstructable frames for ${entry.id}`);
    // Keep original labels verbatim. Joining does not reinterpret intended
    // conditions as actual faults, or derive normal labels from model scores.
    const labelFor = (row: any): string => {
      if (entry.labelFormat === "windows") return entry.windows.find((w: any) => row.elapsed_ms >= w.startMs && row.elapsed_ms < w.endMs)?.intent ?? "unlabelled-transition";
      if (labels?.coreWindows) return labels.coreWindows.find((w: any) => row.frame_index >= w.startFrame && row.frame_index <= w.endFrame)?.phase ?? "unlabelled-transition";
      if (entry.labelFormat === "rep-events") {
        const rep = storedReps.find((r: any) => Date.parse(row.captured_at) >= Date.parse(r.start_ts) && Date.parse(row.captured_at) <= Date.parse(r.end_ts));
        return labels.attempts.find((a: any) => a.rep === rep?.rep_index)?.phase ?? "unlabelled-transition";
      }
      const a = labels?.attempts.find((a: any) => a.firstAnalysisFrame !== undefined
        ? row.frame_index >= a.firstAnalysisFrame && row.frame_index <= a.lastAnalysisFrame
        : row.elapsed_ms >= a.startElapsedMs && row.elapsed_ms <= a.endElapsedMs);
      return a?.declaredIntent ?? a?.condition ?? "unlabelled-transition";
    };
    const phaseRuns: any[] = [];
    for (const phase of manifest.tickOffsetsMs ?? [0, 50, 100, 150]) {
      const replay = createCameraReplay(definition, provenance, {
        prescribedSide: session?.context_snapshot?.prescription?.prescribedSide ?? "both",
        firstTickMs: validRows[0].elapsed_ms - 151 + phase,
      });
      const baselineReplay: ReturnType<typeof createCameraReplay> | null = baselineCamera ? createCameraReplay(definition, provenance, {
        prescribedSide: session?.context_snapshot?.prescription?.prescribedSide ?? "both",
        firstTickMs: validRows[0].elapsed_ms - 151 + phase, cameraSource: baselineCamera,
      }) : null;
      const groups: Record<string, any> = {};
      let priorBaseline: string | null = null;
      const baselineBoundaries: number[] = [];
      for (const row of validRows) {
        const key = JSON.stringify([row.metrics.baselines, row.metrics.tiltReference.cameraTiltDeg]);
        // A recorded baseline change is a known reset boundary. Missing
        // rejected frames elsewhere are not invented from a long interval.
        if (priorBaseline !== null && priorBaseline !== key) {
          baselineBoundaries.push(row.frame_index);
          for (const run of [replay, baselineReplay]) if (run) {
            run.context.leftRepCounterRef.current?.reset(); run.context.rightRepCounterRef.current?.reset();
            run.context.bidirectionalRepCounterRef.current?.reset();
            for (const name of ["metricFilters", "leftCompensationFilters", "rightCompensationFilters"]) run.context[`${name}Ref`].current.clear();
            run.context.leftPrimaryFilterRef.current.reset(); run.context.rightPrimaryFilterRef.current.reset();
          }
        }
        priorBaseline = key;
        const frame = replay.tick({ tMs: row.elapsed_ms, landmarks: traceLandmarks(row.landmarks),
          baselines: row.metrics.baselines, frozenTilt: row.metrics.tiltReference.cameraTiltDeg });
        if (baselineReplay) {
          const before = baselineReplay.tick({ tMs: row.elapsed_ms, landmarks: traceLandmarks(row.landmarks),
            baselines: row.metrics.baselines, frozenTilt: row.metrics.tiltReference.cameraTiltDeg });
          assert.deepEqual(frame.renderedTexts, before.renderedTexts, `${entry.id} frame ${row.frame_index}: visible text changed`);
          assert.deepEqual(frame.counts, before.counts, `${entry.id} frame ${row.frame_index}: counts changed`);
        }
        const intent = labelFor(row);
        const g = groups[intent] ??= { acceptedFrames: 0, renderedFrames: 0, textFrames: {} };
        g.acceptedFrames++;
        if (frame.renderedTexts.length) g.renderedFrames++;
        for (const text of frame.renderedTexts) g.textFrames[text] = (g.textFrames[text] ?? 0) + 1;
      }
      const set = replay.close();
      if (baselineReplay) {
        assert.deepEqual(replay.emitted, baselineReplay.emitted, `${entry.id}: raw/live/features or rep events changed`);
        const before = baselineReplay.close();
        if (before.holdQuality) for (const [key, value] of Object.entries(before.holdQuality)) {
          assert.deepEqual(JSON.parse(JSON.stringify(set.holdQuality[key])), JSON.parse(JSON.stringify(value)), `${entry.id}: hold field ${key} changed`);
        }
      }
      assert(validSetMeasurement(set.holdQuality, definition.kind), `${entry.id} invalid product writer output`);
      const counts = { left: replay.emitted.filter(r => r.side === "left").length, right: replay.emitted.filter(r => r.side === "right").length };
      if (entry.expectedRepCounts) assert.deepEqual(counts, entry.expectedRepCounts, `${entry.id}: counter regression`);
      phaseRuns.push({ initialTickOffsetMs: phase, groups, counts, baselineBoundaries, baselineCameraEquivalent: baselineReplay ? true : null,
        persistedRepCount: storedReps.length, replayRepCount: replay.emitted.length,
        setMeasurement: set.holdQuality, repEvents: replay.emitted });
    }
    outputs.push({ id: entry.id, sessionId: entry.sessionId, exerciseId: definition.id,
      labels: labelSource, labelJoin: entry.labelFormat, originalFrames: rows.length,
      replayedFrames: validRows.length, rejected, missingFrameIndices, gapsOver300Ms: gaps,
      provenance, phaseRuns,
      limits: ["Pilot/tuning evidence; intended conditions are not held-out or clinical ground truth.",
        "Accepted rows only. Rejected readiness frames and exact selector tick phase were not retained; tick offsets are sensitivity simulations.",
        "Readiness is treated as accepted because the trace omits nose/knees. No missing landmarks are synthesized for metrics.",
        "Integer elapsed_ms replaces the unavailable sub-millisecond camera clock; first-row filter history is unknown.",
        "Rendered text means draw calls in offline replay, not proof of historical screen exposure. No correction latency or clinical false-positive rate is inferred.",
        "Prescription completion is not reconstructed; the supplied frame stream defines the replay interval. Synthetic tests cover dropout/reset behavior.",
        "Current code/configuration is replayed, including current labels. Original recordings and label files are untouched."] });
  }
  const sourceHashes: Record<string, string> = {};
  for (const dir of ["src/lib/pose", "src/lib/exercises", "scripts/lib"]) {
    for (const f of readdirSync(dir).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"))) sourceHashes[join(dir, f)] = hash(readFileSync(join(dir, f)));
  }
  sourceHashes[relative(process.cwd(), cameraPath)] = hash(readFileSync(cameraPath));
  sourceHashes["scripts/replay-coaching.ts"] = hash(readFileSync("scripts/replay-coaching.ts"));
  // Ensure nothing changed under us before publishing the run.
  for (const [path, expected] of Object.entries(inputHashes)) assert.equal(hash(readFileSync(path)), expected);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "results.json"), JSON.stringify({ schema: "coaching_replay_v1", evidenceUse: "pilot-tuning", inputHashes, sourceHashes, recordings: outputs }, null, 2) + "\n");
  const summary = outputs.map(o => ({ id: o.id, frames: o.replayedFrames, rejected: o.rejected.length,
    missingFrameIndices: o.missingFrameIndices, gapsOver300Ms: o.gapsOver300Ms.length,
    runs: o.phaseRuns.map((r: any) => ({ tickOffsetMs: r.initialTickOffsetMs, counts: r.counts, groups: r.groups })) }));
  writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  for (const row of summary) console.log(`${row.id}: ${row.frames} frames, ${row.rejected} rejected, ${row.missingFrameIndices} missing indices, ${row.gapsOver300Ms} gaps >300ms; ${row.runs.length} tick offsets`);
  console.log(`Reports: ${out}`);
}
if (process.argv[1]?.endsWith("replay-coaching.ts")) main().catch(e => { console.error(e); process.exitCode = 1; });
