// Demo / synthetic data generator for the dashboards.
//
// Populates the EXISTING demo accounts (therapist@clinic.com / patient@example.com)
// plus a few extra demo patients so every dashboard screen, status tag, trend
// badge, and KPI shows realistic activity. This is throwaway DEMO data for UI
// population — NOT real patient data, and NOT the ML training set. All generated
// rows are scoped to `demo_*` ids or the two known demo accounts.
//
// Run from Postural/web:   npm run seed:demo
// Idempotent: clears demo_* rows and resets the two demo accounts, then reseeds.
// Deterministic: fixed PRNG seed → identical data every run.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { getExerciseDefinition } from "../src/lib/exercises/registry";

// ── DATABASE_URL (from env, else parse web/.env.local) ───────────────────────
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

// ── Deterministic PRNG (mulberry32 — same approach as profileOneEuroFilter.ts) ─
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260604);
const jitter = (amp: number) => (rand() * 2 - 1) * amp;

const DAY_MS = 24 * 60 * 60 * 1000;
const THERAPIST_ID = "therapist_001";

// ── Demo plan ────────────────────────────────────────────────────────────────
type TrendDir = "improving" | "plateau" | "regressing";

interface ExercisePlan {
  exerciseId: string;
  status: "pending" | "in_progress" | "completed";
  sessions: number;
  trend: TrendDir;
  /** end_reason of the most-recent session; null → leave it open ("In Progress"). */
  lastEndReason: "completed" | "user" | null;
}

interface PatientPlan {
  id: string;
  existing: boolean; // true → already in users (patient_001); false → create
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  age: number;
  gender: string;
  diagnosis: string;
  exercises: ExercisePlan[];
}

const SETS = 3;
const REPS = 12;
const HOLD_SECONDS = 30;

const PATIENTS: PatientPlan[] = [
  {
    id: "patient_001", existing: true, email: "patient@example.com",
    name: "John Patient", firstName: "John", lastName: "Patient",
    age: 54, gender: "male", diagnosis: "Right rotator cuff tendinopathy",
    exercises: [
      { exerciseId: "ex_001", status: "completed",   sessions: 6, trend: "improving", lastEndReason: "completed" }, // Completed
      { exerciseId: "ex_004", status: "in_progress", sessions: 5, trend: "improving", lastEndReason: "user" },      // Ended Early
      { exerciseId: "ex_006", status: "in_progress", sessions: 5, trend: "improving", lastEndReason: null },        // In Progress (open)
      { exerciseId: "ex_008", status: "pending",     sessions: 0, trend: "improving", lastEndReason: null },        // Not Started
    ],
  },
  {
    id: "demo_patient_b", existing: false, email: "demo.maria@example.com",
    name: "Maria Santos", firstName: "Maria", lastName: "Santos",
    age: 38, gender: "female", diagnosis: "Post-op left shoulder (adhesive capsulitis)",
    exercises: [
      { exerciseId: "ex_001", status: "completed",   sessions: 6, trend: "improving", lastEndReason: "completed" },
      { exerciseId: "ex_005", status: "in_progress", sessions: 5, trend: "improving", lastEndReason: "completed" },
    ],
  },
  {
    id: "demo_patient_c", existing: false, email: "demo.liam@example.com",
    name: "Liam Cruz", firstName: "Liam", lastName: "Cruz",
    age: 45, gender: "male", diagnosis: "Chronic neck and shoulder tension",
    exercises: [
      { exerciseId: "ex_008", status: "in_progress", sessions: 6, trend: "plateau",    lastEndReason: "completed" }, // Plateau badge
      { exerciseId: "ex_001", status: "in_progress", sessions: 6, trend: "regressing", lastEndReason: "user" },      // Regressing badge
    ],
  },
  {
    id: "demo_patient_d", existing: false, email: "demo.aisha@example.com",
    name: "Aisha Khan", firstName: "Aisha", lastName: "Khan",
    age: 29, gender: "female", diagnosis: "Cervical strain (whiplash)",
    exercises: [
      { exerciseId: "ex_001", status: "pending", sessions: 0, trend: "improving", lastEndReason: null }, // Needs attention
      { exerciseId: "ex_004", status: "pending", sessions: 0, trend: "improving", lastEndReason: null },
    ],
  },
  {
    id: "demo_patient_e", existing: false, email: "demo.tomas@example.com",
    name: "Tomas Reyes", firstName: "Tomas", lastName: "Reyes",
    age: 61, gender: "male", diagnosis: "Frozen shoulder (right)",
    exercises: [], // No exercises yet
  },
];

