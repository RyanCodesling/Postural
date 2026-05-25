import { Pool, PoolClient, types } from "pg";

// Return DATE columns as plain YYYY-MM-DD strings instead of Date objects
types.setTypeParser(1082, (val: string) => val);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Maps snake_case DB columns to camelCase for the app
function mapUser(row: any) {
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
  const params: any[] = [];

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
  const params: any[] = [];

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
      params.push((data as any)[key]);
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

type PatientExerciseAssignment = {
  exerciseId: string;
  sets: number;
  reps: number;
  restSeconds?: number;
  scheduledDate?: string; // YYYY-MM-DD; falls back to CURRENT_DATE if omitted
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

export async function assignExercisesToPatient(
  patientId: string,
  exercises: PatientExerciseAssignment[]
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const ex of exercises) {
      const restSeconds = normalizeRestSeconds(ex.restSeconds);
      const assignedDate =
        ex.scheduledDate && /^\d{4}-\d{2}-\d{2}$/.test(ex.scheduledDate)
          ? ex.scheduledDate
          : new Date().toISOString().split("T")[0];
      await client.query(
        `INSERT INTO patient_exercises (exercise_id, patient_id, sets, reps, rest_seconds, assigned_date)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (exercise_id, patient_id) DO UPDATE
         SET sets          = EXCLUDED.sets,
             reps          = EXCLUDED.reps,
             rest_seconds  = EXCLUDED.rest_seconds,
             assigned_date = EXCLUDED.assigned_date`,
        [ex.exerciseId, patientId, ex.sets, ex.reps, restSeconds, assignedDate]
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
            pe.status, pe.sets, pe.reps, pe.rest_seconds, e.name, e.description
     FROM patient_exercises pe
     JOIN exercises e ON e.id = pe.exercise_id
     WHERE pe.patient_id = $1
     ORDER BY pe.id ASC`,
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
                  'restSeconds', te.rest_seconds
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
}

interface ProgramExerciseInput {
  exerciseId?: string;
  name: string;
  description?: string;
  isCustom: boolean;
  sets?: number;
  reps?: number;
  restSeconds?: number;
}

async function insertProgramExercises(
  client: PoolClient,
  programId: string,
  exercises: ProgramExerciseInput[]
) {
  for (const ex of exercises) {
    await client.query(
      `INSERT INTO program_exercises
         (program_id, exercise_id, name, description, is_custom, sets, reps, rest_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        programId,
        ex.exerciseId ?? null,
        ex.name,
        ex.description ?? null,
        ex.isCustom,
        ex.sets ?? null,
        ex.reps ?? null,
        ex.restSeconds != null && ex.restSeconds >= 0 ? ex.restSeconds : 60,
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

export default pool;
