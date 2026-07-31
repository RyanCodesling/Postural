import { Pool, PoolClient, types } from "pg";
import { hashPassword } from "./crypto";
import {
  deriveAssignmentStatus,
  generateSchedule,
  MAX_INTERVAL_DAYS,
  type OccurrenceLite,
  type Recurrence,
} from "@/lib/exercises/occurrences";
import {
  summarizePrescription,
  type PrescriptionOccurrenceLite,
} from "@/lib/exercises/prescriptionStatus";
import type { DynamicRepQuality } from "@/lib/pose/repQuality";
import { POSE_METRIC_ALGORITHM_VERSION } from "@/lib/pose/metricVersion";
import {
  parseCaptureQualitySummary,
  summarizeDeviceInfo,
} from "@/lib/sessionReadModels";
import {
  PRESCRIPTION_SNAPSHOT_VERSION,
  REP_QUALITY_VERSION,
  SESSION_CONTEXT_VERSION,
  comparableContextKey,
  resistanceContextFromRow,
  type PainReportStatus,
  type PainTiming,
  type PrescribedSide,
  type PrescriptionSnapshot,
  type PrescriptionSnapshotV2,
  type ResistanceContext,
  type RuntimePrescription,
  type SessionContextSnapshot,
  type SessionContextSnapshotV2,
  type SessionEndReason,
  type TherapistReviewLabel,
} from "@/lib/prescriptionContext";
import { getExerciseDefinition } from "@/lib/exercises/registry";
import {
  EXERCISE_CONFIG_VERSIONS,
  REGISTRY_VERSION,
  effectiveCompensationBands,
  getAppRevision,
} from "@/lib/exercises/versioning";

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
    therapistIDNum: row.therapist_id_num  ?? null,
    specialty:      row.specialty         ?? null,
    createdAt:      row.created_at        ?? null,
    mustChangePassword: row.must_change_password ?? false,
    isArchived:     row.is_archived       ?? false,
    archivedAt:     row.archived_at       ?? null,
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
    "SELECT * FROM users WHERE email = $1 AND role = $2 AND (is_archived IS NULL OR is_archived = FALSE)",
    [email, role]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function getUserByEmail(email: string) {
  const result = await pool.query(
    "SELECT * FROM users WHERE email = $1 AND (is_archived IS NULL OR is_archived = FALSE)",
    [email]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function getUserByEmailWithArchived(email: string) {
  const result = await pool.query(
    "SELECT * FROM users WHERE email = $1",
    [email]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function isEmailTaken(email: string, excludeId?: string): Promise<boolean> {
  const result = excludeId
    ? await pool.query("SELECT id FROM users WHERE email = $1 AND id != $2 LIMIT 1", [email, excludeId])
    : await pool.query("SELECT id FROM users WHERE email = $1 LIMIT 1", [email]);
  return result.rows.length > 0;
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
  therapistIDNum?: string;
  specialty?: string;
}) {
  const hashedPassword = hashPassword(data.password);
  const result = await pool.query(
    `INSERT INTO users
       (id, email, password, name, first_name, middle_name, last_name,
        role, date_of_birth, age, gender,
        therapist_id_num, specialty)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      data.id,
      data.email ?? null,
      hashedPassword,
      data.name,
      data.firstName ?? null,
      data.middleName ?? null,
      data.lastName ?? null,
      data.role,
      data.dateOfBirth ?? null,
      data.age ?? null,
      data.gender ?? null,
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

export type PermanentUserDeletionBlocker =
  | "patient_prescriptions"
  | "patient_sessions"
  | "assigned_patients"
  | "owned_programs"
  | "owned_exercises"
  | "therapist_reviews";

export type PermanentUserDeletionErrorCode =
  | "not_found"
  | "self_delete"
  | "not_archived"
  | "durable_history";

export class PermanentUserDeletionError extends Error {
  constructor(
    public readonly code: PermanentUserDeletionErrorCode,
    message: string,
    public readonly blockers: PermanentUserDeletionBlocker[] = [],
  ) {
    super(message);
    this.name = "PermanentUserDeletionError";
  }
}

/**
 * Permanently remove only an already-archived, history-free account.
 *
 * The target row is locked until the relationship checks and DELETE complete.
 * Durable clinical/assignment relationships are protected both here (for a
 * useful conflict response) and by ON DELETE RESTRICT constraints (for race
 * safety). Ephemeral notifications/tokens may still use ON DELETE CASCADE.
 */
export async function deleteUser(id: string, actorId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const target = await client.query(
      `SELECT *
         FROM users
        WHERE id = $1
        FOR UPDATE`,
      [id],
    );
    if (target.rows.length === 0) {
      throw new PermanentUserDeletionError(
        "not_found",
        "User not found.",
      );
    }
    if (id === actorId) {
      throw new PermanentUserDeletionError(
        "self_delete",
        "You cannot permanently delete your own account.",
      );
    }
    if (target.rows[0].is_archived !== true) {
      throw new PermanentUserDeletionError(
        "not_archived",
        "Archive this account before requesting permanent deletion.",
      );
    }

    const relationships = await client.query(
      `SELECT
         EXISTS (SELECT 1 FROM patient_exercises WHERE patient_id = $1) AS patient_prescriptions,
         EXISTS (SELECT 1 FROM sessions WHERE patient_id = $1) AS patient_sessions,
         EXISTS (SELECT 1 FROM users WHERE therapist_id = $1) AS assigned_patients,
         EXISTS (SELECT 1 FROM exercise_programs WHERE therapist_id = $1) AS owned_programs,
         EXISTS (SELECT 1 FROM exercises WHERE owner_therapist_id = $1) AS owned_exercises,
         EXISTS (SELECT 1 FROM session_reviews WHERE therapist_id = $1) AS therapist_reviews`,
      [id],
    );
    const relationshipRow = relationships.rows[0] as Record<string, boolean>;
    const blockerNames: PermanentUserDeletionBlocker[] = [
      "patient_prescriptions",
      "patient_sessions",
      "assigned_patients",
      "owned_programs",
      "owned_exercises",
      "therapist_reviews",
    ];
    const blockers = blockerNames.filter((name) => relationshipRow[name] === true);
    if (blockers.length > 0) {
      throw new PermanentUserDeletionError(
        "durable_history",
        "This account has durable clinical or assignment history and cannot be permanently deleted. Keep it archived.",
        blockers,
      );
    }

    await client.query("DELETE FROM users WHERE id = $1", [id]);
    await client.query("COMMIT");
    return mapUser(target.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23503"
    ) {
      throw new PermanentUserDeletionError(
        "durable_history",
        "This account is still referenced by protected records and cannot be permanently deleted. Keep it archived.",
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function archiveUser(id: string) {
  await pool.query(
    "UPDATE users SET is_archived = TRUE, archived_at = NOW() WHERE id = $1",
    [id]
  );
}

export async function restoreUser(id: string) {
  await pool.query(
    "UPDATE users SET is_archived = FALSE, archived_at = NULL WHERE id = $1",
    [id]
  );
}

export async function updateUserPassword(userId: string, newPassword: string) {
  const hashedPassword = hashPassword(newPassword);
  await pool.query(
    "UPDATE users SET password = $1, must_change_password = FALSE WHERE id = $2",
    [hashedPassword, userId]
  );
}

export async function setMustChangePassword(userId: string, value: boolean) {
  await pool.query(
    "UPDATE users SET must_change_password = $1 WHERE id = $2",
    [value, userId]
  );
}

/** Returns the raw DB row for a user (including password). Used for password verification. */
export async function getUserRawById(id: string) {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function createOTP(
  userId: string,
  email: string,
  otp: string,
  expiresAt: Date
) {
  await pool.query(
    `INSERT INTO password_reset_otps (user_id, email, otp, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, email, otp, expiresAt]
  );
}

export async function verifyOTP(email: string, otp: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT id FROM password_reset_otps
     WHERE email = $1 AND otp = $2 AND used = FALSE AND expires_at > NOW()
     LIMIT 1`,
    [email, otp]
  );
  if (result.rows.length === 0) return null;

  const { randomBytes } = await import("crypto");
  const resetToken = randomBytes(32).toString("hex");
  const resetTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  await pool.query(
    `UPDATE password_reset_otps
     SET used = TRUE, reset_token = $1, reset_token_expires_at = $2
     WHERE id = $3`,
    [resetToken, resetTokenExpiresAt, result.rows[0].id]
  );
  return resetToken;
}

export async function validateAndConsumeResetToken(email: string, token: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT id FROM password_reset_otps
     WHERE email = $1 AND reset_token = $2 AND reset_token_expires_at > NOW()
     LIMIT 1`,
    [email, token]
  );
  if (result.rows.length === 0) return false;
  await pool.query(
    "UPDATE password_reset_otps SET reset_token = NULL WHERE id = $1",
    [result.rows[0].id]
  );
  return true;
}

export async function invalidateOTPs(email: string) {
  await pool.query(
    "UPDATE password_reset_otps SET used = TRUE WHERE email = $1 AND used = FALSE",
    [email]
  );
}

// ── Exercises ─────────────────────────────────────────────────────────────────

export async function getExercises(options: {
  includeArchived?: boolean;
  therapistId?: string;
} = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (!options.includeArchived) conditions.push("archived_at IS NULL");
  if (options.therapistId) {
    params.push(options.therapistId);
    conditions.push(`(is_custom = FALSE OR owner_therapist_id = $${params.length})`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM exercises ${where} ORDER BY id`, params);
  return result.rows;
}

export async function getExerciseById(id: string, includeArchived = false) {
  const result = await pool.query(
    `SELECT * FROM exercises
      WHERE id = $1 ${includeArchived ? "" : "AND archived_at IS NULL"}
      LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
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
  ownerTherapistId?: string | null;
  monitoringMode?: "camera" | "manual";
}) {
  const result = await pool.query(
    `INSERT INTO exercises
       (id, name, description, is_custom, owner_therapist_id, monitoring_mode)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      data.id,
      data.name,
      data.description,
      data.isCustom ?? false,
      data.ownerTherapistId ?? null,
      data.monitoringMode ?? (data.isCustom ? "manual" : "camera"),
    ],
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
    `UPDATE exercises SET ${fields.join(", ")}
      WHERE id = $${params.length} AND archived_at IS NULL
      RETURNING *`,
    params
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function archiveExercise(id: string, archivedBy: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exercise = await client.query(
      `UPDATE exercises
          SET archived_at = NOW(), archived_by = $2
        WHERE id = $1 AND archived_at IS NULL
        RETURNING id`,
      [id, archivedBy],
    );
    if (exercise.rows.length === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    const assignments = await client.query(
      `UPDATE patient_exercises
          SET archived_at = NOW(), archived_by = $2
        WHERE exercise_id = $1 AND archived_at IS NULL
        RETURNING id`,
      [id, archivedBy],
    );
    const assignmentIds = assignments.rows.map((row) => Number(row.id));
    if (assignmentIds.length > 0) {
      await client.query(
        `UPDATE exercise_occurrences
            SET cancelled_at = NOW(), cancelled_by = $2
          WHERE patient_exercise_id = ANY($1::int[])
            AND status = 'pending'
            AND cancelled_at IS NULL
            AND COALESCE(makeup_until, due_date) >= $3::date`,
        [assignmentIds, archivedBy, todayKeyPH()],
      );
    }

    // Program entries keep their copied name/description as history, but an
    // archived catalog row is no longer assignable through the program.
    await client.query(
      "UPDATE program_exercises SET exercise_id = NULL WHERE exercise_id = $1",
      [id],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ── Patient exercises ─────────────────────────────────────────────────────────

export const DEFAULT_REST_SECONDS = 60;
export const DEFAULT_HOLD_SECONDS = 30;

export type PatientExerciseAssignment = {
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
  sequenceIndex: number;
  prescribedSide: PrescribedSide;
  resistance: ResistanceContext;
};

export class ExerciseAssignmentNotAllowedError extends Error {
  constructor(message = "One or more exercises are unavailable for assignment.") {
    super(message);
    this.name = "ExerciseAssignmentNotAllowedError";
  }
}

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
  exercises: PatientExerciseAssignment[],
  therapistId: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const requestedExerciseIds = Array.from(new Set(exercises.map((exercise) => exercise.exerciseId)));
    const allowedExercises = await client.query(
      `SELECT id
         FROM exercises
        WHERE id = ANY($1::varchar[])
          AND archived_at IS NULL
          AND (is_custom = FALSE OR owner_therapist_id = $2)`,
      [requestedExerciseIds, therapistId],
    );
    if (allowedExercises.rows.length !== requestedExerciseIds.length) {
      throw new ExerciseAssignmentNotAllowedError();
    }

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
      const capturedAt = new Date().toISOString();

      // assigned_date keeps its meaning as the "first scheduled day" for display
      // and back-compat; the recurrence rule + window live alongside it. Status
      // is not reset here — per-day completion lives in exercise_occurrences, so
      // an edit must not wipe historical adherence.
      const upsert = await client.query(
        `INSERT INTO patient_exercises
           (exercise_id, patient_id, sets, reps, rest_seconds, assigned_date, hold_seconds,
            recurrence, interval_days, weekdays, start_date, end_date,
            sequence_index, prescribed_side, resistance_type, resistance_value, resistance_unit, resistance_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::smallint[], $11, $12,
                 $13, $14, $15, $16, $17, $18)
         ON CONFLICT (exercise_id, patient_id) WHERE archived_at IS NULL DO UPDATE
         SET sets          = EXCLUDED.sets,
             reps          = EXCLUDED.reps,
             rest_seconds  = EXCLUDED.rest_seconds,
             assigned_date = EXCLUDED.assigned_date,
             hold_seconds  = EXCLUDED.hold_seconds,
             recurrence    = EXCLUDED.recurrence,
             interval_days = EXCLUDED.interval_days,
             weekdays      = EXCLUDED.weekdays,
             start_date    = EXCLUDED.start_date,
             end_date      = EXCLUDED.end_date,
             sequence_index = EXCLUDED.sequence_index,
             prescribed_side = EXCLUDED.prescribed_side,
             resistance_type = EXCLUDED.resistance_type,
             resistance_value = EXCLUDED.resistance_value,
             resistance_unit = EXCLUDED.resistance_unit,
             resistance_label = EXCLUDED.resistance_label
         RETURNING id`,
        [ex.exerciseId, patientId, ex.sets, ex.reps, restSeconds, startDate, holdSeconds,
         recurrence, intervalDays, weekdays, startDate, endDate,
         ex.sequenceIndex, ex.prescribedSide, ex.resistance.type, ex.resistance.value,
         ex.resistance.unit, ex.resistance.label]
      );
      const patientExerciseId = upsert.rows[0].id as number;

      // Regenerate the schedule without deleting occurrence history. Future
      // pending rows are cancelled first; dates still present in the new rule are
      // reactivated by the upsert below.
      await client.query(
        `UPDATE exercise_occurrences
            SET cancelled_at = NOW(), cancelled_by = $3
          WHERE patient_exercise_id = $1
            AND status = 'pending'
            AND due_date > $2::date
            AND cancelled_at IS NULL`,
        [patientExerciseId, todayKeyPH(), therapistId]
      );
      const schedule = generateSchedule({ recurrence, intervalDays, weekdays, startDate, endDate });
      for (const occ of schedule) {
        const snapshot: PrescriptionSnapshotV2 = {
          version: PRESCRIPTION_SNAPSHOT_VERSION,
          capturedAt,
          patientExerciseId,
          exerciseId: ex.exerciseId,
          sets: ex.sets,
          reps: ex.reps,
          restSeconds,
          holdSeconds,
          sequenceIndex: ex.sequenceIndex,
          prescribedSide: ex.prescribedSide,
          resistance: ex.resistance,
          schedule: {
            dueDate: occ.dueDate,
            makeupUntil: occ.makeupUntil,
          },
        };
        await client.query(
          `INSERT INTO exercise_occurrences
             (patient_exercise_id, due_date, makeup_until, prescription_snapshot,
              prescription_snapshot_version, prescription_captured_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (patient_exercise_id, due_date) DO UPDATE
             SET makeup_until = EXCLUDED.makeup_until,
                 prescription_snapshot = EXCLUDED.prescription_snapshot,
                 prescription_snapshot_version = EXCLUDED.prescription_snapshot_version,
                 prescription_captured_at = EXCLUDED.prescription_captured_at,
                 cancelled_at = NULL,
                 cancelled_by = NULL
           -- Only an unstarted scheduled occurrence may adopt an edited
           -- prescription. Once a session starts (in_progress) or reaches a
           -- terminal outcome, its scheduled context is historical evidence.
           WHERE exercise_occurrences.status = 'pending'`,
          [
            patientExerciseId,
            occ.dueDate,
            occ.makeupUntil,
            JSON.stringify(snapshot),
            PRESCRIPTION_SNAPSHOT_VERSION,
            capturedAt,
          ]
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

export async function archivePatientExercises(
  patientId: string,
  exerciseIds: string[],
  archivedBy: string,
) {
  if (exerciseIds.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const archived = await client.query(
      `UPDATE patient_exercises
          SET archived_at = NOW(), archived_by = $3
        WHERE patient_id = $1
          AND exercise_id = ANY($2::varchar[])
          AND archived_at IS NULL
        RETURNING id`,
      [patientId, exerciseIds, archivedBy],
    );
    const assignmentIds = archived.rows.map((row) => Number(row.id));
    if (assignmentIds.length > 0) {
      await client.query(
        `UPDATE exercise_occurrences
            SET cancelled_at = NOW(), cancelled_by = $2
          WHERE patient_exercise_id = ANY($1::int[])
            AND status = 'pending'
            AND cancelled_at IS NULL
            AND COALESCE(makeup_until, due_date) >= $3::date`,
        [assignmentIds, archivedBy, todayKeyPH()],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getPatientExercises(
  patientId: string,
  options: { includeArchived?: boolean } = {},
) {
  const activeOnly = options.includeArchived
    ? ""
    : "AND pe.archived_at IS NULL AND e.archived_at IS NULL";
  const [exerciseResult, occurrenceResult] = await Promise.all([
    pool.query(
      `SELECT pe.id, pe.exercise_id, pe.patient_id, pe.assigned_date,
              pe.sets, pe.reps, pe.rest_seconds, pe.hold_seconds,
              pe.prescribed_side, pe.resistance_type, pe.resistance_value,
              pe.resistance_unit, pe.resistance_label,
              pe.recurrence, pe.interval_days, pe.weekdays, pe.start_date, pe.end_date,
              pe.sequence_index,
              pe.status AS stored_status, pe.archived_at,
              e.name, e.description, e.monitoring_mode
       FROM patient_exercises pe
       JOIN exercises e ON e.id = pe.exercise_id
       WHERE pe.patient_id = $1 ${activeOnly}
       ORDER BY pe.sequence_index ASC, e.name ASC, e.id ASC, pe.id ASC`,
      [patientId]
    ),
    pool.query(
      `SELECT eo.patient_exercise_id,
              eo.due_date AS "dueDate",
              COALESCE(eo.makeup_until, eo.due_date) AS "makeupUntil",
              eo.status,
              eo.cancelled_at AS "cancelledAt"
       FROM exercise_occurrences eo
       JOIN patient_exercises pe ON pe.id = eo.patient_exercise_id
       JOIN exercises e ON e.id = pe.exercise_id
       WHERE pe.patient_id = $1 ${activeOnly}
       ORDER BY eo.due_date ASC`,
      [patientId]
    ),
  ]);

  const occurrencesByAssignment = new Map<number, PrescriptionOccurrenceLite[]>();
  for (const row of occurrenceResult.rows) {
    const patientExerciseId = Number(row.patient_exercise_id);
    const occurrences = occurrencesByAssignment.get(patientExerciseId) ?? [];
    occurrences.push({
      dueDate: row.dueDate as string,
      makeupUntil: row.makeupUntil as string,
      status: row.status as OccurrenceLite["status"],
      cancelledAt: (row.cancelledAt as string | null) ?? null,
    });
    occurrencesByAssignment.set(patientExerciseId, occurrences);
  }

  const today = todayKeyPH();
  return exerciseResult.rows.map((row) => {
    const { stored_status: storedStatus, ...exercise } = row;
    const occurrences = occurrencesByAssignment.get(Number(row.id)) ?? [];
    const activeOccurrences = occurrences.filter((occ) => !occ.cancelledAt);
    const status = deriveAssignmentStatus(
      activeOccurrences,
      today,
      storedStatus as OccurrenceLite["status"]
    );
    const summary = summarizePrescription({
      occurrences,
      todayKey: today,
      startDate: (row.start_date as string | null) ?? (row.assigned_date as string),
      endDate: (row.end_date as string | null) ?? (row.assigned_date as string),
      archivedAt: (row.archived_at as string | null) ?? null,
    });
    return {
      ...exercise,
      status,
      prescription_state: summary.prescriptionState,
      adherence_state: summary.adherenceState,
      occurrence_summary: {
        scheduled: summary.scheduledCount,
        completed: summary.completedCount,
        missed: summary.missedCount,
        inProgress: summary.inProgressCount,
        remaining: summary.remainingCount,
        cancelled: summary.cancelledCount,
        painStopped: summary.painStoppedCount,
      },
    };
  });
}

// Dated schedule instances for a patient, newest-relevant first by due_date,
// joined to exercise name + the prescription dose. Powers the patient Session
// schedule tab and the consistency calendar; per-day display state ('missed' vs
// 'upcoming') is derived client-side from status + due_date.
export async function getPatientOccurrences(patientId: string) {
  const result = await pool.query(
    `SELECT eo.id, eo.patient_exercise_id, eo.due_date,
            COALESCE(eo.makeup_until, eo.due_date) AS makeup_until, eo.status,
            eo.pain_stopped_at, eo.prescription_snapshot,
            pe.exercise_id,
            COALESCE((eo.prescription_snapshot ->> 'sets')::int, pe.sets) AS sets,
            COALESCE((eo.prescription_snapshot ->> 'reps')::int, pe.reps) AS reps,
            COALESCE((eo.prescription_snapshot ->> 'restSeconds')::int, pe.rest_seconds) AS rest_seconds,
            COALESCE((eo.prescription_snapshot ->> 'holdSeconds')::int, pe.hold_seconds) AS hold_seconds,
            COALESCE((eo.prescription_snapshot ->> 'sequenceIndex')::int, pe.sequence_index) AS sequence_index,
            COALESCE(eo.prescription_snapshot ->> 'prescribedSide', pe.prescribed_side) AS prescribed_side,
            COALESCE(eo.prescription_snapshot -> 'resistance', jsonb_build_object(
              'type', pe.resistance_type,
              'value', pe.resistance_value,
              'unit', pe.resistance_unit,
              'label', pe.resistance_label
            )) AS resistance,
            e.name, e.description, e.monitoring_mode
     FROM exercise_occurrences eo
     JOIN patient_exercises pe ON pe.id = eo.patient_exercise_id
     JOIN exercises e ON e.id = pe.exercise_id
     WHERE pe.patient_id = $1
       AND pe.archived_at IS NULL
       AND e.archived_at IS NULL
       AND eo.cancelled_at IS NULL
     ORDER BY eo.due_date ASC,
       COALESCE((eo.prescription_snapshot ->> 'sequenceIndex')::int, pe.sequence_index) ASC,
       e.name ASC,
       e.id ASC,
       eo.id ASC`,
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
                  'holdSeconds', te.hold_seconds,
                  'sequenceIndex', te.sequence_index,
                  'prescribedSide', te.prescribed_side,
                  'resistanceType', te.resistance_type,
                  'resistanceValue', te.resistance_value,
                  'resistanceUnit', te.resistance_unit,
                  'resistanceLabel', te.resistance_label
                ) ORDER BY te.sequence_index, te.id
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
  sequenceIndex: number;
  prescribedSide: PrescribedSide;
  resistanceType: ResistanceContext["type"];
  resistanceValue: number | null;
  resistanceUnit: ResistanceContext["unit"];
  resistanceLabel: string | null;
}

export interface ProgramExerciseInput {
  exerciseId?: string;
  name: string;
  description?: string;
  isCustom: boolean;
  sets?: number;
  reps?: number;
  restSeconds?: number;
  holdSeconds?: number;
  sequenceIndex: number;
  prescribedSide: PrescribedSide;
  resistance: ResistanceContext;
}

export class ProgramExerciseNotAllowedError extends Error {
  constructor(message = "One or more program exercises are unavailable.") {
    super(message);
    this.name = "ProgramExerciseNotAllowedError";
  }
}

async function validateProgramExerciseAccess(
  client: PoolClient,
  therapistId: string,
  exercises: ProgramExerciseInput[],
) {
  const exerciseIds = Array.from(
    new Set(exercises.flatMap((exercise) => exercise.exerciseId ? [exercise.exerciseId] : [])),
  );
  if (exerciseIds.length === 0) return;
  const allowed = await client.query(
    `SELECT id
       FROM exercises
      WHERE id = ANY($1::varchar[])
        AND archived_at IS NULL
        AND (is_custom = FALSE OR owner_therapist_id = $2)`,
    [exerciseIds, therapistId],
  );
  if (allowed.rows.length !== exerciseIds.length) {
    throw new ProgramExerciseNotAllowedError();
  }
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
         (program_id, exercise_id, name, description, is_custom, sets, reps,
          rest_seconds, hold_seconds, sequence_index, prescribed_side, resistance_type,
          resistance_value, resistance_unit, resistance_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
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
        ex.sequenceIndex,
        ex.prescribedSide,
        ex.resistance.type,
        ex.resistance.value,
        ex.resistance.unit,
        ex.resistance.label,
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
    await validateProgramExerciseAccess(client, data.therapistId, data.exercises);
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
    await validateProgramExerciseAccess(client, therapistId, data.exercises);
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
  /** Versioned dynamic-rep quality summary stored in the JSONB column. */
  compensations?: DynamicRepQuality | null;
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
  terminatedBy: "min_reached" | "user" | "pain" | "capture_lost" | "stall";
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

export class ManualOccurrenceNotCompletableError extends Error {
  constructor(message = "This manual exercise is not available to complete today.") {
    super(message);
    this.name = "ManualOccurrenceNotCompletableError";
  }
}

export async function completeManualOccurrence(
  occurrenceId: number,
  patientId: string,
): Promise<{ exerciseName: string; therapistId: string | null }> {
  const result = await pool.query(
    `UPDATE exercise_occurrences eo
        SET status = 'completed', completed_at = NOW()
       FROM patient_exercises pe
       JOIN exercises e ON e.id = pe.exercise_id
       JOIN users u ON u.id = pe.patient_id
      WHERE eo.id = $1
        AND eo.patient_exercise_id = pe.id
        AND pe.patient_id = $2
        AND pe.archived_at IS NULL
        AND e.archived_at IS NULL
        AND e.monitoring_mode = 'manual'
        AND eo.cancelled_at IS NULL
        AND eo.status <> 'completed'
        AND eo.due_date <= $3::date
        AND COALESCE(eo.makeup_until, eo.due_date) >= $3::date
      RETURNING e.name AS exercise_name, u.therapist_id`,
    [occurrenceId, patientId, todayKeyPH()],
  );
  if (result.rows.length === 0) throw new ManualOccurrenceNotCompletableError();
  return {
    exerciseName: result.rows[0].exercise_name as string,
    therapistId: (result.rows[0].therapist_id as string | null) ?? null,
  };
}

export async function createSession(data: {
  patientId: string;
  patientExerciseId: number;
  occurrenceId: number;
  exerciseId: string;
  deviceInfo?: unknown;
}): Promise<{
  id: number;
  startedAt: string;
  runtimePrescription: RuntimePrescription;
  context: SessionContextSnapshotV2;
}> {
  // Strict schedule lock: a patient may only start an exercise that has an
  // actionable occurrence today — due today, or earlier with its make-up window
  // still open. Future, missed, or unscheduled starts are refused. Occurrence
  // windows are disjoint and contiguous, so at most one can match.
  const today = todayKeyPH();
  const definition = getExerciseDefinition(data.exerciseId);
  if (!definition) throw new SessionNotScheduledError("This exercise cannot be camera monitored.");

  const client = await pool.connect();
  let row: Record<string, unknown>;
  let occurrenceId: number;
  let runtimePrescription: RuntimePrescription;
  let context: SessionContextSnapshotV2;
  try {
    await client.query("BEGIN");
    const occ = await client.query(
      `SELECT eo.id, eo.due_date, eo.status,
              COALESCE(eo.makeup_until, eo.due_date) AS makeup_until,
              eo.prescription_snapshot,
              pe.id AS patient_exercise_id, pe.exercise_id,
              pe.sets, pe.reps, pe.rest_seconds, pe.hold_seconds, pe.sequence_index,
              pe.prescribed_side, pe.resistance_type, pe.resistance_value,
              pe.resistance_unit, pe.resistance_label,
              e.name
         FROM exercise_occurrences eo
         JOIN patient_exercises pe ON pe.id = eo.patient_exercise_id
         JOIN exercises e ON e.id = pe.exercise_id
        WHERE eo.id = $1
          AND eo.patient_exercise_id = $2
          AND pe.patient_id = $3
          AND pe.exercise_id = $4
          AND pe.archived_at IS NULL
          AND e.archived_at IS NULL
          AND e.monitoring_mode = 'camera'
          AND eo.cancelled_at IS NULL
          AND eo.due_date <= $5::date
          AND COALESCE(eo.makeup_until, eo.due_date) >= $5::date
          AND eo.status IN ('pending', 'in_progress')
        ORDER BY eo.due_date ASC
        LIMIT 1
        FOR UPDATE OF eo`,
      [data.occurrenceId, data.patientExerciseId, data.patientId, data.exerciseId, today],
    );
    if (occ.rows.length === 0) throw new SessionNotScheduledError();

    const occurrence = occ.rows[0] as Record<string, unknown>;
    occurrenceId = Number(occurrence.id);
    const existingSnapshot = occurrence.prescription_snapshot as
      | PrescriptionSnapshot
      | null;
    const capturedAt = new Date().toISOString();
    const prescription: PrescriptionSnapshotV2 =
      existingSnapshot?.version === PRESCRIPTION_SNAPSHOT_VERSION
        ? existingSnapshot
        : existingSnapshot?.version === 1
          ? {
              ...existingSnapshot,
              version: PRESCRIPTION_SNAPSHOT_VERSION,
              sequenceIndex: Number(occurrence.sequence_index),
            }
        : {
            version: PRESCRIPTION_SNAPSHOT_VERSION,
            capturedAt,
            patientExerciseId: Number(occurrence.patient_exercise_id),
            exerciseId: String(occurrence.exercise_id),
            sets: Number(occurrence.sets),
            reps: Number(occurrence.reps),
            restSeconds: Number(occurrence.rest_seconds),
            holdSeconds: Number(occurrence.hold_seconds),
            sequenceIndex: Number(occurrence.sequence_index),
            prescribedSide: (occurrence.prescribed_side ?? "both") as PrescribedSide,
            resistance: resistanceContextFromRow(occurrence),
            schedule: {
              dueDate: String(occurrence.due_date),
              makeupUntil: String(occurrence.makeup_until),
            },
          };
    const shouldPersistPrescriptionSnapshot =
      occurrence.status === "pending" &&
      (existingSnapshot === null || existingSnapshot.version === 1);

    const exerciseConfigVersion = EXERCISE_CONFIG_VERSIONS[data.exerciseId];
    context = {
      version: SESSION_CONTEXT_VERSION,
      capturedAt,
      prescription,
      schedule: {
        dueDate: String(occurrence.due_date),
        makeupUntil: String(occurrence.makeup_until),
        startedDuringMakeupWindow: today > String(occurrence.due_date),
      },
      exercise: {
        id: data.exerciseId,
        name: String(occurrence.name),
        kind: definition.kind,
        bilateralMode:
          definition.bilateral && definition.bilateralMode
            ? definition.bilateralMode
            : null,
        definition,
        effectiveCompensationBands: effectiveCompensationBands(definition),
      },
      versions: {
        registry: REGISTRY_VERSION,
        exerciseConfig: exerciseConfigVersion,
        appRevision: getAppRevision(),
        poseMetrics: POSE_METRIC_ALGORITHM_VERSION,
        repQuality: REP_QUALITY_VERSION,
        model: null,
      },
    };

    runtimePrescription = {
      occurrenceId,
      patientExerciseId: prescription.patientExerciseId,
      exerciseId: prescription.exerciseId,
      sets: prescription.sets,
      reps: prescription.reps,
      restSeconds: prescription.restSeconds,
      holdSeconds: prescription.holdSeconds,
      sequenceIndex: prescription.sequenceIndex,
      prescribedSide: prescription.prescribedSide,
      resistance: prescription.resistance,
      dueDate: prescription.schedule.dueDate,
      makeupUntil: prescription.schedule.makeupUntil,
    };

    await client.query(
      `UPDATE sessions
          SET ended_at = NOW(), end_reason = 'superseded'
        WHERE patient_exercise_id = $1 AND ended_at IS NULL`,
      [data.patientExerciseId],
    );
    const result = await client.query(
      `INSERT INTO sessions
         (patient_id, patient_exercise_id, exercise_id, device_info, occurrence_id,
          context_snapshot, context_snapshot_version, context_captured_at,
          registry_version, exercise_config_version, app_revision)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, started_at`,
      [
        data.patientId,
        data.patientExerciseId,
        data.exerciseId,
        data.deviceInfo !== undefined ? JSON.stringify(data.deviceInfo) : null,
        occurrenceId,
        JSON.stringify(context),
        SESSION_CONTEXT_VERSION,
        capturedAt,
        REGISTRY_VERSION,
        exerciseConfigVersion,
        context.versions.appRevision,
      ],
    );
    row = result.rows[0] as Record<string, unknown>;
    await client.query(
      `UPDATE exercise_occurrences
          SET status = 'in_progress',
              prescription_snapshot = CASE
                WHEN $5::boolean THEN $2
                ELSE prescription_snapshot
              END,
              prescription_snapshot_version = CASE
                WHEN $5::boolean THEN $3
                ELSE prescription_snapshot_version
              END,
              prescription_captured_at = CASE
                WHEN $5::boolean THEN $4
                ELSE prescription_captured_at
              END
        WHERE id = $1`,
      [
        occurrenceId,
        JSON.stringify(prescription),
        PRESCRIPTION_SNAPSHOT_VERSION,
        prescription.capturedAt,
        shouldPersistPrescriptionSnapshot,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  // Trigger start notification for therapist
  try {
    const patient = await getUserById(data.patientId);
    if (patient && patient.therapistId) {
      const exerciseNameResult = await pool.query("SELECT name FROM exercises WHERE id = $1", [data.exerciseId]);
      const exerciseName = exerciseNameResult.rows[0]?.name || data.exerciseId;
      await createNotification(
        patient.therapistId as string,
        "Exercise Started",
        `${patient.name as string} started exercise ${exerciseName}.`,
        "patient_started_exercise",
        occurrenceId
      );
    }
  } catch (err) {
    console.error("Failed to create start notification:", err);
  }
  return {
    id: Number(row.id),
    startedAt: String(row.started_at),
    runtimePrescription,
    context,
  };
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
    endReason?: Exclude<SessionEndReason, "completed" | "superseded">;
  } = {}
): Promise<boolean> {
  // Terminal session state is immutable: the first completed/user/pain/
  // superseded transition wins. A stale retry may enrich nothing and cannot
  // rewrite the occurrence outcome.
  const endReasonValue = data.completed ? "completed" : data.endReason ?? null;
  if (!endReasonValue) throw new Error("A terminal session reason is required.");

  const client = await pool.connect();
  let transitioned = false;
  try {
    await client.query("BEGIN");
    const session = await client.query(
      "SELECT occurrence_id, ended_at FROM sessions WHERE id = $1 FOR UPDATE",
      [sessionId],
    );
    if (session.rows.length === 0) throw new Error("Session not found.");
    if (session.rows[0].ended_at) {
      await client.query("COMMIT");
      return false;
    }

    await client.query(
      `UPDATE sessions
          SET ended_at = NOW(),
              capture_quality_summary = COALESCE($2, capture_quality_summary),
              notes = COALESCE($3, notes),
              end_reason = $4
        WHERE id = $1`,
      [
        sessionId,
        data.captureQualitySummary !== undefined
          ? JSON.stringify(data.captureQualitySummary)
          : null,
        data.notes ?? null,
        endReasonValue,
      ],
    );
    const occurrenceId = session.rows[0].occurrence_id as number | null;
    if (occurrenceId !== null && data.completed) {
      await client.query(
        `UPDATE exercise_occurrences
            SET status = 'completed', completed_at = NOW()
          WHERE id = $1 AND status IN ('pending', 'in_progress')`,
        [occurrenceId],
      );
    } else if (occurrenceId !== null && endReasonValue === "pain") {
      await client.query(
        `UPDATE exercise_occurrences
            SET status = 'pain_stopped', pain_stopped_at = NOW()
          WHERE id = $1 AND status IN ('pending', 'in_progress')`,
        [occurrenceId],
      );
    }
    transitioned = true;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  // Trigger completion notifications for therapist
  try {
    const sessionResult = await pool.query(
      `SELECT s.patient_id, s.exercise_id, s.occurrence_id, u.name AS patient_name, u.therapist_id, e.name AS exercise_name
       FROM sessions s
       JOIN users u ON u.id = s.patient_id
       JOIN exercises e ON e.id = s.exercise_id
       WHERE s.id = $1`,
      [sessionId]
    );
    if (sessionResult.rows.length > 0) {
      const row = sessionResult.rows[0];
      if (row.therapist_id) {
        if (data.completed) {
          await createNotification(
            row.therapist_id,
            "Exercise Completed",
            `${row.patient_name} completed exercise ${row.exercise_name}.`,
            "patient_completed_exercise",
            row.occurrence_id
          );
          await createNotification(
            row.therapist_id,
            "Session Completed",
            `${row.patient_name} completed a session.`,
            "session_complete",
            row.occurrence_id
          );
        } else if (endReasonValue === "pain") {
          await createNotification(
            row.therapist_id,
            "Exercise stopped because of pain",
            `${row.patient_name} stopped ${row.exercise_name} because of pain. Review before rescheduling.`,
            "patient_pain_stopped",
            row.occurrence_id,
          );
        }
      }
    }
  } catch (err) {
    console.error("Failed to create completion notification:", err);
  }
  return transitioned;
}

export class PainReportConflictError extends Error {
  constructor(message = "This session already has a different pain report.") {
    super(message);
    this.name = "PainReportConflictError";
  }
}

export async function putPainReport(
  sessionId: number,
  patientId: string,
  report:
    | { status: "declined" }
    | {
        status: "reported";
        score: number;
        timing: PainTiming | null;
        bodyArea: string | null;
      },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT pain_report_status, pain_score, pain_timing, pain_body_area, ended_at
         FROM sessions
        WHERE id = $1 AND patient_id = $2
        FOR UPDATE`,
      [sessionId, patientId],
    );
    if (result.rows.length === 0) throw new Error("Session not found.");
    if (!result.rows[0].ended_at) throw new Error("Finish the attempt before reporting pain.");

    const row = result.rows[0];
    const expectedScore = report.status === "reported" ? report.score : null;
    const expectedTiming = report.status === "reported" ? report.timing : null;
    const expectedBodyArea = report.status === "reported" ? report.bodyArea : null;
    if (row.pain_report_status !== "not_reported") {
      const isSame =
        row.pain_report_status === report.status &&
        (row.pain_score === null ? null : Number(row.pain_score)) === expectedScore &&
        (row.pain_timing ?? null) === expectedTiming &&
        (row.pain_body_area ?? null) === expectedBodyArea;
      if (!isSame) throw new PainReportConflictError();
      await client.query("COMMIT");
      return;
    }

    await client.query(
      `UPDATE sessions
          SET pain_report_status = $3,
              pain_score = $4,
              pain_timing = $5,
              pain_body_area = $6,
              pain_reported_at = NOW()
        WHERE id = $1 AND patient_id = $2`,
      [
        sessionId,
        patientId,
        report.status,
        expectedScore,
        expectedTiming,
        expectedBodyArea,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class SessionReviewUnavailableError extends Error {
  constructor(message = "No sufficiently covered rule score is available for review.") {
    super(message);
    this.name = "SessionReviewUnavailableError";
  }
}

export async function appendSessionReview(
  sessionId: number,
  therapistId: string,
  label: TherapistReviewLabel,
): Promise<{ id: number; createdAt: string; idempotent: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sessionResult = await client.query(
      `SELECT s.registry_version, s.exercise_config_version
         FROM sessions s
         JOIN users patient ON patient.id = s.patient_id
        WHERE s.id = $1
          AND patient.therapist_id = $2
          AND (patient.is_archived IS NULL OR patient.is_archived = FALSE)
          AND s.ended_at IS NOT NULL
        FOR UPDATE OF s`,
      [sessionId, therapistId],
    );
    if (sessionResult.rows.length === 0) throw new Error("Session not found or forbidden.");

    const scoreResult = await client.query(
      `SELECT
         (
           SELECT AVG((r.compensations->'rawRule'->>'meanScore')::numeric)
             FROM rep_events r
            WHERE r.session_id = $1
              AND jsonb_typeof(r.compensations->'rawRule'->'meanScore') = 'number'
              AND jsonb_typeof(r.compensations->'rawRule'->'coveragePct') = 'number'
              AND (r.compensations->'rawRule'->>'coveragePct')::numeric >= 80
         ) AS dynamic_score,
         (
           SELECT AVG((st.hold_quality->>'meanCompensationScore')::numeric)
             FROM set_events st
            WHERE st.session_id = $1
              AND jsonb_typeof(st.hold_quality->'meanCompensationScore') = 'number'
         ) AS isometric_score`,
      [sessionId],
    );
    const scores = scoreResult.rows[0];
    const dynamicScore =
      scores.dynamic_score === null ? null : Number(scores.dynamic_score);
    const isometricScore =
      scores.isometric_score === null ? null : Number(scores.isometric_score);
    const scoreValue = dynamicScore ?? isometricScore;
    const scoreSource =
      dynamicScore !== null ? "raw_rule_v1" : "hold_rule_v1";
    if (scoreValue === null || !Number.isFinite(scoreValue)) {
      throw new SessionReviewUnavailableError();
    }

    const latest = await client.query(
      `SELECT id, label, score_source, score_value, created_at
         FROM session_reviews
        WHERE session_id = $1 AND therapist_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [sessionId, therapistId],
    );
    if (
      latest.rows.length > 0 &&
      latest.rows[0].label === label &&
      latest.rows[0].score_source === scoreSource &&
      Number(latest.rows[0].score_value) === scoreValue
    ) {
      await client.query("COMMIT");
      return {
        id: Number(latest.rows[0].id),
        createdAt: String(latest.rows[0].created_at),
        idempotent: true,
      };
    }

    const session = sessionResult.rows[0];
    const inserted = await client.query(
      `INSERT INTO session_reviews
         (session_id, therapist_id, label, score_source, score_value,
          registry_version, exercise_config_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [
        sessionId,
        therapistId,
        label,
        scoreSource,
        scoreValue,
        session.registry_version,
        session.exercise_config_version,
      ],
    );
    await client.query("COMMIT");
    return {
      id: Number(inserted.rows[0].id),
      createdAt: String(inserted.rows[0].created_at),
      idempotent: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Idempotent by `(session_id, rep_index)`: a retried batch inserts nothing and
 * reports the rows it skipped. Durable delivery retries batches after a failed
 * or unacknowledged POST, so the same repetition can legitimately arrive twice.
 *
 * Database uniqueness is the concurrency-safe authority. The outbox serializes
 * ordinary browser flushes, while ON CONFLICT also makes overlapping/retried
 * requests harmless.
 */
export async function insertRepEvents(
  sessionId: number,
  rows: RepEventRow[]
): Promise<{ inserted: number; skipped: number }> {
  if (rows.length === 0) return { inserted: 0, skipped: 0 };
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    for (const r of rows) {
      const result = await client.query(
        `INSERT INTO rep_events
           (session_id, rep_index, set_index, side, peak_value, target_rom,
             time_to_peak_ms, hold_ms, descent_ms, total_ms, classification,
             compensations, start_ts, end_ts)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (session_id, rep_index) DO NOTHING
          RETURNING id`,
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
          r.compensations ? JSON.stringify(r.compensations) : null,
          r.startTs,
          r.endTs,
        ]
      );
      inserted += result.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return { inserted, skipped: rows.length - inserted };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Idempotent by `(session_id, set_index)`. See `insertRepEvents` for rationale. */
export async function insertSetEvents(
  sessionId: number,
  rows: SetEventRow[]
): Promise<{ inserted: number; skipped: number }> {
  if (rows.length === 0) return { inserted: 0, skipped: 0 };
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    for (const r of rows) {
      const result = await client.query(
        `INSERT INTO set_events
           (session_id, set_index, exercise_kind, target_reps, left_reps,
            right_reps, paired_reps, target_hold_ms, paired_hold_ms,
            duration_ms, terminated_by, asymmetry_index, start_ts, end_ts,
            hold_quality)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (session_id, set_index) DO NOTHING
         RETURNING id`,
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
      inserted += result.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return { inserted, skipped: rows.length - inserted };
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
        s.occurrence_id,
        e.name AS exercise_name,
        s.started_at,
        s.ended_at,
        s.end_reason,
        s.context_snapshot,
        s.registry_version,
        s.exercise_config_version,
        s.app_revision,
        s.pain_report_status,
        s.pain_score,
        s.pain_timing,
        s.pain_body_area,
        s.pain_reported_at,
        r.total_reps,
        r.complete_reps,
        r.left_reps,
        r.right_reps,
         r.complete_left_reps,
         r.complete_right_reps,
         r.avg_peak_value,
         r.avg_left_peak_value,
         r.avg_right_peak_value,
         r.avg_dynamic_score,
        st.set_count,
        st.exercise_kind,
         st.total_paired_hold_ms,
         st.total_target_hold_ms,
         st.total_left_hold_ms,
         st.total_right_hold_ms,
         st.total_duration_ms,
        st.avg_asymmetry_index,
        st.avg_compensation_score,
        review.label AS latest_review_label,
        review.score_source AS latest_review_score_source,
        review.score_value AS latest_review_score_value,
        review.created_at AS latest_review_created_at
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
                AVG(peak_value)                                     AS avg_peak_value,
                AVG(peak_value) FILTER (WHERE side = 'left')        AS avg_left_peak_value,
                AVG(peak_value) FILTER (WHERE side = 'right')       AS avg_right_peak_value,
                AVG(
                 CASE
                   WHEN jsonb_typeof(compensations->'rawRule'->'meanScore') = 'number'
                    AND jsonb_typeof(compensations->'rawRule'->'coveragePct') = 'number'
                    AND (compensations->'rawRule'->>'coveragePct')::numeric >= 80
                   THEN (compensations->'rawRule'->>'meanScore')::numeric
                   ELSE NULL
                 END
               ) AS avg_dynamic_score
        FROM rep_events GROUP BY session_id
     ) r ON r.session_id = s.id
     LEFT JOIN (
        SELECT session_id,
               COUNT(*)             AS set_count,
               MAX(exercise_kind)   AS exercise_kind,
                SUM(paired_hold_ms)  AS total_paired_hold_ms,
                SUM(target_hold_ms)  AS total_target_hold_ms,
                SUM(
                  CASE
                    WHEN jsonb_typeof(hold_quality->'leftInBandMs') = 'number'
                      THEN (hold_quality->>'leftInBandMs')::numeric
                    ELSE NULL
                  END
                ) AS total_left_hold_ms,
                SUM(
                  CASE
                    WHEN jsonb_typeof(hold_quality->'rightInBandMs') = 'number'
                      THEN (hold_quality->>'rightInBandMs')::numeric
                    ELSE NULL
                  END
                ) AS total_right_hold_ms,
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
     LEFT JOIN LATERAL (
       SELECT sr.label, sr.score_source, sr.score_value, sr.created_at
         FROM session_reviews sr
        WHERE sr.session_id = s.id
        ORDER BY sr.created_at DESC, sr.id DESC
        LIMIT 1
     ) review ON TRUE
     WHERE s.patient_id = $1
     ORDER BY s.started_at DESC`,
    [patientId]
  );

  return result.rows.map((row) => {
    const context = (row.context_snapshot as SessionContextSnapshot | null) ?? null;
    const prescribedSide = context?.prescription.prescribedSide ?? "both";
    const resistance =
      context?.prescription.resistance ??
      ({ type: "unknown", value: null, unit: null, label: null } as const);
    const exerciseConfigVersion =
      (row.exercise_config_version as string | null) ?? "legacy-unversioned";
    const durationMs =
      row.total_duration_ms != null
        ? Number(row.total_duration_ms)
        : row.ended_at && row.started_at
          ? new Date(row.ended_at).getTime() - new Date(row.started_at).getTime()
          : null;
    return {
      id:                row.id,
      exerciseId:        row.exercise_id,
      occurrenceId:      row.occurrence_id != null ? Number(row.occurrence_id) : null,
      exerciseName:      row.exercise_name,
      exerciseKind:      row.exercise_kind ?? null,   // 'dynamic' | 'isometric' | null
      startedAt:         row.started_at,
      endedAt:           row.ended_at ?? null,
      endReason:         row.end_reason ?? null,
      context,
      registryVersion: row.registry_version ?? null,
      exerciseConfigVersion:
        row.exercise_config_version ?? null,
      appRevision: row.app_revision ?? null,
      prescribedSide,
      resistance,
      comparableContextKey: comparableContextKey({
        exerciseId: String(row.exercise_id),
        prescribedSide,
        resistance,
        exerciseConfigVersion,
      }),
      painReport: {
        status: (row.pain_report_status ?? "not_reported") as PainReportStatus,
        score: row.pain_score == null ? null : Number(row.pain_score),
        timing: (row.pain_timing as PainTiming | null) ?? null,
        bodyArea: row.pain_body_area ?? null,
        reportedAt: row.pain_reported_at ?? null,
      },
      durationMs,
      setCount:          row.set_count != null ? Number(row.set_count) : 0,
      totalReps:         row.total_reps != null ? Number(row.total_reps) : 0,
      completeReps:      row.complete_reps != null ? Number(row.complete_reps) : 0,
      leftReps:          row.left_reps != null ? Number(row.left_reps) : 0,
      rightReps:         row.right_reps != null ? Number(row.right_reps) : 0,
      completeLeftReps:  row.complete_left_reps != null ? Number(row.complete_left_reps) : 0,
      completeRightReps: row.complete_right_reps != null ? Number(row.complete_right_reps) : 0,
      avgPeakValue:      row.avg_peak_value != null ? Number(row.avg_peak_value) : null,
      avgLeftPeakValue:  row.avg_left_peak_value != null ? Number(row.avg_left_peak_value) : null,
      avgRightPeakValue: row.avg_right_peak_value != null ? Number(row.avg_right_peak_value) : null,
      totalPairedHoldMs: row.total_paired_hold_ms != null ? Number(row.total_paired_hold_ms) : null,
      totalTargetHoldMs: row.total_target_hold_ms != null ? Number(row.total_target_hold_ms) : null,
      totalLeftHoldMs:   row.total_left_hold_ms != null ? Number(row.total_left_hold_ms) : null,
      totalRightHoldMs:  row.total_right_hold_ms != null ? Number(row.total_right_hold_ms) : null,
      avgAsymmetryIndex: row.avg_asymmetry_index != null ? Number(row.avg_asymmetry_index) : null,
      avgCompensationScore: row.avg_compensation_score != null ? Number(row.avg_compensation_score) : null,
      reviewScore:
        row.avg_dynamic_score != null
          ? Number(row.avg_dynamic_score)
          : row.avg_compensation_score != null
            ? Number(row.avg_compensation_score)
            : null,
      reviewScoreSource:
        row.avg_dynamic_score != null
          ? "raw_rule_v1"
          : row.avg_compensation_score != null
            ? "hold_rule_v1"
            : null,
      latestReview:
        row.latest_review_label
          ? {
              label: row.latest_review_label,
              scoreSource: row.latest_review_score_source,
              scoreValue: Number(row.latest_review_score_value),
              createdAt: row.latest_review_created_at,
            }
          : null,
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
        COALESCE(ex.missed_count, 0)         AS missed_count,
        COALESCE(ex.pain_stopped_count, 0)   AS pain_stopped_count
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
               COUNT(DISTINCT pe.id) FILTER (WHERE pe.archived_at IS NULL)         AS assigned_count,
               COUNT(eo.id) FILTER (WHERE eo.cancelled_at IS NULL
                                      AND eo.due_date <= $2::date
                                      AND eo.status <> 'pain_stopped')              AS due_count,
               COUNT(eo.id) FILTER (WHERE eo.cancelled_at IS NULL
                                      AND eo.status = 'completed')                  AS completed_count,
               COUNT(eo.id) FILTER (WHERE COALESCE(eo.makeup_until, eo.due_date) < $2::date
                                      AND eo.status <> 'completed'
                                      AND eo.status <> 'pain_stopped'
                                      AND eo.cancelled_at IS NULL)                  AS missed_count,
               COUNT(eo.id) FILTER (WHERE eo.cancelled_at IS NULL
                                      AND eo.status = 'pain_stopped')               AS pain_stopped_count
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
    painStoppedCount: Number(row.pain_stopped_count),
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
            s.device_info, s.capture_quality_summary, s.notes, s.end_reason,
            s.context_snapshot, s.registry_version, s.exercise_config_version,
            s.app_revision, s.pain_report_status, s.pain_score, s.pain_timing,
            s.pain_body_area, s.pain_reported_at
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
             hold_ms, descent_ms, total_ms, classification, compensations,
             start_ts, end_ts
     FROM rep_events WHERE session_id = $1 ORDER BY rep_index ASC`,
    [sessionId]
  );
  const reviewsRes = await pool.query(
    `SELECT id, therapist_id, label, score_source, score_value,
            registry_version, exercise_config_version, created_at
       FROM session_reviews
      WHERE session_id = $1
      ORDER BY created_at ASC, id ASC`,
    [sessionId],
  );

  return {
    id:               s.id,
    patientId:        s.patient_id,
    exerciseId:       s.exercise_id,
    exerciseName:     s.exercise_name,
    startedAt:        s.started_at,
    endedAt:          s.ended_at ?? null,
    endReason:        s.end_reason ?? null,
    notes:            s.notes ?? null,
    context:          s.context_snapshot ?? null,
    registryVersion:  s.registry_version ?? null,
    exerciseConfigVersion: s.exercise_config_version ?? null,
    appRevision:      s.app_revision ?? null,
    painReport: {
      status: (s.pain_report_status ?? "not_reported") as PainReportStatus,
      score: s.pain_score == null ? null : Number(s.pain_score),
      timing: (s.pain_timing as PainTiming | null) ?? null,
      bodyArea: s.pain_body_area ?? null,
      reportedAt: s.pain_reported_at ?? null,
    },
    captureQuality:   parseCaptureQualitySummary(s.capture_quality_summary),
    deviceContext:    summarizeDeviceInfo(s.device_info),
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
      compensations:  r.compensations ?? null,
    })),
    reviews: reviewsRes.rows.map((review) => ({
      id: Number(review.id),
      therapistId: review.therapist_id,
      label: review.label,
      scoreSource: review.score_source,
      scoreValue: Number(review.score_value),
      registryVersion: review.registry_version ?? null,
      exerciseConfigVersion: review.exercise_config_version ?? null,
      createdAt: review.created_at,
    })),
  };
}

// ── Notifications ────────────────────────────────────────────────────────────

export async function createNotification(
  userId: string,
  title: string,
  message: string,
  type: string,
  occurrenceId: number | null = null
): Promise<void> {
  await pool.query(
    `INSERT INTO notifications (user_id, title, message, type, occurrence_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, title, message, type, occurrenceId]
  );
}

export async function createAdminNotification(
  title: string,
  message: string,
  type: string,
  occurrenceId: number | null = null
): Promise<void> {
  const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
  for (const admin of admins.rows) {
    await createNotification(admin.id, title, message, type, occurrenceId);
  }
}

export async function getNotifications(userId: string) {
  const result = await pool.query(
    `SELECT id, user_id AS "userId", title, message, type, occurrence_id AS "occurrenceId", is_read AS "isRead", created_at AS "createdAt"
     FROM notifications
     WHERE user_id = $1 AND (is_deleted IS NULL OR is_deleted = FALSE)
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function markNotificationAsRead(id: number, userId: string): Promise<void> {
  await pool.query(
    "UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2",
    [id, userId]
  );
}

export async function markAllNotificationsAsRead(userId: string): Promise<void> {
  await pool.query(
    "UPDATE notifications SET is_read = TRUE WHERE user_id = $1",
    [userId]
  );
}

export async function syncTimeNotifications(patientId: string): Promise<void> {
  const today = todayKeyPH();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

  // 1. Fetch missed occurrences. Pain-stopped attempts are closed for therapist
  // review and are neither completed nor missed.
  const missedResult = await pool.query(
    `SELECT eo.id, eo.due_date, pe.exercise_id, e.name AS exercise_name, u.name AS patient_name, u.therapist_id
     FROM exercise_occurrences eo
     JOIN patient_exercises pe ON pe.id = eo.patient_exercise_id
     JOIN exercises e ON e.id = pe.exercise_id
     JOIN users u ON u.id = pe.patient_id
     WHERE pe.patient_id = $1
       AND pe.archived_at IS NULL
       AND e.archived_at IS NULL
       AND eo.cancelled_at IS NULL
       AND eo.status NOT IN ('completed', 'pain_stopped')
       AND eo.makeup_until < $2::date`,
    [patientId, today]
  );

  for (const row of missedResult.rows) {
    // Check if patient notification exists
    const pCheck = await pool.query(
      "SELECT id FROM notifications WHERE user_id = $1 AND occurrence_id = $2 AND type = 'exercise_missed'",
      [patientId, row.id]
    );
    if (pCheck.rows.length === 0) {
      const formattedDate = new Date(row.due_date).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric"
      });
      await createNotification(
        patientId,
        "Exercise Missed",
        `You missed exercise ${row.exercise_name} scheduled for ${formattedDate}.`,
        "exercise_missed",
        row.id
      );
    }

    // Check if therapist notification exists
    if (row.therapist_id) {
      const tCheck = await pool.query(
        "SELECT id FROM notifications WHERE user_id = $1 AND occurrence_id = $2 AND type = 'exercise_missed'",
        [row.therapist_id, row.id]
      );
      if (tCheck.rows.length === 0) {
        const formattedDate = new Date(row.due_date).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric"
        });
        await createNotification(
          row.therapist_id,
          "Exercise Missed",
          `${row.patient_name} missed exercise ${row.exercise_name} scheduled for ${formattedDate}.`,
          "exercise_missed",
          row.id
        );
      }
    }
  }

  // 2. Fetch tomorrow's occurrences: due_date = tomorrowStr AND status = 'pending'
  const tomorrowResult = await pool.query(
    `SELECT eo.id, e.name AS exercise_name
     FROM exercise_occurrences eo
     JOIN patient_exercises pe ON pe.id = eo.patient_exercise_id
     JOIN exercises e ON e.id = pe.exercise_id
     WHERE pe.patient_id = $1
       AND pe.archived_at IS NULL
       AND e.archived_at IS NULL
       AND eo.cancelled_at IS NULL
       AND eo.status = 'pending'
       AND eo.due_date = $2::date`,
    [patientId, tomorrowStr]
  );

  for (const row of tomorrowResult.rows) {
    const pCheck = await pool.query(
      "SELECT id FROM notifications WHERE user_id = $1 AND occurrence_id = $2 AND type = 'scheduled_tomorrow'",
      [patientId, row.id]
    );
    if (pCheck.rows.length === 0) {
      await createNotification(
        patientId,
        "Exercise Starting Tomorrow",
        `Exercise ${row.exercise_name} is scheduled to start tomorrow.`,
        "scheduled_tomorrow",
        row.id
      );
    }
  }
}

export async function deleteNotification(id: number, userId: string): Promise<void> {
  await pool.query(
    "UPDATE notifications SET is_deleted = TRUE WHERE id = $1 AND user_id = $2",
    [id, userId]
  );
}

export async function deleteMultipleNotifications(ids: number[], userId: string): Promise<void> {
  if (ids.length === 0) return;
  await pool.query(
    "UPDATE notifications SET is_deleted = TRUE WHERE id = ANY($1::integer[]) AND user_id = $2",
    [ids, userId]
  );
}

export async function getAdminDashboardData(adminId: string) {
  // 1. Stats queries
  const activePatients = await pool.query(
    "SELECT COUNT(*)::integer FROM users WHERE role = 'patient' AND (is_archived IS NULL OR is_archived = FALSE)"
  );
  const activeTherapists = await pool.query(
    "SELECT COUNT(*)::integer FROM users WHERE role = 'therapist' AND (is_archived IS NULL OR is_archived = FALSE)"
  );
  const archivedUsers = await pool.query(
    "SELECT COUNT(*)::integer FROM users WHERE is_archived = TRUE"
  );
  const systemExercises = await pool.query(
    "SELECT COUNT(*)::integer FROM exercises WHERE is_custom = FALSE"
  );
  const customExercises = await pool.query(
    "SELECT COUNT(*)::integer FROM exercises WHERE is_custom = TRUE"
  );
  const totalSessions = await pool.query(
    "SELECT COUNT(*)::integer FROM sessions"
  );
  const activeAssignments = await pool.query(
    "SELECT COUNT(*)::integer FROM patient_exercises"
  );

  // 2. Recent activity logs (login/logout events and other admin notifications)
  const activityLogs = await pool.query(
    `SELECT id, title, message, type, created_at AS "createdAt"
     FROM notifications
     WHERE user_id = $1 AND type IN ('user_login', 'user_logout', 'therapist_password_change') AND (is_deleted IS NULL OR is_deleted = FALSE)
     ORDER BY created_at DESC
     LIMIT 20`,
    [adminId]
  );

  // 3. Recent completed sessions
  const recentSessions = await pool.query(
    `SELECT s.id, s.started_at AS "startedAt", p.name AS "patientName", e.name AS "exerciseName", s.end_reason AS "endReason"
     FROM sessions s
     JOIN users p ON s.patient_id = p.id
     JOIN exercises e ON s.exercise_id = e.id
     ORDER BY s.started_at DESC
     LIMIT 5`
  );

  return {
    stats: {
      activePatients: activePatients.rows[0].count,
      activeTherapists: activeTherapists.rows[0].count,
      archivedUsers: archivedUsers.rows[0].count,
      systemExercises: systemExercises.rows[0].count,
      customExercises: customExercises.rows[0].count,
      totalSessions: totalSessions.rows[0].count,
      activeAssignments: activeAssignments.rows[0].count,
    },
    activityLogs: activityLogs.rows,
    recentSessions: recentSessions.rows,
  };
}

export async function clearActivityLogs(adminId: string): Promise<void> {
  await pool.query(
    `UPDATE notifications
     SET is_deleted = TRUE
     WHERE user_id = $1 AND type IN ('user_login', 'user_logout', 'therapist_password_change')`,
    [adminId]
  );
}

export default pool;
