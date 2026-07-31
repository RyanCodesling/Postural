\set ON_ERROR_STOP on

-- Rollback-only PostgreSQL rehearsal for the patient exercise workflow schema.
-- Run with psql while connected as the ordinary application role. All objects
-- live in pg_temp and the outer transaction is rolled back.
BEGIN;
SET LOCAL search_path = pg_temp;

CREATE TEMP TABLE users (
  id VARCHAR(50) PRIMARY KEY
);
CREATE TEMP TABLE exercises (
  id VARCHAR(50) PRIMARY KEY
);

CREATE TEMP TABLE exercise_programs (
  id VARCHAR(50) PRIMARY KEY,
  therapist_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TEMP TABLE program_exercises (
  id SERIAL PRIMARY KEY,
  program_id VARCHAR(50) NOT NULL REFERENCES exercise_programs(id) ON DELETE CASCADE,
  exercise_id VARCHAR(50) REFERENCES exercises(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  sets INT,
  reps INT
);

CREATE TEMP TABLE patient_exercises (
  id SERIAL PRIMARY KEY,
  exercise_id VARCHAR(50) NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  patient_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (exercise_id, patient_id)
);

CREATE TEMP TABLE exercise_occurrences (
  id SERIAL PRIMARY KEY,
  patient_exercise_id INTEGER NOT NULL REFERENCES patient_exercises(id) ON DELETE CASCADE,
  due_date DATE NOT NULL,
  makeup_until DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'pain_stopped')),
  completed_at TIMESTAMPTZ,
  pain_stopped_at TIMESTAMPTZ,
  prescription_snapshot JSONB,
  prescription_snapshot_version INT,
  prescription_captured_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (patient_exercise_id, due_date)
);

CREATE TEMP TABLE sessions (
  id SERIAL PRIMARY KEY,
  patient_exercise_id INTEGER NOT NULL REFERENCES patient_exercises(id) ON DELETE CASCADE
);

INSERT INTO users (id) VALUES ('therapist_test'), ('patient_test');
INSERT INTO exercises (id) VALUES ('ex_001'), ('ex_006');
INSERT INTO exercise_programs (id, therapist_id, name)
VALUES ('program_test', 'therapist_test', 'Workflow rehearsal');
INSERT INTO program_exercises
  (program_id, exercise_id, name, description, is_custom, sets, reps)
VALUES
  ('program_test', 'ex_006', 'Arm Abduction at 90 degrees', '', FALSE, 1, 1),
  ('program_test', 'ex_001', 'Lateral Arm Raises', '', FALSE, 1, 2);

INSERT INTO patient_exercises (exercise_id, patient_id, status)
VALUES
  ('ex_006', 'patient_test', 'pending'),
  ('ex_001', 'patient_test', 'in_progress');

INSERT INTO exercise_occurrences (
  patient_exercise_id,
  due_date,
  makeup_until,
  status,
  prescription_snapshot,
  prescription_snapshot_version,
  prescription_captured_at
)
SELECT
  pe.id,
  (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date,
  (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date,
  pe.status,
  jsonb_build_object(
    'version', 1,
    'capturedAt', NOW(),
    'patientExerciseId', pe.id,
    'exerciseId', pe.exercise_id,
    'sets', 1,
    'reps', CASE WHEN pe.exercise_id = 'ex_001' THEN 2 ELSE 1 END,
    'restSeconds', 60,
    'holdSeconds', 30,
    'prescribedSide', 'both',
    'resistance', jsonb_build_object(
      'type', 'none', 'value', NULL, 'unit', NULL, 'label', NULL
    ),
    'schedule', jsonb_build_object(
      'dueDate', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date,
      'makeupUntil', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
    )
  ),
  1,
  NOW()
FROM patient_exercises pe;

INSERT INTO sessions (patient_exercise_id)
SELECT id FROM patient_exercises WHERE status = 'in_progress';

\ir ../exercise_programs_pg.sql
\ir ../patient_exercises_pg.sql
\ir ../exercise_occurrences_pg.sql

-- A second pass proves the scripts remain idempotent after the new columns,
-- constraints, indexes, and snapshot versions already exist.
\ir ../exercise_programs_pg.sql
\ir ../patient_exercises_pg.sql
\ir ../exercise_occurrences_pg.sql

DO $$
DECLARE
  program_order INT[];
  patient_order INT[];
  pending_snapshot JSONB;
  pending_version INT;
  started_snapshot JSONB;
  started_version INT;
BEGIN
  SELECT ARRAY_AGG(sequence_index ORDER BY id)
    INTO program_order
    FROM program_exercises;
  IF program_order IS DISTINCT FROM ARRAY[1, 2] THEN
    RAISE EXCEPTION 'program sequence backfill mismatch: %', program_order;
  END IF;

  SELECT ARRAY_AGG(sequence_index ORDER BY id)
    INTO patient_order
    FROM patient_exercises;
  IF patient_order IS DISTINCT FROM ARRAY[1, 2] THEN
    RAISE EXCEPTION 'patient sequence backfill mismatch: %', patient_order;
  END IF;

  SELECT eo.prescription_snapshot, eo.prescription_snapshot_version
    INTO pending_snapshot, pending_version
    FROM exercise_occurrences eo
    JOIN patient_exercises pe ON pe.id = eo.patient_exercise_id
   WHERE pe.status = 'pending';
  IF pending_version IS DISTINCT FROM 2
     OR (pending_snapshot ->> 'sequenceIndex')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'pending V1 snapshot was not upgraded with sequence: %, %',
      pending_version, pending_snapshot;
  END IF;

  SELECT eo.prescription_snapshot, eo.prescription_snapshot_version
    INTO started_snapshot, started_version
    FROM exercise_occurrences eo
    JOIN patient_exercises pe ON pe.id = eo.patient_exercise_id
   WHERE pe.status = 'in_progress';
  IF started_version IS DISTINCT FROM 1
     OR started_snapshot ? 'sequenceIndex' THEN
    RAISE EXCEPTION 'started V1 snapshot was rewritten: %, %',
      started_version, started_snapshot;
  END IF;

  IF EXISTS (
    SELECT 1 FROM program_exercises WHERE sequence_index IS NULL OR sequence_index < 1
  ) OR EXISTS (
    SELECT 1 FROM patient_exercises WHERE sequence_index IS NULL OR sequence_index < 1
  ) THEN
    RAISE EXCEPTION 'invalid workflow sequence survived migration';
  END IF;

  IF EXISTS (SELECT 1 FROM sessions WHERE occurrence_id IS NULL) THEN
    RAISE EXCEPTION 'unambiguous legacy session was not linked to its occurrence';
  END IF;
END
$$;

\ir ./verify_patient_exercise_workflow_deployment_pg.sql

SELECT
  (SELECT COUNT(*) FROM program_exercises) AS program_exercises,
  (SELECT COUNT(*) FROM patient_exercises) AS patient_exercises,
  (SELECT COUNT(*) FROM exercise_occurrences) AS occurrences,
  (SELECT COUNT(*) FROM sessions) AS sessions,
  'rollback-only rehearsal passed' AS result;

ROLLBACK;
