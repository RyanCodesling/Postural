-- Session persistence: completed exercise sessions, set summaries, and counted reps.
-- Run this in pgAdmin after patient_exercises_pg.sql.
--
-- Three tables:
--   sessions   — one row per exercise run (Start -> all-sets-complete or End).
--   set_events — one row per completed/partial set, including isometric holds.
--   rep_events — one row per counted rep, the queryable analytics surface.
--
-- Scope note: this is the analytics surface only. The per-frame raw-metric
-- ("raw_frames") retraining surface and the session-summary rollup are
-- intentionally NOT created here; they can be added later without touching
-- these tables.

CREATE TABLE IF NOT EXISTS sessions (
  id                       SERIAL       PRIMARY KEY,
  patient_id               VARCHAR(50)  NOT NULL REFERENCES users(id)              ON DELETE CASCADE,
  patient_exercise_id      INTEGER      NOT NULL REFERENCES patient_exercises(id)  ON DELETE CASCADE,
  -- Stored directly (in addition to being reachable via patient_exercise_id)
  -- so per-exercise queries don't need the join.
  exercise_id              VARCHAR(50)  NOT NULL REFERENCES exercises(id)          ON DELETE CASCADE,
  started_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at                 TIMESTAMPTZ,
  device_info              JSONB,
  capture_quality_summary  JSONB,
  notes                    TEXT,
  -- How the session ended; see the idempotent ALTER below for the values.
  end_reason               TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_patient ON sessions (patient_id, started_at DESC);

-- Safe to re-run: add the optional metadata columns to an existing sessions table.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_info             JSONB;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS capture_quality_summary JSONB;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS notes                   TEXT;
-- How the session ended: 'user' = End button pressed, 'completed' = all sets
-- finished, 'superseded' = auto-closed when a newer session for the same
-- assignment started, NULL = still open (tab close / navigation / exit).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS end_reason              TEXT;

CREATE TABLE IF NOT EXISTS set_events (
  id              SERIAL            PRIMARY KEY,
  session_id      INTEGER           NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  set_index       INT               NOT NULL,
  exercise_kind   TEXT              NOT NULL CHECK (exercise_kind IN ('dynamic', 'isometric')),
  target_reps     INT               NOT NULL DEFAULT 0,
  left_reps       INT               NOT NULL DEFAULT 0,
  right_reps      INT               NOT NULL DEFAULT 0,
  paired_reps     INT               NOT NULL DEFAULT 0,
  target_hold_ms  INT               NOT NULL DEFAULT 0,
  paired_hold_ms  INT               NOT NULL DEFAULT 0,
  duration_ms     INT               NOT NULL,
  terminated_by   TEXT              NOT NULL CHECK (terminated_by IN ('min_reached', 'user', 'capture_lost', 'stall')),
  asymmetry_index DOUBLE PRECISION  NOT NULL DEFAULT 0,
  start_ts        TIMESTAMPTZ       NOT NULL,
  end_ts          TIMESTAMPTZ       NOT NULL,
  -- Set-level hold-quality summary for isometric holds (per-arm steadiness,
  -- in-band/out time, droop slope, compensation score). Null for dynamic sets.
  hold_quality    JSONB
);

CREATE INDEX IF NOT EXISTS idx_set_events_session ON set_events (session_id, set_index);

-- Safe to re-run: adds the hold-quality JSONB to an existing set_events table.
ALTER TABLE set_events ADD COLUMN IF NOT EXISTS hold_quality JSONB;

CREATE TABLE IF NOT EXISTS rep_events (
  id              SERIAL            PRIMARY KEY,
  session_id      INTEGER           NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  -- Session-wide sequential index (1..N across all sides/sets of the session).
  rep_index       INT               NOT NULL,
  -- Which set (1-based) this rep belongs to. Lets set boundaries be recovered
  -- without a separate sets table.
  set_index       INT               NOT NULL,
  side            TEXT              NOT NULL CHECK (side IN ('left', 'right', 'both', 'bidirectional')),
  -- Peak of the primary metric for the rep. Named peak_value (not
  -- peak_angle_deg) because not every exercise's primary metric is in degrees —
  -- e.g. ex_007 (Overhead Shoulder Press) uses trunk-length-normalized units.
  peak_value      DOUBLE PRECISION  NOT NULL,
  target_rom      DOUBLE PRECISION  NOT NULL,
  time_to_peak_ms INT               NOT NULL,
  hold_ms         INT               NOT NULL,
  descent_ms      INT               NOT NULL,
  total_ms        INT               NOT NULL,
  classification  TEXT              NOT NULL CHECK (classification IN ('complete', 'partial')),
  -- Reserved for a per-rep compensation snapshot; left null for now.
  compensations   JSONB,
  start_ts        TIMESTAMPTZ       NOT NULL,
  end_ts          TIMESTAMPTZ       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rep_events_session ON rep_events (session_id, rep_index);

GRANT ALL PRIVILEGES ON TABLE sessions   TO postural;
GRANT ALL PRIVILEGES ON TABLE set_events TO postural;
GRANT ALL PRIVILEGES ON TABLE rep_events TO postural;
GRANT USAGE, SELECT ON SEQUENCE sessions_id_seq   TO postural;
GRANT USAGE, SELECT ON SEQUENCE set_events_id_seq TO postural;
GRANT USAGE, SELECT ON SEQUENCE rep_events_id_seq TO postural;