// 2 demo programs so the therapist "Programs" KPI is non-zero.
const PROGRAMS = [
  { id: "demo_program_shoulder", name: "Shoulder Rehab — Phase 1", exerciseIds: ["ex_001", "ex_008"] },
  { id: "demo_program_neck",     name: "Neck Mobility",            exerciseIds: ["ex_004", "ex_005"] },
];

// ── Trend → per-session primary value ────────────────────────────────────────
function progress(idx: number, total: number): number {
  return total <= 1 ? 1 : idx / (total - 1); // 0 (oldest) → 1 (newest)
}
function trendValue(trend: TrendDir, p: number, lo: number, hi: number, mid: number): number {
  if (trend === "improving") return lo + (hi - lo) * p;
  if (trend === "regressing") return hi - (hi - lo) * p;
  return mid; // plateau
}
/** Session's central primary value: ROM° for dynamic, hold-seconds for isometric. */
function sessionPrimary(exerciseId: string, trend: TrendDir, idx: number, total: number): number {
  const def = getExerciseDefinition(exerciseId);
  const p = progress(idx, total);
  if (def && def.kind === "isometric") {
    return trendValue(trend, p, HOLD_SECONDS * 0.4, HOLD_SECONDS * 0.95, HOLD_SECONDS * 0.7);
  }
  const target = def && def.kind === "dynamic" ? def.primaryMetric.thresholds.targetROM : 90;
  return trendValue(trend, p, target * 0.72, target * 1.02, target * 0.85);
}

function iso(d: Date): string {
  return d.toISOString();
}

// ── Tally ────────────────────────────────────────────────────────────────────
const tally = { patients: 0, programs: 0, sessions: 0, sets: 0, reps: 0 };

