/** Deterministic, offline pilot replay. No model inference or database access. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { getExerciseDefinition, type ExerciseDefinition } from "../src/lib/exercises/registry";
import { captureCoachingProvenance } from "../src/lib/pose/coachingConfig";
import { validSetMeasurement } from "../src/lib/pose/holdQuality";
import { POSE_METRIC_ALGORITHM_VERSION } from "../src/lib/pose/metricVersion";
import { restingEarLineDeg } from "../src/lib/pose/neckCalibrationReference";
import { medianFinite } from "../src/lib/pose/neutralCalibration";
import {
  computeScapularElevation, computeTiltReference, computeTrunkLateralFlexionUncorrectedSigned, frameAspectOf,
} from "../src/lib/pose/poseMetrics";
import { createCameraReplay, cameraPath } from "./lib/cameraReplayHarness";

const indices: Record<string, number> = { leftEar: 7, rightEar: 8, leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16, leftHip: 23, rightHip: 24 };
export function traceLandmarks(record: Record<string, any>) {
  const landmarks: any[] = [];
  for (const [name, index] of Object.entries(indices)) if (record[name]) landmarks[index] = { ...record[name] };
  return landmarks;
}
const RAD = Math.PI / 180;
const finiteOrNull = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The calibration a trace row was measured against, in the CURRENT measurement.
 * Traces recorded before the aspect correction (2026-10-21, D-48) store the
 * frozen tilt and baselines in the old unit. When the row carries the
 * calibration's samples they are recomputed from them at the trace's frame
 * shape, as `finalizeNeutralCalibration` does live; otherwise each value is
 * converted on its own line (the tilt is a near-horizontal line, the side-bend
 * neutral a near-vertical one, and the scapular ratio is left as stored).
 * The calibration's ear line (D-49, ex_004's zero) follows one policy whatever
 * the trace's unit: the replay runs the current code, so it is the line the
 * trace recorded, else the line the camera now freezes from the samples, else
 * absent (then ex_004 reads against the frozen tilt, as it did before D-49).
 */
export function replayCalibration(row: Record<string, any>, frameAspect: number) {
  const m = row.metrics;
  const samples = m.calibration?.samples as { landmarks: Record<string, any> }[] | undefined;
  const earLine = finiteOrNull(m.calibration?.earLineDeg)
    ?? (samples?.length ? restingEarLineDeg(samples.map((s) => ({ landmarks: traceLandmarks(s.landmarks), frameAspect }))) : null);
  const stored = { baselines: m.baselines ?? {}, frozenTilt: m.tiltReference.cameraTiltDeg as number, earLine };
  if (m.metricAlgorithmVersion === POSE_METRIC_ALGORITHM_VERSION) return { ...stored, source: "stored" as const };
  if (samples?.length) {
    const lms = samples.map((s) => traceLandmarks(s.landmarks));
    const tilt = medianFinite(lms.map((lm) => computeTiltReference(lm, frameAspect))
      .filter((t) => t.confidence !== "insufficient").map((t) => t.cameraTiltDeg));
    assert(tilt !== null, "calibration samples give no usable tilt");
    const reference = { cameraTiltDeg: tilt, confidence: "high" as const, divergenceDeg: null };
    const median = (values: (number | null)[]) => medianFinite(values.filter((v): v is number => v !== null));
    const b = stored.baselines;
    return {
      frozenTilt: tilt,
      baselines: {
        scapLeft: b.scapLeft == null ? null : median(lms.map((lm) => computeScapularElevation(lm, reference, "left", frameAspect))),
        scapRight: b.scapRight == null ? null : median(lms.map((lm) => computeScapularElevation(lm, reference, "right", frameAspect))),
        bidirectionalPrimary: b.bidirectionalPrimary == null ? null
          : median(lms.map((lm) => computeTrunkLateralFlexionUncorrectedSigned(lm, frameAspect))),
      },
      earLine,
      source: "recomputed-from-samples" as const,
    };
  }
  const k = frameAspect;
  const tilt = Math.atan(Math.tan(stored.frozenTilt * RAD) / k) / RAD;
  const neutral = finiteOrNull(stored.baselines.bidirectionalPrimary);
  return {
    frozenTilt: tilt,
    baselines: {
      ...stored.baselines,
      bidirectionalPrimary: neutral === null ? null : Math.atan(k * Math.tan(neutral * RAD)) / RAD,
    },
    earLine,
    source: "converted" as const,
  };
}

