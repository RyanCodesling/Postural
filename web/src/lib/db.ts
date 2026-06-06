import { Pool, PoolClient, types } from "pg";
import {
  generateSchedule,
  MAX_INTERVAL_DAYS,
  type Recurrence,
} from "@/lib/exercises/occurrences";

// Return DATE columns as plain YYYY-MM-DD strings instead of Date objects
types.setTypeParser(1082, (val: string) => val);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Local (Asia/Manila) YYYY-MM-DD day key. The whole app treats "a day" as a
// Manila calendar day (calendar, session gating); scheduling math must agree, so
// occurrence lookups compute today here rather than relying on the DB's
// CURRENT_DATE (which follows the server/session timezone).
function todayKeyPH(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

// Maps snake_case DB columns to camelCase for the app
function mapUser(row: Record<string, unknown>) {
  return {
    id:             row.id,
    email:          row.email,
    name:           row.name,
    firstName:      row.first_name        ?? null,
    middleName:     row.middle_name       ?? null,
    lastName:       row.last_name         ?? null,
    role:           row.role,
    clinicId:       row["clinicId"]       ?? null,
    therapistId:    row.therapist_id      ?? null,
    dateOfBirth:    row.date_of_birth     ?? null,
    age:            row.age               ?? null,
    gender:         row.gender            ?? null,
    diagnosis:      row.diagnosis         ?? null,
    prescription:   row.prescription      ?? null,
    condition:      row.condition         ?? null,
    therapistIDNum: row.therapist_id_num  ?? null,
    specialty:      row.specialty         ?? null,
    createdAt:      row.created_at        ?? null,
  };
}

export async function getNextUserId(role: string): Promise<string> {
  const result = await pool.query(
    "SELECT id FROM users WHERE role = $1 ORDER BY id DESC LIMIT 1",
    [role]
  );
  if (result.rows.length === 0) return `${role}_001`;
  const lastId = result.rows[0].id as string;
  const match = lastId.match(/_(\d+)$/);
  const next = match ? parseInt(match[1], 10) + 1 : 1;
  return `${role}_${String(next).padStart(3, "0")}`;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function getUserById(id: string) {
  const result = await pool.query(
    `SELECT u.*, t.name AS therapist_name
     FROM users u
     LEFT JOIN users t ON t.id = u.therapist_id
     WHERE u.id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return { ...mapUser(row), therapistName: row.therapist_name ?? null };
}

export async function getUser(email: string, role: string) {
  const result = await pool.query(
    "SELECT * FROM users WHERE email = $1 AND role = $2",
    [email, role]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function getUserByEmail(email: string) {
  const result = await pool.query(
    "SELECT * FROM users WHERE email = $1",
    [email]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function getUsers(filters?: { role?: string; therapistId?: string }) {
  let query = "SELECT * FROM users WHERE role IN ('patient', 'therapist')";
  const params: unknown[] = [];

  if (filters?.role) {
    params.push(filters.role);
    query += ` AND role = $${params.length}`;
  }
  if (filters?.therapistId) {
    params.push(filters.therapistId);
    query += ` AND therapist_id = $${params.length}`;
  }

  query += " ORDER BY name";
  const result = await pool.query(query, params);
  return result.rows.map(mapUser);
}

export async function createUser(data: {
  id: string;
  name: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email?: string;
  password: string;
  role: "patient" | "therapist";
  dateOfBirth?: string;
  age?: number;
  gender?: string;
  diagnosis?: string;
  prescription?: string;
  condition?: string;
  therapistIDNum?: string;
  specialty?: string;
}) {
  const result = await pool.query(
    `INSERT INTO users
       (id, email, password, name, first_name, middle_name, last_name,
        role, date_of_birth, age, gender,
        diagnosis, prescription, condition, therapist_id_num, specialty)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      data.id,
      data.email ?? null,
      data.password,
      data.name,
      data.firstName ?? null,
      data.middleName ?? null,
      data.lastName ?? null,
      data.role,
      data.dateOfBirth ?? null,
      data.age ?? null,
      data.gender ?? null,
      data.diagnosis ?? null,
      data.prescription ?? null,
      data.condition ?? null,
      data.therapistIDNum ?? null,
      data.specialty ?? null,
    ]
  );
  return mapUser(result.rows[0]);
}

export async function updateUser(id: string, data: Partial<{
  name: string;
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  therapistId: string | null;
  dateOfBirth: string;
  age: number;
  gender: string;
  diagnosis: string;
  prescription: string;
  condition: string;
  therapistIDNum: string;
  specialty: string;
}>) {
  const fields: string[] = [];
  const params: unknown[] = [];

  const columnMap: Record<string, string> = {
    name:           "name",
    firstName:      "first_name",
    middleName:     "middle_name",
    lastName:       "last_name",
    email:          "email",
    therapistId:    "therapist_id",
    dateOfBirth:    "date_of_birth",
    age:            "age",
    gender:         "gender",
    diagnosis:      "diagnosis",
    prescription:   "prescription",
    condition:      "condition",
    therapistIDNum: "therapist_id_num",
    specialty:      "specialty",
  };

  for (const [key, col] of Object.entries(columnMap)) {
    if (key in data) {
      params.push((data as Record<string, unknown>)[key]);
      fields.push(`${col} = $${params.length}`);
    }
  }

  if (fields.length === 0) return null;

  params.push(id);
  const result = await pool.query(
    `UPDATE users SET ${fields.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return result.rows.length > 0 ? mapUser(result.rows[0]) : null;
}

export async function deleteUser(id: string) {
  await pool.query("DELETE FROM users WHERE id = $1", [id]);
}

// ── Exercises ─────────────────────────────────────────────────────────────────

export async function getExercises() {
  const result = await pool.query("SELECT * FROM exercises ORDER BY id");
  return result.rows;
}

export async function getNextExerciseId(): Promise<string> {
  const result = await pool.query(
    "SELECT id FROM exercises WHERE id ~ '^ex_[0-9]+$' ORDER BY id DESC LIMIT 1"
  );
  if (result.rows.length === 0) return "ex_001";
  const lastId = result.rows[0].id as string;
  const match = lastId.match(/_(\d+)$/);
  const next = match ? parseInt(match[1], 10) + 1 : 1;
  return `ex_${String(next).padStart(3, "0")}`;
}

export async function createExercise(data: {
  id: string;
  name: string;
  description: string;
  isCustom?: boolean;
}) {
  const result = await pool.query(
    "INSERT INTO exercises (id, name, description, is_custom) VALUES ($1, $2, $3, $4) RETURNING *",
    [data.id, data.name, data.description, data.isCustom ?? false]
  );
  return result.rows[0];
}

export async function updateExercise(id: string, data: { name?: string; description?: string }) {
  const fields: string[] = [];
  const params: unknown[] = [];
  if (data.name !== undefined) { params.push(data.name); fields.push(`name = $${params.length}`); }
  if (data.description !== undefined) { params.push(data.description); fields.push(`description = $${params.length}`); }
  if (fields.length === 0) return null;
  params.push(id);
  const result = await pool.query(
    `UPDATE exercises SET ${fields.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function deleteExercise(id: string) {
  await pool.query("DELETE FROM exercises WHERE id = $1", [id]);
}

// ── Patient exercises ─────────────────────────────────────────────────────────

export const DEFAULT_REST_SECONDS = 60;
export const DEFAULT_HOLD_SECONDS = 30;

type PatientExerciseAssignment = {
  exerciseId: string;
  sets: number;
  reps: number;
  restSeconds?: number;
  scheduledDate?: string; // YYYY-MM-DD; the recurrence start day. Falls back to today.
  holdSeconds?: number;
  // Recurrence rule. 'interval' => every `intervalDays` days; 'weekly' => the
  // given weekdays. Both span [scheduledDate, endDate]. A missing/unknown
  // recurrence falls back to a single occurrence on scheduledDate.
  recurrence?: Recurrence;
  intervalDays?: number; // interval mode; every N days
  weekdays?: number[];   // weekly mode; JS getDay() numbering 0=Sun..6=Sat
  endDate?: string;      // inclusive window end (YYYY-MM-DD)
};

function normalizeRestSeconds(restSeconds: unknown): number {
  if (
    typeof restSeconds !== "number" ||
    !Number.isFinite(restSeconds) ||
    restSeconds < 0
  ) {
    return DEFAULT_REST_SECONDS;
  }
  return Math.floor(restSeconds);
}

// Hold duration must be at least 1 second — a 0-second hold is meaningless for
// an isometric exercise. Anything missing/invalid falls back to the default.
function normalizeHoldSeconds(holdSeconds: unknown): number {
  if (
    typeof holdSeconds !== "number" ||
    !Number.isFinite(holdSeconds) ||
    holdSeconds < 1
  ) {
    return DEFAULT_HOLD_SECONDS;
  }
  return Math.floor(holdSeconds);
}

export async function assignExercisesToPatient(
  patientId: string,
  exercises: PatientExerciseAssignment[]
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const ex of exercises) {
      const restSeconds = normalizeRestSeconds(ex.restSeconds);
      const holdSeconds = normalizeHoldSeconds(ex.holdSeconds);
      const startDate =
        ex.scheduledDate && /^\d{4}-\d{2}-\d{2}$/.test(ex.scheduledDate)
          ? ex.scheduledDate
          : todayKeyPH();
      // Default to 'interval' (daily, single-day window) when unspecified so a
      // missing rule yields exactly one occurrence rather than zero.
      const recurrence: Recurrence = ex.recurrence === "weekly" ? "weekly" : "interval";
      const intervalDays =
        recurrence === "interval"
          ? Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.floor(ex.intervalDays ?? 1)))
          : null;
      const weekdays =
        recurrence === "weekly"
          ? (ex.weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
          : null;
      const endDate =
        ex.endDate && /^\d{4}-\d{2}-\d{2}$/.test(ex.endDate) && ex.endDate >= startDate
          ? ex.endDate
          : startDate; // missing/invalid window collapses to a single day

      // assigned_date keeps its meaning as the "first scheduled day" for display
      // and back-compat; the recurrence rule + window live alongside it. Status
      // is not reset here — per-day completion lives in exercise_occurrences, so
      // an edit must not wipe historical adherence.
      const upsert = await client.query(
        `INSERT INTO patient_exercises
           (exercise_id, patient_id, sets, reps, rest_seconds, assigned_date, hold_seconds,
            recurrence, interval_days, weekdays, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::smallint[], $11, $12)
         ON CONFLICT (exercise_id, patient_id) DO UPDATE
         SET sets          = EXCLUDED.sets,
             reps          = EXCLUDED.reps,
             rest_seconds  = EXCLUDED.rest_seconds,
             assigned_date = EXCLUDED.assigned_date,
             hold_seconds  = EXCLUDED.hold_seconds,
             recurrence    = EXCLUDED.recurrence,
             interval_days = EXCLUDED.interval_days,
             weekdays      = EXCLUDED.weekdays,
             start_date    = EXCLUDED.start_date,
             end_date      = EXCLUDED.end_date
         RETURNING id`,
        [ex.exerciseId, patientId, ex.sets, ex.reps, restSeconds, startDate, holdSeconds,
         recurrence, intervalDays, weekdays, startDate, endDate]
      );
      const patientExerciseId = upsert.rows[0].id as number;

      // Regenerate the schedule. Drop only future, un-started occurrences so past
      // days and any in-progress/completed day (the adherence record) survive an
      // edit; then materialize the rule's due dates + make-up deadlines (refreshing
      // makeup_until on any day that still exists, e.g. today, in case the cadence changed).
      await client.query(
        `DELETE FROM exercise_occurrences
          WHERE patient_exercise_id = $1
            AND status = 'pending'
            AND due_date > $2::date`,
        [patientExerciseId, todayKeyPH()]
      );
      const schedule = generateSchedule({ recurrence, intervalDays, weekdays, startDate, endDate });
      for (const occ of schedule) {
        await client.query(
          `INSERT INTO exercise_occurrences (patient_exercise_id, due_date, makeup_until)
           VALUES ($1, $2, $3)
           ON CONFLICT (patient_exercise_id, due_date) DO UPDATE
             SET makeup_until = EXCLUDED.makeup_until`,
          [patientExerciseId, occ.dueDate, occ.makeupUntil]
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deletePatientExercises(patientId: string, exerciseIds: string[]) {
  if (exerciseIds.length === 0) return;
  await pool.query(
    `DELETE FROM patient_exercises WHERE patient_id = $1 AND exercise_id = ANY($2::varchar[])`,
    [patientId, exerciseIds]
  );
}

export async function getPatientExercises(patientId: string) {
  const result = await pool.query(
    `SELECT pe.id, pe.exercise_id, pe.patient_id, pe.assigned_date,
            pe.sets, pe.reps, pe.rest_seconds, pe.hold_seconds,
            pe.recurrence, pe.interval_days, pe.weekdays, pe.start_date, pe.end_date,
            e.name, e.description,
            -- At-a-glance status derived from the schedule rather than a sticky
            -- flag: all occurrences done => completed; any activity => in_progress;
            -- otherwise pending. Falls back to pe.status only if (unexpectedly) the
            -- assignment has no occurrences yet.
            (SELECT CASE
               WHEN COUNT(*) = 0 THEN pe.status
               WHEN COUNT(*) FILTER (WHERE eo.status <> 'completed') = 0 THEN 'completed'
               WHEN COUNT(*) FILTER (WHERE eo.status IN ('completed','in_progress')) > 0 THEN 'in_progress'
               ELSE 'pending'
             END
             FROM exercise_occurrences eo WHERE eo.patient_exercise_id = pe.id) AS status
     FROM patient_exercises pe
     JOIN exercises e ON e.id = pe.exercise_id
     WHERE pe.patient_id = $1
     ORDER BY pe.id ASC`,
    [patientId]
  );
  return result.rows;
}

// Dated schedule instances for a patient, newest-relevant first by due_date,
// joined to exercise name + the prescription dose. Powers the patient Session
// schedule tab and the consistency calendar; per-day display state ('missed' vs
// 'upcoming') is derived client-side from status + due_date.
export async function getPatientOccurrences(patientId: string) {
  const result = await pool.query(
    `SELECT eo.id, eo.patient_exercise_id, eo.due_date,
            COALESCE(eo.makeup_until, eo.due_date) AS makeup_until, eo.status,
            pe.exercise_id, pe.sets, pe.reps, pe.rest_seconds, pe.hold_seconds,
            e.name, e.description
     FROM exercise_occurrences eo
     JOIN patient_exercises pe ON pe.id = eo.patient_exercise_id
     JOIN exercises e ON e.id = pe.exercise_id
     WHERE pe.patient_id = $1
     ORDER BY eo.due_date ASC, e.name ASC`,
    [patientId]
  );
  return result.rows;
}

// ── Exercise programs ────────────────────────────────────────────────────────

export async function getPrograms(therapistId: string) {
  const result = await pool.query(
    `SELECT et.id, et.name, et.created_at, et.updated_at,
            COALESCE(
              json_agg(
                json_build_object(
                  'id',          te.id,
                  'exerciseId',  te.exercise_id,
                  'name',        te.name,
                  'description', te.description,
                  'isCustom',    te.is_custom,
                  'sets',        te.sets,
                  'reps',        te.reps,
                  'restSeconds', te.rest_seconds,
                  'holdSeconds', te.hold_seconds
                ) ORDER BY te.id
              ) FILTER (WHERE te.id IS NOT NULL),
              '[]'
            ) AS exercises
     FROM exercise_programs et
     LEFT JOIN program_exercises te ON te.program_id = et.id
     WHERE et.therapist_id = $1
     GROUP BY et.id
     ORDER BY et.created_at DESC`,
    [therapistId]
  );
  return result.rows.map((row) => ({
    id:        row.id,
    name:      row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    exercises: row.exercises as ProgramExerciseRow[],
  }));
}

interface ProgramExerciseRow {
  id: number;
  exerciseId: string | null;
  name: string;
  description: string | null;
  isCustom: boolean;
  sets: number | null;
  reps: number | null;
  restSeconds: number | null;
  holdSeconds: number | null;
}

interface ProgramExerciseInput {
  exerciseId?: string;
  name: string;
  description?: string;
  isCustom: boolean;
  sets?: number;
  reps?: number;
  restSeconds?: number;
  holdSeconds?: number;
}

async function insertProgramExercises(
  client: PoolClient,
  programId: string,
  exercises: ProgramExerciseInput[]
) {
  for (const ex of exercises) {
    const holdSeconds = normalizeHoldSeconds(ex.holdSeconds);
    await client.query(
      `INSERT INTO program_exercises
         (program_id, exercise_id, name, description, is_custom, sets, reps, rest_seconds, hold_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        programId,
        ex.exerciseId ?? null,
        ex.name,
        ex.description ?? null,
        ex.isCustom,
        ex.sets ?? null,
        ex.reps ?? null,
        ex.restSeconds != null && ex.restSeconds >= 0 ? ex.restSeconds : 60,
        holdSeconds,
      ]
    );
  }
}

export async function createProgram(data: {
  therapistId: string;
  name: string;
  exercises: ProgramExerciseInput[];
}) {
  const id = `program_${Date.now()}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO exercise_programs (id, therapist_id, name) VALUES ($1, $2, $3)",
      [id, data.therapistId, data.name]
    );
    await insertProgramExercises(client, id, data.exercises);
    await client.query("COMMIT");
    return id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateProgram(
  id: string,
  therapistId: string,
  data: { name: string; exercises: ProgramExerciseInput[] }
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const check = await client.query(
      "SELECT id FROM exercise_programs WHERE id = $1 AND therapist_id = $2",
      [id, therapistId]
    );
    if (check.rows.length === 0) throw new Error("Not found or forbidden");
    await client.query(
      "UPDATE exercise_programs SET name = $1, updated_at = NOW() WHERE id = $2",
      [data.name, id]
    );
    await client.query("DELETE FROM program_exercises WHERE program_id = $1", [id]);
    await insertProgramExercises(client, id, data.exercises);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteProgram(id: string, therapistId: string) {
  const result = await pool.query(
    "DELETE FROM exercise_programs WHERE id = $1 AND therapist_id = $2",
    [id, therapistId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ── Session persistence (sessions + set_events + rep_events) ───────────────────

/**
 * One counted rep, shaped to match a `rep_events` row. Built client-side from a
 * `RepEvent` plus the side/set context, then sent to the API for batch insert.
 */
export type RepEventRow = {
  repIndex: number;
  setIndex: number;
  side: "left" | "right" | "both" | "bidirectional";
  peakValue: number;
  targetRom: number;
  timeToPeakMs: number;
  holdMs: number;
  descentMs: number;
  totalMs: number;
  classification: "complete" | "partial";
  /** ISO-8601 wall-clock timestamps. */
  startTs: string;
  endTs: string;
};

/**
 * One set-level outcome. Dynamic sessions still keep detailed `rep_events`;
 * this table stores set boundaries and gives isometric holds a durable result.
 */
export type SetEventRow = {
  setIndex: number;
  exerciseKind: "dynamic" | "isometric";
  targetReps: number;
  leftReps: number;
  rightReps: number;
  pairedReps: number;
  targetHoldMs: number;
  pairedHoldMs: number;
  durationMs: number;
  terminatedBy: "min_reached" | "user" | "capture_lost" | "stall";
  asymmetryIndex: number;
  /**
   * Optional set-level hold-quality summary (isometric holds only). Free-form
   * JSON blob — stored as-is in the `hold_quality` JSONB column.
   */
  holdQuality?: unknown;
  /** ISO-8601 wall-clock timestamps. */
  startTs: string;
  endTs: string;
};

/**
 * One raw, unsmoothed metric-only frame. `metrics` and `landmarks` are versioned
 * by `traceKind`; no image or video bytes are accepted or stored.
 */
export type RawFrameRow = {
  frameIndex: number;
  setIndex: number;
  elapsedMs: number;
  capturedAt: string;
  traceKind: string;
  metrics: Record<string, unknown>;
  landmarks: Record<string, unknown>;
};

/**
 * Thrown by createSession when a patient tries to start an exercise that has no
 * actionable occurrence today (nothing due, or only future/missed days). The API
 * layer maps this to a 409 so the camera can surface a clear message.
 */
export class SessionNotScheduledError extends Error {
  constructor(message = "No session is scheduled for this exercise today.") {
    super(message);
    this.name = "SessionNotScheduledError";
  }
}

export async function createSession(data: {
  patientId: string;
  patientExerciseId: number;
  exerciseId: string;
  deviceInfo?: unknown;
}): Promise<{ id: number; startedAt: string }> {
  // Strict schedule lock: a patient may only start an exercise that has an
  // actionable occurrence today — due today, or earlier with its make-up window
  // still open. Future, missed, or unscheduled starts are refused. Occurrence
  // windows are disjoint and contiguous, so at most one can match.
  const today = todayKeyPH();
  const occ = await pool.query(
    `SELECT id FROM exercise_occurrences
      WHERE patient_exercise_id = $1
        AND due_date <= $2::date AND COALESCE(makeup_until, due_date) >= $2::date
        AND status <> 'completed'
      ORDER BY due_date ASC
      LIMIT 1`,
    [data.patientExerciseId, today]
  );
  if (occ.rows.length === 0) {
    throw new SessionNotScheduledError();
  }
  const occurrenceId = occ.rows[0].id as number;

  const result = await pool.query(
    `INSERT INTO sessions (patient_id, patient_exercise_id, exercise_id, device_info, occurrence_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, started_at`,
    [
      data.patientId,
      data.patientExerciseId,
      data.exerciseId,
      data.deviceInfo !== undefined ? JSON.stringify(data.deviceInfo) : null,
      occurrenceId,
    ]
  );
  const row = result.rows[0];
  // Close any orphan open sessions for this assignment — a prior Start that was
  // never ended (e.g. the patient closed the tab / navigated away). Only the
  // just-created session should stay open. Marked 'superseded' so it is never
  // read as an End-button "Ended Early".
  await pool.query(
    `UPDATE sessions
        SET ended_at = NOW(), end_reason = 'superseded'
      WHERE patient_exercise_id = $1 AND ended_at IS NULL AND id <> $2`,
    [data.patientExerciseId, row.id]
  );
  // Mark the fulfilled occurrence in_progress (until endSession completes it).
  await pool.query(
    "UPDATE exercise_occurrences SET status = 'in_progress' WHERE id = $1 AND status = 'pending'",
    [occurrenceId]
  );
  return { id: row.id, startedAt: row.started_at };
}

/** Returns the owning patient_id for a session, or null if it does not exist. */
export async function getSessionOwner(sessionId: number): Promise<string | null> {
  const result = await pool.query(
    "SELECT patient_id FROM sessions WHERE id = $1",
    [sessionId]
  );
  return result.rows.length > 0 ? (result.rows[0].patient_id as string) : null;
}

export async function endSession(
  sessionId: number,
  data: {
    captureQualitySummary?: unknown;
    notes?: string;
    completed?: boolean;
    endReason?: string;
  } = {}
): Promise<void> {
  // 'completed' wins when all sets were finished; otherwise the caller's reason
  // ('user' = End button pressed) or null. COALESCE keeps any reason already
  // recorded (e.g. a 'superseded' row that a later stale PATCH must not blank).
  const endReasonValue = data.completed ? "completed" : data.endReason ?? null;
  await pool.query(
    `UPDATE sessions
        SET ended_at = NOW(),
            capture_quality_summary = COALESCE($2, capture_quality_summary),
            notes = COALESCE($3, notes),
            end_reason = COALESCE($4, end_reason)
      WHERE id = $1`,
    [
      sessionId,
      data.captureQualitySummary !== undefined
        ? JSON.stringify(data.captureQualitySummary)
        : null,
      data.notes ?? null,
      endReasonValue,
    ]
  );
  // When the patient finished all prescribed sets, mark the scheduled occurrence
  // this session fulfilled as completed. Keyed on the session's occurrence_id, so
  // an extra/unscheduled session (no occurrence) completes nothing on the
  // schedule. The assignment-level status is derived from occurrences at read
  // time and is intentionally not written here.
  if (data.completed) {
    await pool.query(
      `UPDATE exercise_occurrences SET status = 'completed'
        WHERE id = (SELECT occurrence_id FROM sessions WHERE id = $1)`,
      [sessionId]
    );
  }
}

export async function insertRepEvents(
  sessionId: number,
  rows: RepEventRow[]
): Promise<void> {
  if (rows.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of rows) {
      await client.query(
        `INSERT INTO rep_events
           (session_id, rep_index, set_index, side, peak_value, target_rom,
            time_to_peak_ms, hold_ms, descent_ms, total_ms, classification,
            start_ts, end_ts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          sessionId,
          r.repIndex,
          r.setIndex,
          r.side,
          r.peakValue,
          r.targetRom,
          Math.round(r.timeToPeakMs),
          Math.round(r.holdMs),
          Math.round(r.descentMs),
          Math.round(r.totalMs),
          r.classification,
          r.startTs,
          r.endTs,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function insertSetEvents(
  sessionId: number,
  rows: SetEventRow[]
): Promise<void> {
  if (rows.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of rows) {
      await client.query(
        `INSERT INTO set_events
           (session_id, set_index, exercise_kind, target_reps, left_reps,
            right_reps, paired_reps, target_hold_ms, paired_hold_ms,
            duration_ms, terminated_by, asymmetry_index, start_ts, end_ts,
            hold_quality)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          sessionId,
          r.setIndex,
          r.exerciseKind,
          r.targetReps,
          r.leftReps,
          r.rightReps,
          r.pairedReps,
          Math.round(r.targetHoldMs),
          Math.round(r.pairedHoldMs),
          Math.round(r.durationMs),
          r.terminatedBy,
          r.asymmetryIndex,
          r.startTs,
          r.endTs,
          r.holdQuality !== undefined ? JSON.stringify(r.holdQuality) : null,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function insertRawFrames(
  sessionId: number,
  rows: RawFrameRow[]
): Promise<void> {
  if (rows.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of rows) {
      await client.query(
        `INSERT INTO raw_frames
           (session_id, frame_index, set_index, elapsed_ms, captured_at,
            trace_kind, metrics, landmarks)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (session_id, frame_index) DO NOTHING`,
        [
          sessionId,
          r.frameIndex,
          r.setIndex,
          Math.round(r.elapsedMs),
          r.capturedAt,
          r.traceKind,
          JSON.stringify(r.metrics),
          JSON.stringify(r.landmarks),
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getRawFramesForSession(sessionId: number) {
  const result = await pool.query(
    `SELECT frame_index, set_index, elapsed_ms, captured_at, trace_kind,
            metrics, landmarks
       FROM raw_frames
      WHERE session_id = $1
      ORDER BY frame_index ASC`,
    [sessionId]
  );
  return result.rows.map((r) => ({
    frameIndex:  r.frame_index,
    setIndex:    r.set_index,
    elapsedMs:   r.elapsed_ms,
    capturedAt:  r.captured_at,
    traceKind:   r.trace_kind,
    metrics:     r.metrics,
    landmarks:   r.landmarks,
  }));
}

// ── Session read side (clinician dashboard) ────────────────────────────────────

/**
 * Per-session summary rows for a patient, newest first. Aggregates are computed
 * on demand (no materialized view — POC volume is small). One row per session,
 * with rep + set rollups joined in.
 */
export async function getSessionsForPatient(patientId: string) {
  const result = await pool.query(
    `SELECT
        s.id,
        s.exercise_id,
        e.name AS exercise_name,
        s.started_at,
        s.ended_at,
        s.end_reason,
        r.total_reps,
        r.complete_reps,
        r.left_reps,
        r.right_reps,
        r.complete_left_reps,
        r.complete_right_reps,
        r.avg_peak_value,
        st.set_count,
        st.exercise_kind,
        st.total_paired_hold_ms,
        st.total_target_hold_ms,
        st.total_duration_ms,
        st.avg_asymmetry_index
     FROM sessions s
     JOIN exercises e ON e.id = s.exercise_id
     LEFT JOIN (
        SELECT session_id,
               COUNT(*)                                            AS total_reps,
               COUNT(*) FILTER (WHERE classification = 'complete') AS complete_reps,
               COUNT(*) FILTER (WHERE side = 'left')               AS left_reps,
               COUNT(*) FILTER (WHERE side = 'right')              AS right_reps,
               COUNT(*) FILTER (WHERE side = 'left'  AND classification = 'complete') AS complete_left_reps,
               COUNT(*) FILTER (WHERE side = 'right' AND classification = 'complete') AS complete_right_reps,
               AVG(peak_value)                                     AS avg_peak_value
        FROM rep_events GROUP BY session_id
     ) r ON r.session_id = s.id
     LEFT JOIN (
        SELECT session_id,
               COUNT(*)             AS set_count,
               MAX(exercise_kind)   AS exercise_kind,
               SUM(paired_hold_ms)  AS total_paired_hold_ms,
               SUM(target_hold_ms)  AS total_target_hold_ms,
               SUM(duration_ms)     AS total_duration_ms,
               AVG(asymmetry_index) AS avg_asymmetry_index,
               -- Rule-based compensation score (0-100), persisted only for
               -- isometric holds inside the hold_quality JSONB. Guard the cast
               -- because legacy/hand-inserted JSON can contain nonnumeric
               -- values; AVG skips NULLs.
               AVG(
                 CASE
                   WHEN jsonb_typeof(hold_quality->'meanCompensationScore') = 'number'
                     THEN (hold_quality->>'meanCompensationScore')::numeric
                   ELSE NULL
                 END
               ) AS avg_compensation_score
        FROM set_events GROUP BY session_id
     ) st ON st.session_id = s.id
     WHERE s.patient_id = $1
     ORDER BY s.started_at DESC`,
    [patientId]
  );

  return result.rows.map((row) => {
    const durationMs =
      row.total_duration_ms != null
        ? Number(row.total_duration_ms)
        : row.ended_at && row.started_at
          ? new Date(row.ended_at).getTime() - new Date(row.started_at).getTime()
          : null;
    return {
      id:                row.id,
      exerciseId:        row.exercise_id,
      exerciseName:      row.exercise_name,
      exerciseKind:      row.exercise_kind ?? null,   // 'dynamic' | 'isometric' | null
      startedAt:         row.started_at,
      endedAt:           row.ended_at ?? null,
      endReason:         row.end_reason ?? null,
      durationMs,
      setCount:          row.set_count != null ? Number(row.set_count) : 0,
      totalReps:         row.total_reps != null ? Number(row.total_reps) : 0,
      completeReps:      row.complete_reps != null ? Number(row.complete_reps) : 0,
      leftReps:          row.left_reps != null ? Number(row.left_reps) : 0,
      rightReps:         row.right_reps != null ? Number(row.right_reps) : 0,
      completeLeftReps:  row.complete_left_reps != null ? Number(row.complete_left_reps) : 0,
      completeRightReps: row.complete_right_reps != null ? Number(row.complete_right_reps) : 0,
      avgPeakValue:      row.avg_peak_value != null ? Number(row.avg_peak_value) : null,
      totalPairedHoldMs: row.total_paired_hold_ms != null ? Number(row.total_paired_hold_ms) : null,
      totalTargetHoldMs: row.total_target_hold_ms != null ? Number(row.total_target_hold_ms) : null,
      avgAsymmetryIndex: row.avg_asymmetry_index != null ? Number(row.avg_asymmetry_index) : null,
      avgCompensationScore: row.avg_compensation_score != null ? Number(row.avg_compensation_score) : null,
    };
  });
}

/**
 * Therapist home rollup: one row per assigned patient with session activity and
 * exercise progress, computed on demand (POC volume is small). "Sessions" counts
 * only outcome-bearing rows (≥1 set or rep) so abandoned Start-presses don't
 * inflate activity — consistent with the patient consistency calendar.
 */
export async function getTherapistRoster(therapistId: string) {
  const result = await pool.query(
    `SELECT
        u.id,
        u.name,
        COALESCE(sess.total_sessions, 0)     AS total_sessions,
        COALESCE(sess.sessions_this_week, 0) AS sessions_this_week,
        sess.last_session_at,
        COALESCE(ex.assigned_count, 0)       AS assigned_count,
        COALESCE(ex.due_count, 0)            AS due_count,
        COALESCE(ex.completed_count, 0)      AS completed_count,
        COALESCE(ex.missed_count, 0)         AS missed_count
     FROM users u
     LEFT JOIN (
        SELECT s.patient_id,
               COUNT(*)                                                         AS total_sessions,
               COUNT(*) FILTER (WHERE s.started_at >= NOW() - INTERVAL '7 days') AS sessions_this_week,
               MAX(s.started_at)                                                 AS last_session_at
        FROM sessions s
        WHERE EXISTS (SELECT 1 FROM set_events se WHERE se.session_id = s.id)
           OR EXISTS (SELECT 1 FROM rep_events re WHERE re.session_id = s.id)
        GROUP BY s.patient_id
     ) sess ON sess.patient_id = u.id
     LEFT JOIN (
        -- Adherence over scheduled occurrences. assigned_count is the number of
        -- distinct prescriptions (drives "No exercises"); due/completed/missed are
        -- over occurrences up to today, so progress reads as work-done / work-due.
        SELECT pe.patient_id,
               COUNT(DISTINCT pe.id)                                              AS assigned_count,
               COUNT(eo.id) FILTER (WHERE eo.due_date <= $2::date)                AS due_count,
               COUNT(eo.id) FILTER (WHERE eo.status = 'completed')                AS completed_count,
               COUNT(eo.id) FILTER (WHERE COALESCE(eo.makeup_until, eo.due_date) < $2::date
                                      AND eo.status <> 'completed')               AS missed_count
        FROM patient_exercises pe
        LEFT JOIN exercise_occurrences eo ON eo.patient_exercise_id = pe.id
        GROUP BY pe.patient_id
     ) ex ON ex.patient_id = u.id
     WHERE u.role = 'patient' AND u.therapist_id = $1
     ORDER BY u.name`,
    [therapistId, todayKeyPH()],
  );
  return result.rows.map((row) => ({
    id:               row.id as string,
    name:             row.name as string,
    totalSessions:    Number(row.total_sessions),
    sessionsThisWeek: Number(row.sessions_this_week),
    lastSessionAt:    (row.last_session_at as string | null) ?? null,
    assignedCount:    Number(row.assigned_count),
    dueCount:         Number(row.due_count),
    completedCount:   Number(row.completed_count),
    missedCount:      Number(row.missed_count),
  }));
}

/**
 * Full drill-down for one session: the session row plus its set_events (with
 * hold_quality) and rep_events, ordered. Returns null if the session is absent.
 */
export async function getSessionDetail(sessionId: number) {
  const sessionRes = await pool.query(
    `SELECT s.id, s.patient_id, s.patient_exercise_id, s.exercise_id,
            e.name AS exercise_name, s.started_at, s.ended_at,
            s.device_info, s.capture_quality_summary, s.notes
     FROM sessions s
     JOIN exercises e ON e.id = s.exercise_id
     WHERE s.id = $1`,
    [sessionId]
  );
  if (sessionRes.rows.length === 0) return null;
  const s = sessionRes.rows[0];

  const setsRes = await pool.query(
    `SELECT set_index, exercise_kind, target_reps, left_reps, right_reps,
            paired_reps, target_hold_ms, paired_hold_ms, duration_ms,
            terminated_by, asymmetry_index, hold_quality, start_ts, end_ts
     FROM set_events WHERE session_id = $1 ORDER BY set_index ASC`,
    [sessionId]
  );
  const repsRes = await pool.query(
    `SELECT rep_index, set_index, side, peak_value, target_rom, time_to_peak_ms,
            hold_ms, descent_ms, total_ms, classification, start_ts, end_ts
     FROM rep_events WHERE session_id = $1 ORDER BY rep_index ASC`,
    [sessionId]
  );

  return {
    id:               s.id,
    patientId:        s.patient_id,
    exerciseId:       s.exercise_id,
    exerciseName:     s.exercise_name,
    startedAt:        s.started_at,
    endedAt:          s.ended_at ?? null,
    notes:            s.notes ?? null,
    sets: setsRes.rows.map((r) => ({
      setIndex:       r.set_index,
      exerciseKind:   r.exercise_kind,
      targetReps:     r.target_reps,
      leftReps:       r.left_reps,
      rightReps:      r.right_reps,
      pairedReps:     r.paired_reps,
      targetHoldMs:   r.target_hold_ms,
      pairedHoldMs:   r.paired_hold_ms,
      durationMs:     r.duration_ms,
      terminatedBy:   r.terminated_by,
      asymmetryIndex: r.asymmetry_index != null ? Number(r.asymmetry_index) : null,
      holdQuality:    r.hold_quality ?? null,
    })),
    reps: repsRes.rows.map((r) => ({
      repIndex:       r.rep_index,
      setIndex:       r.set_index,
      side:           r.side,
      peakValue:      r.peak_value != null ? Number(r.peak_value) : null,
      targetRom:      r.target_rom != null ? Number(r.target_rom) : null,
      timeToPeakMs:   r.time_to_peak_ms,
      holdMs:         r.hold_ms,
      descentMs:      r.descent_ms,
      totalMs:        r.total_ms,
      classification: r.classification,
    })),
  };
}

export default pool;
