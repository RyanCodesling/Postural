/**
 * Read-only export of per-session, per-side measure values for the offline
 * trend-model evaluation (ml/trend). Runs inside a READ ONLY transaction and
 * writes one JSON file; it never modifies the database.
 *
 *   npx tsx scripts/export-trend-measures.ts [--out ../ml/data/trend/tier1_sessions.json]
 *
 * Each session lists the unit values (repetitions, or sets for holds) behind each
 * measure, so the evaluation can compute session means, unit counts and pooled
 * within-session variation itself.
 *
 * Repetitions follow the trend data rules the app's charts use
 * (src/lib/analytics/trendRules.ts): timing skips each set's first repetition per
 * side, a poorly tracked repetition is left out, a poorly tracked session is not
 * exported, and a neck side bend's peaks and completion are measured from the
 * resting head position, leaving out repetitions without a resting reading.
 *
 * Angles are exported in the aspect-corrected unit the app measures in since
 * 2026-10-21 (D-48). Sessions measured before then are converted, each angle
 * on its own geometry at the session's frame shape (see `sessionUnit`).
 */
import { Client } from "pg";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NECK_REST_EXERCISES,
  TREND_RULES_VERSION,
  neckRestOffsetAt,
  neckRestPeak,
  repPoorlyTracked,
  repTrackingShare,
  sessionPoorlyTracked,
} from "../src/lib/analytics/trendRules";
import { parseNeckRestRecord } from "../src/lib/sessionReadModels";
import { POSE_METRIC_ALGORITHM_VERSION } from "../src/lib/pose/metricVersion";
import { frameAspectOf } from "../src/lib/pose/poseMetrics";