/** What-if runs only: dotted-path values set on a clone of the definition (recorded in results.json). */
function withOverrides(definition: ExerciseDefinition, overrides?: Record<string, unknown>): ExerciseDefinition {
  if (!overrides) return definition;
  const clone: any = structuredClone(definition);
  for (const [path, value] of Object.entries(overrides)) {
    const keys = path.split(".");
    let node = clone;
    for (const key of keys.slice(0, -1)) node = node[key];
    assert(node && keys.at(-1)! in node, `unknown definition path ${path}`);
    node[keys.at(-1)!] = value;
  }
  return clone;
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
  if (manifest.definitionOverrides) console.log(`WHAT-IF RUN: definition overrides ${JSON.stringify(manifest.definitionOverrides)}`);
  const outputs: any[] = [];
  for (const entry of manifest.recordings) {
    const snapshot = JSON.parse(read(entry.snapshot));
    const labelSource = entry.labels ? read(entry.labels) : null;
    const labels = labelSource && entry.labelFormat !== "windows" ? JSON.parse(labelSource) : null;
    const rows = snapshot.rows.filter((r: any) => r.session_id === entry.sessionId);
    assert(rows.length, `No frames for ${entry.id}`);
    const registered = getExerciseDefinition(entry.exerciseId);
    assert(registered);
    const definition = withOverrides(registered, manifest.definitionOverrides?.[entry.exerciseId]);
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
    // The camera loop measures in the recorded frame's aspect (D-48).
    const frame = validRows[0].metrics.frame ?? { width: 1280, height: 720 };
    const frameAspect = frameAspectOf(frame.width, frame.height);
    const calibrationSources: Record<string, number> = {};
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
        videoWidth: frame.width, videoHeight: frame.height,
      });
      const baselineReplay: ReturnType<typeof createCameraReplay> | null = baselineCamera ? createCameraReplay(definition, provenance, {
        prescribedSide: session?.context_snapshot?.prescription?.prescribedSide ?? "both",
        firstTickMs: validRows[0].elapsed_ms - 151 + phase, cameraSource: baselineCamera,
      }) : null;
      const groups: Record<string, any> = {};
      let priorBaseline: string | null = null;
      let calibration: ReturnType<typeof replayCalibration> | null = null;
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
        if (priorBaseline !== key || row.metrics.calibration?.samples?.length || calibration === null) {
          calibration = replayCalibration(row, frameAspect);
          if (phase === (manifest.tickOffsetsMs ?? [0])[0]) calibrationSources[calibration.source] = (calibrationSources[calibration.source] ?? 0) + 1;
        }
        priorBaseline = key;
        const frame = replay.tick({ tMs: row.elapsed_ms, landmarks: traceLandmarks(row.landmarks),
          baselines: calibration.baselines, frozenTilt: calibration.frozenTilt, earLine: calibration.earLine });
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
        // A repetition's tracking record (the display-only tracking check) is
        // newer than any preserved camera source, so it is left out here.
        const withoutTracking = (events: any[]) => events.map((e) => e?.compensations?.tracking === undefined ? e
          : { ...e, compensations: Object.fromEntries(Object.entries(e.compensations).filter(([key]) => key !== "tracking")) });
        assert.deepEqual(withoutTracking(replay.emitted), withoutTracking(baselineReplay.emitted), `${entry.id}: raw/live/features or rep events changed`);
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
      frame, calibrationSources,
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
  writeFileSync(join(out, "results.json"), JSON.stringify({ schema: "coaching_replay_v1", evidenceUse: "pilot-tuning",
    ...(manifest.definitionOverrides ? { definitionOverrides: manifest.definitionOverrides } : {}),
    inputHashes, sourceHashes, recordings: outputs }, null, 2) + "\n");
  const summary = outputs.map(o => ({ id: o.id, frames: o.replayedFrames, rejected: o.rejected.length,
    missingFrameIndices: o.missingFrameIndices, gapsOver300Ms: o.gapsOver300Ms.length,
    runs: o.phaseRuns.map((r: any) => ({ tickOffsetMs: r.initialTickOffsetMs, counts: r.counts, groups: r.groups })) }));
  writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  for (const row of summary) console.log(`${row.id}: ${row.frames} frames, ${row.rejected} rejected, ${row.missingFrameIndices} missing indices, ${row.gapsOver300Ms} gaps >300ms; ${row.runs.length} tick offsets`);
  console.log(`Reports: ${out}`);
}
if (process.argv[1]?.endsWith("replay-coaching.ts")) main().catch(e => { console.error(e); process.exitCode = 1; });
