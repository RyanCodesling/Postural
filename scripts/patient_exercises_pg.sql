-- Patient-exercise assignment table.
-- Run this in pgAdmin after exercises_pg.sql.

CREATE TABLE IF NOT EXISTS patient_exercises (
  id            SERIAL       PRIMARY KEY,
  exercise_id   VARCHAR(50)  NOT NULL REFERENCES exercises(id)  ON DELETE RESTRICT,
  patient_id    VARCHAR(50)  NOT NULL REFERENCES users(id)      ON DELETE RESTRICT,
  assigned_date DATE         NOT NULL DEFAULT CURRENT_DATE,
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'in_progress', 'completed')),
  sets          INT          NOT NULL DEFAULT 3,
  reps          INT          NOT NULL DEFAULT 12,
  rest_seconds  INT          NOT NULL DEFAULT 60,
  -- Patient-specific clinical workflow order. Lower values are performed first.
  sequence_index INT         NOT NULL,
  -- Per-side target hold duration (seconds) for isometric exercises (e.g.
  -- ex_006 T-pose). Ignored by dynamic (rep-counted) exercises. Therapist sets
  -- it when assigning; the camera page completes an isometric set when each
  -- side accumulates this many seconds in the target band.
  hold_seconds  INT          NOT NULL DEFAULT 30,
  -- Movement context is part of the prescription. "unknown" is reserved for
  -- rows created before this migration; all new application writes provide an
  -- explicit value (normally "none").
  prescribed_side  TEXT         NOT NULL DEFAULT 'both',
  resistance_type  TEXT         NOT NULL DEFAULT 'unknown',
  resistance_value NUMERIC(10,3),
  resistance_unit  TEXT,
  resistance_label VARCHAR(80),
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  archived_at   TIMESTAMPTZ,
  archived_by   VARCHAR(50)  REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pe_patient_id   ON patient_exercises (patient_id);
CREATE INDEX IF NOT EXISTS idx_pe_exercise_id  ON patient_exercises (exercise_id);

-- Add sets and reps columns if table already exists (safe to re-run)
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS sets INT NOT NULL DEFAULT 3;
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS reps INT NOT NULL DEFAULT 12;
-- Per-prescription rest between sets, in seconds. Therapist sets it when
-- assigning; the camera page enforces it as a hard block between sets.
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS rest_seconds INT NOT NULL DEFAULT 60;
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS sequence_index INT;
-- Therapist-scheduled date for this exercise (shown in session page, gates Start Session).
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS assigned_date DATE NOT NULL DEFAULT CURRENT_DATE;
-- Per-prescription target hold duration, in seconds, for isometric exercises.
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS hold_seconds INT NOT NULL DEFAULT 30;
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS prescribed_side TEXT NOT NULL DEFAULT 'both';
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS resistance_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS resistance_value NUMERIC(10,3);
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS resistance_unit TEXT;
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS resistance_label VARCHAR(80);
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS archived_by VARCHAR(50)
  REFERENCES users(id) ON DELETE SET NULL;

-- Preserve each patient's existing insertion order as the initial explicit
-- sequence; therapists can then edit it through the assignment/program UI.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY id)::int AS sequence_index
  FROM patient_exercises
)
UPDATE patient_exercises pe
SET sequence_index = ranked.sequence_index
FROM ranked
WHERE pe.id = ranked.id
  AND pe.sequence_index IS NULL;
ALTER TABLE patient_exercises ALTER COLUMN sequence_index SET NOT NULL;
ALTER TABLE patient_exercises DROP CONSTRAINT IF EXISTS patient_exercises_sequence_index_check;
ALTER TABLE patient_exercises
  ADD CONSTRAINT patient_exercises_sequence_index_check CHECK (sequence_index >= 1);
CREATE INDEX IF NOT EXISTS idx_patient_exercises_sequence
  ON patient_exercises (patient_id, sequence_index, exercise_id, id);

-- Older installations used a table-wide UNIQUE constraint. Replacing it with
-- an active-row partial index preserves archived prescription snapshots while
-- still preventing duplicate active prescriptions for the same exercise.
ALTER TABLE patient_exercises
  DROP CONSTRAINT IF EXISTS patient_exercises_exercise_id_patient_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pe_active_exercise_patient
  ON patient_exercises (exercise_id, patient_id)
  WHERE archived_at IS NULL;

-- Defense in depth: ordinary exercise removal must never cascade through a
-- patient's prescription/session history.
ALTER TABLE patient_exercises DROP CONSTRAINT IF EXISTS patient_exercises_exercise_id_fkey;
ALTER TABLE patient_exercises
  ADD CONSTRAINT patient_exercises_exercise_id_fkey
  FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE RESTRICT;

-- A prescription snapshot is durable clinical history. User-account cleanup
-- must never cascade through it.
ALTER TABLE patient_exercises DROP CONSTRAINT IF EXISTS patient_exercises_patient_id_fkey;
ALTER TABLE patient_exercises
  ADD CONSTRAINT patient_exercises_patient_id_fkey
  FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE RESTRICT;

-- ── Recurrence rule ──────────────────────────────────────────────────────────
-- How this assignment repeats. The rule lives on the assignment; the expanded
-- per-day instances live in exercise_occurrences. A NULL recurrence (legacy
-- rows) is treated as 'once'. weekdays uses JS Date.getDay() numbering
-- (0=Sun … 6=Sat) so it lines up with the calendar UI with no conversion.
-- assigned_date is retained as the "first scheduled day" for display/back-compat.
-- recurrence: 'interval' (every N days) | 'weekly' (specific weekdays). A NULL
-- recurrence (legacy rows) is treated as a single fixed occurrence.
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS recurrence    TEXT;        -- 'interval' | 'weekly'
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS interval_days INT;         -- 'interval' mode: every N days
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS weekdays      SMALLINT[];  -- 'weekly' mode: e.g. {1,3,5}
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS start_date    DATE;        -- recurrence window start (defaults to assigned_date)
ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS end_date      DATE;        -- recurrence window end (inclusive)

ALTER TABLE patient_exercises DROP CONSTRAINT IF EXISTS patient_exercises_prescribed_side_check;
ALTER TABLE patient_exercises
  ADD CONSTRAINT patient_exercises_prescribed_side_check
  CHECK (prescribed_side IN ('both', 'left', 'right'));

ALTER TABLE patient_exercises DROP CONSTRAINT IF EXISTS patient_exercises_resistance_check;
ALTER TABLE patient_exercises
  ADD CONSTRAINT patient_exercises_resistance_check CHECK (
    resistance_type IN ('unknown', 'none', 'external_weight', 'resistance_band', 'other')
    AND (resistance_value IS NULL OR resistance_value > 0)
    AND (resistance_unit IS NULL OR resistance_unit IN ('kg', 'lb'))
    AND ((resistance_value IS NULL) = (resistance_unit IS NULL))
    AND (
      (resistance_type IN ('unknown', 'none')
        AND resistance_value IS NULL AND resistance_unit IS NULL AND resistance_label IS NULL)
      OR
      (resistance_type = 'external_weight'
        AND resistance_value IS NOT NULL AND resistance_unit IS NOT NULL
        AND resistance_label IS NULL)
      OR
      (resistance_type IN ('resistance_band', 'other')
        AND NULLIF(BTRIM(resistance_label), '') IS NOT NULL)
    )
  );

GRANT ALL PRIVILEGES ON TABLE patient_exercises TO postural;
GRANT USAGE, SELECT ON SEQUENCE patient_exercises_id_seq TO postural;
