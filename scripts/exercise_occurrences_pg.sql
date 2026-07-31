-- Scheduled occurrences for patient exercise assignments.
-- Run this in pgAdmin after patient_exercises_pg.sql and sessions_pg.sql.
--
-- An assignment in patient_exercises holds WHAT + the prescribed dose. This
-- table holds WHEN it is due: one row per (assignment, calendar day). A weekly
-- recurrence expands into many rows; a one-time assignment is a single row.
-- Per-day completion lives here (status), so the same exercise can be done on
-- one day and still be due the next — something the single-row assignment
-- status could never express.
--
-- 'missed' is NOT a stored status: it is derived at read time as
-- (due_date < today AND status <> 'completed'), so no scheduled job is needed
-- to flip stale rows.

CREATE TABLE IF NOT EXISTS exercise_occurrences (
  id                  SERIAL       PRIMARY KEY,
  patient_exercise_id INTEGER      NOT NULL REFERENCES patient_exercises(id) ON DELETE RESTRICT,
  due_date            DATE         NOT NULL,
  status              VARCHAR(20)  NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'in_progress', 'completed', 'pain_stopped')),
  completed_at        TIMESTAMPTZ,
  pain_stopped_at     TIMESTAMPTZ,
  prescription_snapshot         JSONB,
  prescription_snapshot_version INT,
  prescription_captured_at      TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  cancelled_by        VARCHAR(50)  REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (patient_exercise_id, due_date)
);

CREATE INDEX IF NOT EXISTS idx_occ_pe  ON exercise_occurrences (patient_exercise_id);
CREATE INDEX IF NOT EXISTS idx_occ_due ON exercise_occurrences (due_date);

-- Last day this occurrence can still be completed as a make-up (the day before
-- the assignment's next scheduled occurrence). An occurrence is only "missed"
-- once today passes makeup_until; for daily/consecutive schedules makeup_until
-- equals due_date (no make-up). Legacy single occurrences get due_date (no window).
ALTER TABLE exercise_occurrences ADD COLUMN IF NOT EXISTS makeup_until DATE;
ALTER TABLE exercise_occurrences ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE exercise_occurrences ADD COLUMN IF NOT EXISTS pain_stopped_at TIMESTAMPTZ;
ALTER TABLE exercise_occurrences ADD COLUMN IF NOT EXISTS prescription_snapshot JSONB;
ALTER TABLE exercise_occurrences ADD COLUMN IF NOT EXISTS prescription_snapshot_version INT;
ALTER TABLE exercise_occurrences ADD COLUMN IF NOT EXISTS prescription_captured_at TIMESTAMPTZ;
ALTER TABLE exercise_occurrences ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE exercise_occurrences ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(50)
  REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE exercise_occurrences DROP CONSTRAINT IF EXISTS exercise_occurrences_status_check;
ALTER TABLE exercise_occurrences
  ADD CONSTRAINT exercise_occurrences_status_check
  CHECK (status IN ('pending', 'in_progress', 'completed', 'pain_stopped'));

-- Defense in depth: prescriptions with schedule/session history cannot be
-- hard-deleted accidentally. Application removal uses archive/cancel fields.
ALTER TABLE exercise_occurrences
  DROP CONSTRAINT IF EXISTS exercise_occurrences_patient_exercise_id_fkey;
ALTER TABLE exercise_occurrences
  ADD CONSTRAINT exercise_occurrences_patient_exercise_id_fkey
  FOREIGN KEY (patient_exercise_id) REFERENCES patient_exercises(id) ON DELETE RESTRICT;

-- Link a session to the specific scheduled day it fulfilled. Kept NULL when a
-- patient trains on a day nothing was due (an extra/unscheduled session — extra
-- credit must not silently erase a missed day). Added here (not in
-- sessions_pg.sql) so the FK target exercise_occurrences already exists.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS occurrence_id INTEGER
  REFERENCES exercise_occurrences(id) ON DELETE SET NULL;

-- ── Backfill (idempotent) ─────────────────────────────────────────────────────
-- Give every pre-existing assignment a single occurrence on its assigned_date,
-- carrying the assignment's current status so historical progress is preserved.
INSERT INTO exercise_occurrences (patient_exercise_id, due_date, makeup_until, status)
SELECT pe.id, pe.assigned_date, pe.assigned_date, pe.status
FROM patient_exercises pe
ON CONFLICT (patient_exercise_id, due_date) DO UPDATE
  SET makeup_until = COALESCE(exercise_occurrences.makeup_until, EXCLUDED.makeup_until);

-- Defensive fill for any row created by an older copy of this script before
-- makeup_until was included in the legacy backfill insert.
UPDATE exercise_occurrences SET makeup_until = due_date WHERE makeup_until IS NULL;

-- Snapshot only still-actionable legacy occurrences. Completed/past evidence
-- remains explicitly context-unknown rather than receiving a fabricated
-- historical prescription.
UPDATE exercise_occurrences eo
SET prescription_snapshot = jsonb_build_object(
      'version', 2,
      'capturedAt', NOW(),
      'patientExerciseId', pe.id,
      'exerciseId', pe.exercise_id,
      'sets', pe.sets,
      'reps', pe.reps,
      'restSeconds', pe.rest_seconds,
      'holdSeconds', pe.hold_seconds,
      'sequenceIndex', pe.sequence_index,
      'prescribedSide', pe.prescribed_side,
      'resistance', jsonb_build_object(
        'type', pe.resistance_type,
        'value', pe.resistance_value,
        'unit', pe.resistance_unit,
        'label', pe.resistance_label
      ),
      'schedule', jsonb_build_object(
        'dueDate', eo.due_date,
        'makeupUntil', COALESCE(eo.makeup_until, eo.due_date)
      )
    ),
    prescription_snapshot_version = 2,
    prescription_captured_at = NOW()
FROM patient_exercises pe
WHERE pe.id = eo.patient_exercise_id
  AND eo.prescription_snapshot IS NULL
  AND eo.status = 'pending'
  AND eo.cancelled_at IS NULL
  AND COALESCE(eo.makeup_until, eo.due_date) >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date;

-- V1 snapshots predate explicit therapist sequencing. Only unstarted,
-- currently actionable rows may be upgraded; started and terminal snapshots
-- remain immutable historical evidence.
UPDATE exercise_occurrences eo
SET prescription_snapshot = eo.prescription_snapshot
      || jsonb_build_object(
           'version', 2,
           'capturedAt', NOW(),
           'sequenceIndex', pe.sequence_index
         ),
    prescription_snapshot_version = 2,
    prescription_captured_at = NOW()
FROM patient_exercises pe
WHERE pe.id = eo.patient_exercise_id
  AND eo.prescription_snapshot_version = 1
  AND eo.status = 'pending'
  AND eo.cancelled_at IS NULL
  AND COALESCE(eo.makeup_until, eo.due_date) >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date;

-- Link legacy sessions to their assignment's occurrence. Restricted to
-- assignments that have exactly one occurrence so the match is unambiguous;
-- only fills sessions not already linked. Safe to re-run.
UPDATE sessions s
SET occurrence_id = eo.id
FROM exercise_occurrences eo
WHERE eo.patient_exercise_id = s.patient_exercise_id
  AND s.occurrence_id IS NULL
  AND (SELECT COUNT(*) FROM exercise_occurrences x
       WHERE x.patient_exercise_id = s.patient_exercise_id) = 1;

GRANT ALL PRIVILEGES ON TABLE exercise_occurrences TO postural;
GRANT USAGE, SELECT ON SEQUENCE exercise_occurrences_id_seq TO postural;
