-- Exercise programs for therapists.
-- Run after exercises_pg.sql.

CREATE TABLE IF NOT EXISTS exercise_programs (
  id           VARCHAR(50)  PRIMARY KEY,
  therapist_id VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  -- Per-side target hold duration (seconds) for isometric program entries.
  -- Ignored by dynamic exercises.
  hold_seconds INT          NOT NULL DEFAULT 30
);

ALTER TABLE program_exercises ADD COLUMN IF NOT EXISTS rest_seconds INT NOT NULL DEFAULT 60;
ALTER TABLE program_exercises ADD COLUMN IF NOT EXISTS hold_seconds INT NOT NULL DEFAULT 30;

CREATE INDEX IF NOT EXISTS idx_ep_therapist_id ON exercise_programs (therapist_id);
CREATE INDEX IF NOT EXISTS idx_pe_program_id   ON program_exercises  (program_id);

GRANT ALL PRIVILEGES ON TABLE exercise_programs TO postural;
GRANT ALL PRIVILEGES ON TABLE program_exercises TO postural;
GRANT USAGE, SELECT ON SEQUENCE program_exercises_id_seq TO postural;