async function main() {
  const client = new Client({ connectionString: resolveDatabaseUrl() });
  await client.connect();
  try {
    // Prereq accounts must exist (from user_credentials_pg.sql).
    for (const id of [THERAPIST_ID, "patient_001"]) {
      const r = await client.query("SELECT 1 FROM users WHERE id = $1", [id]);
      if (r.rowCount === 0) {
        throw new Error(`${id} is missing — run scripts/user_credentials_pg.sql (and the other *_pg.sql schema scripts) first.`);
      }
    }

    await client.query("BEGIN");

    // ── Idempotent cleanup (demo_* rows + the two demo accounts' content) ──
    await client.query("DELETE FROM users WHERE id LIKE 'demo\\_%'"); // cascades their sessions/exercises
    await client.query("DELETE FROM exercise_programs WHERE id LIKE 'demo\\_%'");
    await client.query("DELETE FROM sessions WHERE patient_id = 'patient_001'"); // cascades set/rep events
    await client.query("DELETE FROM patient_exercises WHERE patient_id = 'patient_001'");
    await client.query("UPDATE users SET therapist_id = $1 WHERE id = 'patient_001'", [THERAPIST_ID]);

    // ── Patients ──
    for (const plan of PATIENTS) {
      if (!plan.existing) {
        await client.query(
          `INSERT INTO users (id, email, password, name, first_name, last_name, role, therapist_id, age, gender, diagnosis)
           VALUES ($1,$2,$3,$4,$5,$6,'patient',$7,$8,$9,$10)
           ON CONFLICT (id) DO NOTHING`,
          [plan.id, plan.email, "demo123", plan.name, plan.firstName, plan.lastName, THERAPIST_ID, plan.age, plan.gender, plan.diagnosis],
        );
      }
      tally.patients++;

      for (const ex of plan.exercises) {
        const def = getExerciseDefinition(ex.exerciseId);
        const isIso = def?.kind === "isometric";

        // Assignment row.
        const peRes = await client.query(
          `INSERT INTO patient_exercises (exercise_id, patient_id, assigned_date, status, sets, reps, rest_seconds, hold_seconds)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [ex.exerciseId, plan.id, iso(new Date(Date.now() - 28 * DAY_MS)).slice(0, 10), ex.status, SETS, REPS, 60, HOLD_SECONDS],
        );
        const patientExerciseId = peRes.rows[0].id as number;

        // Sessions, oldest → newest. Newest at ~1 day ago (within the 7-day window).
        for (let s = 0; s < ex.sessions; s++) {
          const isLast = s === ex.sessions - 1;
          const dayOffset = (ex.sessions - 1 - s) * 4 + 1; // newest = 1 day ago
          const startedAt = new Date(Date.now() - dayOffset * DAY_MS);
          startedAt.setHours(9 + Math.floor(rand() * 8), Math.floor(rand() * 55), 0, 0);

          const endReason = isLast ? ex.lastEndReason : "completed";
          const open = isLast && ex.lastEndReason === null;
          const setBlockMs = (isIso ? HOLD_SECONDS * 1000 * 2 : REPS * 2 * 2000) + 60000;
          const durationMs = SETS * setBlockMs - 60000;
          const endedAt = open ? null : new Date(startedAt.getTime() + durationMs);

          const sessRes = await client.query(
            `INSERT INTO sessions (patient_id, patient_exercise_id, exercise_id, started_at, ended_at, end_reason)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [plan.id, patientExerciseId, ex.exerciseId, startedAt, endedAt, endReason],
          );
          const sessionId = sessRes.rows[0].id as number;
          tally.sessions++;

          const central = sessionPrimary(ex.exerciseId, ex.trend, s, ex.sessions);
          let globalRep = 0;

          for (let setIdx = 1; setIdx <= SETS; setIdx++) {
            const setStart = new Date(startedAt.getTime() + (setIdx - 1) * setBlockMs);
            const setTermination = isLast && endReason === "user" && setIdx === SETS ? "user" : "min_reached";

            if (isIso) {
              const targetHoldMs = HOLD_SECONDS * 1000;
              const pairedHoldMs = Math.max(0, Math.round((central + jitter(1.5)) * 1000));
              const holdQuality = {
                sampleCount: Math.round(pairedHoldMs / 33),
                leftInBandMs: pairedHoldMs,
                rightInBandMs: pairedHoldMs,
                outOfPositionMs: Math.round(2000 + rand() * 2000),
                dropCount: rand() < 0.3 ? 1 : 0,
                longestPairedStreakMs: pairedHoldMs,
                settleMs: Math.round(1200 + rand() * 800),
                left:  { meanDeg: 90 + jitter(2), sdDeg: 2 + rand() * 2, meanErrorDeg: 2 + rand() * 3, droopSlopeDegPerSec: -(rand() * 0.2) },
                right: { meanDeg: 90 + jitter(2), sdDeg: 2 + rand() * 2, meanErrorDeg: 2 + rand() * 3, droopSlopeDegPerSec: -(rand() * 0.2) },
                meanCompensationScore: Math.round(80 + rand() * 15),
                minCompensationScore: Math.round(65 + rand() * 15),
              };
              await client.query(
                `INSERT INTO set_events
                   (session_id, set_index, exercise_kind, target_reps, left_reps, right_reps, paired_reps,
                    target_hold_ms, paired_hold_ms, duration_ms, terminated_by, asymmetry_index, start_ts, end_ts, hold_quality)
                 VALUES ($1,$2,'isometric',0,0,0,0,$3,$4,$5,$6,0,$7,$8,$9)`,
                [sessionId, setIdx, targetHoldMs, pairedHoldMs, setBlockMs - 60000, setTermination,
                 iso(setStart), iso(new Date(setStart.getTime() + pairedHoldMs)), JSON.stringify(holdQuality)],
              );
              tally.sets++;
              continue;
            }

            // Dynamic: per-side reps. Left runs slightly behind right (asymmetry signal).
            const targetRom = def && def.kind === "dynamic" ? def.primaryMetric.thresholds.targetROM : 90;
            const noise = targetRom * 0.03;
            const leftBias = -targetRom * 0.04;
            let leftComplete = 0;
            let rightComplete = 0;

            for (const side of ["left", "right"] as const) {
              const bias = side === "left" ? leftBias : 0;
              for (let r = 0; r < REPS; r++) {
                const peak = central + bias + jitter(noise);
                const complete = peak >= targetRom;
                if (complete) {
                  if (side === "left") leftComplete++;
                  else rightComplete++;
                }
                const repStart = new Date(setStart.getTime() + globalRep * 2000);
                await client.query(
                  `INSERT INTO rep_events
                     (session_id, rep_index, set_index, side, peak_value, target_rom,
                      time_to_peak_ms, hold_ms, descent_ms, total_ms, classification, start_ts, end_ts)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
                  [sessionId, globalRep + 1, setIdx, side, Number(peak.toFixed(3)), targetRom,
                   900, 350, 750, 2000, complete ? "complete" : "partial",
                   iso(repStart), iso(new Date(repStart.getTime() + 1800))],
                );
                globalRep++;
                tally.reps++;
              }
            }

            const asymmetry = Number((Math.abs(leftComplete - rightComplete) / Math.max(1, REPS)).toFixed(3));
            await client.query(
              `INSERT INTO set_events
                 (session_id, set_index, exercise_kind, target_reps, left_reps, right_reps, paired_reps,
                  target_hold_ms, paired_hold_ms, duration_ms, terminated_by, asymmetry_index, start_ts, end_ts, hold_quality)
               VALUES ($1,$2,'dynamic',$3,$4,$5,$6,0,0,$7,$8,$9,$10,$11,NULL)`,
              [sessionId, setIdx, REPS, REPS, REPS, REPS, setBlockMs - 60000, setTermination, asymmetry,
               iso(setStart), iso(new Date(setStart.getTime() + (setBlockMs - 60000)))],
            );
            tally.sets++;
          }
        }
      }
    }

    // ── Programs ──
    for (const prog of PROGRAMS) {
      await client.query(
        "INSERT INTO exercise_programs (id, therapist_id, name) VALUES ($1,$2,$3)",
        [prog.id, THERAPIST_ID, prog.name],
      );
      for (const exId of prog.exerciseIds) {
        const def = getExerciseDefinition(exId);
        await client.query(
          `INSERT INTO program_exercises (program_id, exercise_id, name, description, is_custom, sets, reps, rest_seconds, hold_seconds)
           VALUES ($1,$2,$3,$4,false,$5,$6,$7,$8)`,
          [prog.id, exId, def?.name ?? exId, "Demo program exercise.", SETS, REPS, 60, HOLD_SECONDS],
        );
      }
      tally.programs++;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }

  console.log("Demo seed complete:");
  console.log(`  patients : ${tally.patients} (under ${THERAPIST_ID})`);
  console.log(`  programs : ${tally.programs}`);
  console.log(`  sessions : ${tally.sessions}`);
  console.log(`  sets     : ${tally.sets}`);
  console.log(`  reps     : ${tally.reps}`);
  console.log("Log in as therapist@clinic.com / therapist123 or patient@example.com / patient123.");
}

main().catch((err) => {
  console.error("Demo seed FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
