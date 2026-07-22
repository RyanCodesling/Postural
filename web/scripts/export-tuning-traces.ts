// Export recorded tuning traces (raw_frames) plus their sessions' rep_events
// to newline-delimited JSON for the offline analysis pipeline.
//
// For each matching session, writes to ml/data/real/<exercise_id>/:
//   session_<id>_frames.ndjson — one line per raw frame (payload + timing)
//   session_<id>_reps.ndjson   — that session's counted reps (rep windows)
//   session_<id>_meta.json     — session metadata (exercise, start/end, reason)
//
// The frames are RAW/unsmoothed metric values captured by the camera's
// "Record tuning trace" toggle (trace_kind upper_body_v2) or the original
// ex_007-only trace (ex_007_upper_body_v1). No image data exists in the DB.
//
// Run from Postural/web:
//   npx tsx scripts/export-tuning-traces.ts --exercise ex_001 [--session N] [--since YYYY-MM-DD]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const TRACE_KINDS = ["ex_007_upper_body_v1", "upper_body_v2"];

// ── DATABASE_URL (from env, else parse web/.env.local — same as seedDemo.ts) ─
function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const text = readFileSync(join(here, "..", ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
      if (m) {
        let v = m[1].trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        if (v) return v;
      }
    }
  } catch {
    /* fall through */
  }
  throw new Error("DATABASE_URL not set and not found in web/.env.local");
}

// ── CLI args ─────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]) {
  const args: { exercise?: string; session?: number; since?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--exercise") args.exercise = argv[++i];
    else if (a === "--session") args.session = Number(argv[++i]);
    else if (a === "--since") args.since = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.exercise && args.session === undefined) {
    throw new Error(
      "Usage: npx tsx scripts/export-tuning-traces.ts --exercise ex_001 [--session N] [--since YYYY-MM-DD]",
    );
  }
  if (args.session !== undefined && !Number.isInteger(args.session)) {
    throw new Error("--session must be an integer session id");
  }
  if (args.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(args.since)) {
    throw new Error("--since must be YYYY-MM-DD");
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  // scripts/ -> web/ -> Postural/ -> ml/data/real
  const outRoot = resolve(scriptDir, "../../ml/data/real");

  const client = new Client({ connectionString: resolveDatabaseUrl() });
  await client.connect();
  try {
    // Sessions that actually have trace frames, matching the filters.
    const conditions: string[] = [
      `EXISTS (SELECT 1 FROM raw_frames rf
               WHERE rf.session_id = s.id AND rf.trace_kind = ANY($1))`,
    ];
    const params: unknown[] = [TRACE_KINDS];
    if (args.exercise) {
      params.push(args.exercise);
      conditions.push(`s.exercise_id = $${params.length}`);
    }
    if (args.session !== undefined) {
      params.push(args.session);
      conditions.push(`s.id = $${params.length}`);
    }
    if (args.since) {
      params.push(args.since);
      conditions.push(`s.started_at >= $${params.length}::date`);
    }

    const sessions = await client.query(
      `SELECT s.id, s.exercise_id, s.patient_id, s.started_at, s.ended_at, s.end_reason
       FROM sessions s
       WHERE ${conditions.join(" AND ")}
       ORDER BY s.id`,
      params,
    );
    if (sessions.rows.length === 0) {
      console.log("No sessions with tuning-trace frames match the filters.");
      return;
    }

    for (const s of sessions.rows) {
      const outDir = join(outRoot, s.exercise_id);
      mkdirSync(outDir, { recursive: true });

      const frames = await client.query(
        `SELECT frame_index, set_index, elapsed_ms, captured_at, trace_kind, metrics, landmarks
         FROM raw_frames
         WHERE session_id = $1 AND trace_kind = ANY($2)
         ORDER BY frame_index`,
        [s.id, TRACE_KINDS],
      );
      const reps = await client.query(
        `SELECT rep_index, set_index, side, peak_value, target_rom, classification,
                time_to_peak_ms, hold_ms, descent_ms, total_ms, start_ts, end_ts
         FROM rep_events
         WHERE session_id = $1
         ORDER BY rep_index`,
        [s.id],
      );

      const framesPath = join(outDir, `session_${s.id}_frames.ndjson`);
      writeFileSync(
        framesPath,
        frames.rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
        "utf8",
      );
      const repsPath = join(outDir, `session_${s.id}_reps.ndjson`);
      writeFileSync(
        repsPath,
        reps.rows.length > 0
          ? reps.rows.map((r) => JSON.stringify(r)).join("\n") + "\n"
          : "",
        "utf8",
      );
      writeFileSync(
        join(outDir, `session_${s.id}_meta.json`),
        JSON.stringify(
          {
            sessionId: s.id,
            exerciseId: s.exercise_id,
            patientId: s.patient_id,
            startedAt: s.started_at,
            endedAt: s.ended_at,
            endReason: s.end_reason,
            traceKinds: [...new Set(frames.rows.map((r) => r.trace_kind))],
            frameCount: frames.rows.length,
            repCount: reps.rows.length,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      console.log(
        `session ${s.id} (${s.exercise_id}): ${frames.rows.length} frames, ` +
        `${reps.rows.length} reps -> ${outDir}`,
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
