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
 * side, a poorly tracked repetition is left out, and a poorly tracked session is
 * not exported.
 */
import { Client } from "pg";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TREND_RULES_VERSION, repPoorlyTracked, repTrackingShare, sessionPoorlyTracked } from "../src/lib/analytics/trendRules";

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
  units: Record<string, SideUnits | { card: number[] }>;
};

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
             s.context_snapshot->'prescription'->'resistance' AS resistance
        FROM sessions s
       WHERE s.device_info IS NOT NULL
       ORDER BY s.started_at, s.id`)).rows;
    const reps = (await client.query(`
      SELECT session_id, set_index, side, peak_value, classification, time_to_peak_ms, descent_ms,
             total_ms, compensations
        FROM rep_events
       ORDER BY session_id, set_index, rep_index`)).rows;
    const sets = (await client.query(`
      SELECT session_id, exercise_kind, target_hold_ms, hold_quality
        FROM set_events
       WHERE (hold_quality->'auditOnly') IS DISTINCT FROM 'true'::jsonb
       ORDER BY session_id, set_index`)).rows;
    await client.query("ROLLBACK");

    const bySession = new Map<number, SessionOut>();
    for (const row of sessions) {
      bySession.set(row.id, {
        sessionId: row.id,
        patientId: row.patient_id,
        exerciseId: row.exercise_id,
        kind: null,
        startedAt: new Date(row.started_at).toISOString(),
        configVersion: row.cfg,
        prescribedSide: row.prescribed_side,
        resistance: row.resistance ?? { type: "unknown", value: null, unit: null, label: null },
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
      if (finite(rep.peak_value)) sideUnits(session, "peak")[side].push(rep.peak_value);
      sideUnits(session, "complete")[side].push(rep.classification === "complete" ? 1 : 0);
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
      for (const side of ["left", "right"] as const) {
        const inBand = quality[`${side}InBandMs`];
        if (finite(inBand) && target > 0) sideUnits(session, "inBandPct")[side].push((100 * inBand) / target);
        const arm = quality[side];
        if (arm && typeof arm === "object") {
          if (finite(arm.sdDeg)) sideUnits(session, "holdSteadiness")[side].push(arm.sdDeg);
          if (finite(arm.meanErrorDeg)) sideUnits(session, "holdError")[side].push(Math.abs(arm.meanErrorDeg));
          if (finite(arm.droopSlopeDegPerSec)) sideUnits(session, "holdDroop")[side].push(arm.droopSlopeDegPerSec);
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