const here = dirname(fileURLToPath(import.meta.url));

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const text = readFileSync(join(here, "..", ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
      if (match) return match[1].replace(/^["']|["']$/g, "");
    }
  } catch {
    // fall through
  }
  throw new Error("DATABASE_URL not set and not found in web/.env.local");
}

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

type Side = "left" | "right";
type SideUnits = { left: number[]; right: number[] };
type SessionOut = {
  sessionId: number;
  patientId: string;
  exerciseId: string;
  kind: "dynamic" | "isometric" | null;
  startedAt: string;
  configVersion: string;
  prescribedSide: string;
  resistance: unknown;
  /** The measurement the angles were taken with, and how they were brought to the corrected unit. */
  measurement: { poseMetrics: string | null; converted: boolean; frameAspect: number; frameSource: string };
  units: Record<string, SideUnits | { card: number[] }>;
};

/**
 * Sessions measured before the aspect correction (2026-10-21, D-48) hold their
 * angles in pipeline units, normalised separately by frame width and height.
 * Each is converted on its own geometry at the session's frame shape: its
 * recorded frame sizes (the size with the most frames), or 1280x720, the
 * laptop webcam every pilot session used before sizes were recorded (D-23,
 * 2026-10-12 and 10-14).
 *   a  the neck's ear line against the tilt (near-horizontal):  atan(tan r / k)
 *   b  the side bend's head lean from neutral (near-vertical):  atan(k tan r)
 *   c  the arm against the trunk (abduction):                    atan2(k sin r, cos r)
 * The press reads a trunk-length ratio and is left as stored. Converting a
 * stored peak this way lands within 0.05 +/- 1.07 of recomputing it from the
 * landmarks on the traced pilot repetitions
 * (Review_Artifacts/2026-10-21_aspect_lift/conversion_error.txt).
 */
const ANGLE_GEOMETRY: Record<string, "a" | "b" | "c"> = {
  ex_001: "c", ex_002: "c", ex_004: "a", ex_005: "b", ex_006: "c", ex_008: "c",
};
const RAD = Math.PI / 180;
function sessionUnit(row: { exercise_id: string; pose_metrics: string | null; frame_sizes: unknown }) {
  const sizes = Array.isArray(row.frame_sizes)
    ? (row.frame_sizes as { width?: unknown; height?: unknown; frames?: unknown }[])
      .filter((f) => finite(f.width) && finite(f.height) && finite(f.frames))
    : [];
  const top = sizes.sort((x, y) => (y.frames as number) - (x.frames as number))[0];
  const k = top ? frameAspectOf(top.width as number, top.height as number) : frameAspectOf(1280, 720);
  const converted = row.pose_metrics !== POSE_METRIC_ALGORITHM_VERSION;
  const geometry = converted ? ANGLE_GEOMETRY[row.exercise_id] : undefined;
  const convert = geometry === "a" ? (r: number) => Math.atan(Math.tan(r * RAD) / k) / RAD
    : geometry === "b" ? (r: number) => Math.atan(k * Math.tan(r * RAD)) / RAD
    : geometry === "c" ? (r: number) => Math.atan2(k * Math.sin(r * RAD), Math.cos(r * RAD)) / RAD
    : null;
  // The abduction conversion's slope at r: a hold's spread and drift scale by it.
  const slope = geometry === "c" ? (r: number) => k / (Math.cos(r * RAD) ** 2 + k * k * Math.sin(r * RAD) ** 2) : null;
  return {
    convert, slope,
    measurement: { poseMetrics: row.pose_metrics, converted: convert !== null, frameAspect: k,
      frameSource: top ? `${top.width}x${top.height} (recorded)` : "1280x720 (assumed)" },
  };
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function emptySides(): SideUnits {
  return { left: [], right: [] };
}

async function main() {
  const out = resolve(argValue("--out") ?? join(here, "..", "..", "ml", "data", "trend", "tier1_sessions.json"));
  const client = new Client({ connectionString: resolveDatabaseUrl() });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const sessions = (await client.query(`
      SELECT s.id, s.patient_id, s.exercise_id, s.started_at,
             COALESCE(s.exercise_config_version, 'legacy-unversioned') AS cfg,
             COALESCE(s.context_snapshot->'prescription'->>'prescribedSide', 'both') AS prescribed_side,
             s.context_snapshot->'prescription'->'resistance' AS resistance,
             s.capture_quality_summary->'neckRest' AS neck_rest,
             s.context_snapshot->'versions'->>'poseMetrics' AS pose_metrics,
             s.capture_quality_summary->'frameSizes' AS frame_sizes
        FROM sessions s
       WHERE s.device_info IS NOT NULL
       ORDER BY s.started_at, s.id`)).rows;
    const reps = (await client.query(`
      SELECT session_id, set_index, side, peak_value, classification, time_to_peak_ms, descent_ms,
             total_ms, compensations, target_rom, start_ts
        FROM rep_events
       ORDER BY session_id, set_index, rep_index`)).rows;
    const sets = (await client.query(`
      SELECT session_id, exercise_kind, target_hold_ms, hold_quality
        FROM set_events
       WHERE (hold_quality->'auditOnly') IS DISTINCT FROM 'true'::jsonb
       ORDER BY session_id, set_index`)).rows;
    await client.query("ROLLBACK");

    const bySession = new Map<number, SessionOut>();
    const units = new Map<number, ReturnType<typeof sessionUnit>>();
    // Trend data rule 4: each neck session's still-head readings, per calibration.
    const neckRest = new Map<number, ReturnType<typeof parseNeckRestRecord>>();
    for (const row of sessions) {
      if (NECK_REST_EXERCISES.has(row.exercise_id)) neckRest.set(row.id, parseNeckRestRecord(row.neck_rest));
    }
    for (const row of sessions) {
      const unit = sessionUnit(row);
      units.set(row.id, unit);
      bySession.set(row.id, {
        sessionId: row.id,
        patientId: row.patient_id,
        exerciseId: row.exercise_id,
        kind: null,
        startedAt: new Date(row.started_at).toISOString(),
        configVersion: row.cfg,
        prescribedSide: row.prescribed_side,
        resistance: row.resistance ?? { type: "unknown", value: null, unit: null, label: null },
        measurement: unit.measurement,
        units: {},
      });
    }

    const sideUnits = (session: SessionOut, measure: string): SideUnits => {
      const existing = session.units[measure];
      if (existing && "left" in existing) return existing;
      const created = emptySides();
      session.units[measure] = created;
      return created;
    };

    // Trend data rule 3: a session with at least half its tracked repetitions
    // poorly tracked is not exported.
    const tracking = new Map<number, { tracked: number; poor: number }>();
    for (const rep of reps) {
      const t = tracking.get(rep.session_id) ?? { tracked: 0, poor: 0 };
      if (repTrackingShare(rep.compensations) !== null) t.tracked += 1;
      if (repPoorlyTracked(rep.compensations)) t.poor += 1;
      tracking.set(rep.session_id, t);
    }
    const heldOut = new Set([...tracking].filter(([, t]) => sessionPoorlyTracked(t.tracked, t.poor)).map(([id]) => id));
    // Trend data rule 1: each set's first repetition per side skips the timing measures.
    const seenSetSide = new Set<string>();

    for (const rep of reps) {
      const session = bySession.get(rep.session_id);
      if (!session || (rep.side !== "left" && rep.side !== "right")) continue;
      const firstOfSet = !seenSetSide.has(`${rep.session_id}:${rep.set_index}:${rep.side}`);
      seenSetSide.add(`${rep.session_id}:${rep.set_index}:${rep.side}`);
      // Trend data rule 2: a poorly tracked repetition counts in no measure.
      if (heldOut.has(rep.session_id) || repPoorlyTracked(rep.compensations)) continue;
      session.kind = "dynamic";
      const side = rep.side as Side;
      const convert = units.get(rep.session_id)?.convert ?? null;
      if (NECK_REST_EXERCISES.has(session.exerciseId)) {
        // Rule 4: the peak and completion from the resting position; a
        // repetition without a resting reading counts in neither. Completion
        // compares the peak with the target in the session's own unit; the
        // exported peak converts the reading and the rest offset first.
        const start = rep.start_ts ? new Date(rep.start_ts).getTime() : null;
        const offset = neckRestOffsetAt(neckRest.get(rep.session_id)?.epochs ?? null, start);
        if (offset !== null) {
          const recorded = finite(rep.peak_value) ? neckRestPeak(side, rep.peak_value, offset) : null;
          const peak = convert && finite(rep.peak_value) ? neckRestPeak(side, convert(rep.peak_value), convert(offset)) : recorded;
          if (peak !== null) sideUnits(session, "peak")[side].push(peak);
          const complete = recorded !== null && finite(rep.target_rom) ? recorded >= rep.target_rom : rep.classification === "complete";
          sideUnits(session, "complete")[side].push(complete ? 1 : 0);
        }
      } else {
        if (finite(rep.peak_value)) sideUnits(session, "peak")[side].push(convert ? convert(rep.peak_value) : rep.peak_value);
        sideUnits(session, "complete")[side].push(rep.classification === "complete" ? 1 : 0);
      }
      if (!firstOfSet) {
        if (finite(rep.total_ms)) sideUnits(session, "repDurationS")[side].push(rep.total_ms / 1000);
        if (finite(rep.descent_ms)) sideUnits(session, "loweringS")[side].push(rep.descent_ms / 1000);
        if (finite(rep.time_to_peak_ms)) sideUnits(session, "raisingS")[side].push(rep.time_to_peak_ms / 1000);
      }
      const exposures = rep.compensations?.rawFeatures?.compensations;
      if (exposures && typeof exposures === "object") {
        for (const [metric, value] of Object.entries(exposures as Record<string, { overThresholdFrac?: unknown }>)) {
          if (finite(value?.overThresholdFrac)) sideUnits(session, `exposure:${metric}`)[side].push(value.overThresholdFrac);
        }
      }
      if (!firstOfSet && finite(rep.time_to_peak_ms) && finite(rep.descent_ms) && rep.descent_ms > 0) {
        sideUnits(session, "raiseLowerRatio")[side].push(rep.time_to_peak_ms / rep.descent_ms);
      }
      const rawRule = rep.compensations?.rawRule;
      if (rawRule && finite(rawRule.meanScore) && finite(rawRule.coveragePct) && rawRule.coveragePct >= 80) {
        sideUnits(session, "formScore")[side].push(rawRule.meanScore);
      }
    }

    for (const set of sets) {
      const session = bySession.get(set.session_id);
      if (!session || set.exercise_kind !== "isometric") continue;
      session.kind = "isometric";
      const quality = set.hold_quality ?? {};
      const target = Number(set.target_hold_ms);
      const unit = units.get(set.session_id);
      for (const side of ["left", "right"] as const) {
        const inBand = quality[`${side}InBandMs`];
        if (finite(inBand) && target > 0) sideUnits(session, "inBandPct")[side].push((100 * inBand) / target);
        const arm = quality[side];
        if (arm && typeof arm === "object") {
          // Before the correction (D-48), a hold's spread and drift scale by the
          // conversion's slope at the hold's mean, and its distance from the
          // target is taken after converting the mean (the target, 90, maps to 90).
          const mean = finite(arm.meanDeg) ? arm.meanDeg : finite(arm.meanErrorDeg) ? 90 + arm.meanErrorDeg : null;
          const scale = unit?.slope && mean !== null ? unit.slope(mean) : 1;
          if (finite(arm.sdDeg)) sideUnits(session, "holdSteadiness")[side].push(arm.sdDeg * scale);
          if (finite(arm.meanErrorDeg)) {
            sideUnits(session, "holdError")[side].push(
              unit?.convert && mean !== null ? Math.abs(unit.convert(mean) - 90) : Math.abs(arm.meanErrorDeg));
          }
          if (finite(arm.droopSlopeDegPerSec)) sideUnits(session, "holdDroop")[side].push(arm.droopSlopeDegPerSec * scale);
        }
      }
      if (finite(quality.meanCompensationScore)) {
        const card = (session.units.holdFormScore as { card: number[] } | undefined) ?? { card: [] };
        card.card.push(quality.meanCompensationScore);
        session.units.holdFormScore = card;
      }
    }

    const withOutcome = [...bySession.values()].filter((s) => Object.keys(s.units).length > 0);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      JSON.stringify({
        exportedAt: new Date().toISOString(),
        source: "app-recorded sessions (device info present)",
        trendRules: TREND_RULES_VERSION,
        angleUnit: "aspect-corrected (D-48); sessions measured before 2026-10-21 converted, see each session's measurement",
        sessions: withOutcome,
      }, null, 1),
    );
    console.log(`exported ${withOutcome.length} sessions to ${out}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
