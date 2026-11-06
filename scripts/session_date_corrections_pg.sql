-- Optional, explicit corrections of finished session dates in demo mode.
-- Run as the database owner after exercise_occurrences_pg.sql. No existing rows are changed.
-- Real correction time and the exact before/after instants are retained.
BEGIN;

CREATE TABLE IF NOT EXISTS session_date_corrections (
  id               BIGSERIAL PRIMARY KEY,
  session_id       INTEGER NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  corrected_by     VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  old_occurrence_id INTEGER NOT NULL REFERENCES exercise_occurrences(id) ON DELETE RESTRICT,
  new_occurrence_id INTEGER NOT NULL REFERENCES exercise_occurrences(id) ON DELETE RESTRICT,
  source_before    JSONB NOT NULL,
  source_after     JSONB NOT NULL,
  destination_before JSONB NOT NULL,
  destination_after  JSONB NOT NULL,
  old_started_at   TIMESTAMPTZ NOT NULL,
  old_ended_at     TIMESTAMPTZ NOT NULL,
  new_started_at   TIMESTAMPTZ NOT NULL,
  new_ended_at     TIMESTAMPTZ NOT NULL,
  reason           TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  corrected_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (old_ended_at >= old_started_at),
  CHECK (new_ended_at >= new_started_at),
  CHECK (new_ended_at - new_started_at = old_ended_at - old_started_at)
);

CREATE INDEX IF NOT EXISTS idx_session_date_corrections_session
  ON session_date_corrections (session_id, id DESC);

-- The application may append/read history, never rewrite or delete it.
REVOKE ALL ON TABLE session_date_corrections FROM PUBLIC;
REVOKE ALL ON TABLE session_date_corrections FROM postural;
GRANT SELECT, INSERT ON TABLE session_date_corrections TO postural;
GRANT USAGE, SELECT ON SEQUENCE session_date_corrections_id_seq TO postural;

COMMIT;
