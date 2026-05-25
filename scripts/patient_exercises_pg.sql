-- Patient-exercise assignment table.
-- Run this in pgAdmin after exercises_pg.sql.

CREATE TABLE IF NOT EXISTS patient_exercises (
  id            SERIAL       PRIMARY KEY,
  exercise_id   VARCHAR(50)  NOT NULL REFERENCES exercises(id)  ON DELETE CASCADE,
  patient_id    VARCHAR(50)  NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  assigned_date DATE         NOT NULL DEFAULT CURRENT_DATE,
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'in_progress', 'completed')),
  sets          INT          NOT NULL DEFAULT 3,
  reps          INT          NOT NULL DEFAULT 12,
  rest_seconds  INT          NOT NULL DEFAULT 60,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (exercise_id, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_pe_patient_id   ON patient_exercises (patient_id);
CREATE INDEX IF NOT EXISTS idx_pe_exercise_id  ON patient_exercises (exercise_id);

-- Add columns if table already exists (safe to re-run)
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS sets         INT  NOT NULL DEFAULT 3;
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS reps         INT  NOT NULL DEFAULT 12;
-- Per-prescription rest between sets, in seconds.
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS rest_seconds INT  NOT NULL DEFAULT 60;
-- Therapist-scheduled date for this exercise (shown in session page, gates Start Session).
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS assigned_date DATE NOT NULL DEFAULT CURRENT_DATE;

GRANT ALL PRIVILEGES ON TABLE patient_exercises TO postural;
GRANT USAGE, SELECT ON SEQUENCE patient_exercises_id_seq TO postural;
