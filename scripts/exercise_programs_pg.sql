-- Exercise programs for therapists.
-- Run after exercises_pg.sql.

CREATE TABLE IF NOT EXISTS exercise_programs (
  id           VARCHAR(50)  PRIMARY KEY,
  therapist_id VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name         VARCHAR(255) NOT NULL,
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS program_exercises (
  id           SERIAL       PRIMARY KEY,
  program_id   VARCHAR(50)  NOT NULL REFERENCES exercise_programs(id) ON DELETE CASCADE,
  exercise_id  VARCHAR(50)  REFERENCES exercises(id) ON DELETE SET NULL,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  is_custom    BOOLEAN      NOT NULL DEFAULT FALSE,
  sets         INT,
  reps         INT,
  rest_seconds INT          NOT NULL DEFAULT 60,
  -- Therapist-controlled order copied into patient prescriptions.
  sequence_index INT        NOT NULL,
  -- Per-side target hold duration (seconds) for isometric program entries.
  -- Ignored by dynamic exercises.
  hold_seconds INT          NOT NULL DEFAULT 30,
  prescribed_side  TEXT         NOT NULL DEFAULT 'both',
  resistance_type  TEXT         NOT NULL DEFAULT 'unknown',
  resistance_value NUMERIC(10,3),
  resistance_unit  TEXT,
  resistance_label VARCHAR(80)
);

ALTER TABLE program_exercises ADD COLUMN IF NOT EXISTS rest_seconds INT NOT NULL DEFAULT 60;
ALTER TABLE program_exercises ADD COLUMN IF NOT EXISTS sequence_index INT;
ALTER TABLE program_exercises ADD COLUMN IF NOT EXISTS hold_seconds INT NOT NULL DEFAULT 30;
ALTER TABLE program_exercises ADD COLUMN IF NOT EXISTS prescribed_side TEXT NOT NULL DEFAULT 'both';
ALTER TABLE program_exercises ADD COLUMN IF NOT EXISTS resistance_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE program_exercises ADD COLUMN IF NOT EXISTS resistance_value NUMERIC(10,3);
ALTER TABLE program_exercises ADD COLUMN IF NOT EXISTS resistance_unit TEXT;
ALTER TABLE program_exercises ADD COLUMN IF NOT EXISTS resistance_label VARCHAR(80);

-- Existing programs previously inherited insertion order. Preserve that order
-- once, then make all future writes explicit and validated.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY program_id ORDER BY id)::int AS sequence_index
  FROM program_exercises
)
UPDATE program_exercises pe
SET sequence_index = ranked.sequence_index
FROM ranked
WHERE pe.id = ranked.id
  AND pe.sequence_index IS NULL;
ALTER TABLE program_exercises ALTER COLUMN sequence_index SET NOT NULL;
ALTER TABLE program_exercises DROP CONSTRAINT IF EXISTS program_exercises_sequence_index_check;
ALTER TABLE program_exercises
  ADD CONSTRAINT program_exercises_sequence_index_check CHECK (sequence_index >= 1);

-- Program ownership is retained as durable therapist work.
ALTER TABLE exercise_programs DROP CONSTRAINT IF EXISTS exercise_programs_therapist_id_fkey;
ALTER TABLE exercise_programs
  ADD CONSTRAINT exercise_programs_therapist_id_fkey
  FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE program_exercises DROP CONSTRAINT IF EXISTS program_exercises_prescribed_side_check;
ALTER TABLE program_exercises
  ADD CONSTRAINT program_exercises_prescribed_side_check
  CHECK (prescribed_side IN ('both', 'left', 'right'));

ALTER TABLE program_exercises DROP CONSTRAINT IF EXISTS program_exercises_resistance_check;
ALTER TABLE program_exercises
  ADD CONSTRAINT program_exercises_resistance_check CHECK (
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

CREATE INDEX IF NOT EXISTS idx_ep_therapist_id ON exercise_programs (therapist_id);
CREATE INDEX IF NOT EXISTS idx_pe_program_id   ON program_exercises  (program_id);
CREATE INDEX IF NOT EXISTS idx_program_exercises_sequence
  ON program_exercises (program_id, sequence_index, id);

GRANT ALL PRIVILEGES ON TABLE exercise_programs TO postural;
GRANT ALL PRIVILEGES ON TABLE program_exercises TO postural;
GRANT USAGE, SELECT ON SEQUENCE program_exercises_id_seq TO postural;
