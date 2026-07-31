\set ON_ERROR_STOP on

-- Read-only post-deployment verifier for the occurrence-driven patient
-- exercise workflow. Run as the ordinary application role after the three
-- owner migrations have completed. It checks the active search-path schema,
-- which is normally public and is pg_temp during the rollback rehearsal.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'program_exercises'
       AND column_name = 'sequence_index'
       AND data_type = 'integer'
       AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'program_exercises.sequence_index is missing or nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'patient_exercises'
       AND column_name = 'sequence_index'
       AND data_type = 'integer'
       AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'patient_exercises.sequence_index is missing or nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = current_schema()
       AND t.relname = 'program_exercises'
       AND c.conname = 'program_exercises_sequence_index_check'
       AND c.contype = 'c'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = current_schema()
       AND t.relname = 'patient_exercises'
       AND c.conname = 'patient_exercises_sequence_index_check'
       AND c.contype = 'c'
  ) THEN
    RAISE EXCEPTION 'positive sequence check constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = current_schema()
       AND tablename = 'program_exercises'
       AND indexname = 'idx_program_exercises_sequence'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = current_schema()
       AND tablename = 'patient_exercises'
       AND indexname = 'idx_patient_exercises_sequence'
  ) THEN
    RAISE EXCEPTION 'workflow sequence index is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM program_exercises WHERE sequence_index IS NULL OR sequence_index < 1
  ) OR EXISTS (
    SELECT 1 FROM patient_exercises WHERE sequence_index IS NULL OR sequence_index < 1
  ) THEN
    RAISE EXCEPTION 'invalid workflow sequence value exists';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM exercise_occurrences eo
     WHERE eo.status = 'pending'
       AND eo.cancelled_at IS NULL
       AND COALESCE(eo.makeup_until, eo.due_date) >=
           (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
       AND (
         eo.prescription_snapshot_version IS DISTINCT FROM 2
         OR NOT (eo.prescription_snapshot ? 'sequenceIndex')
         OR (eo.prescription_snapshot ->> 'sequenceIndex')::int < 1
       )
  ) THEN
    RAISE EXCEPTION 'an actionable pending occurrence lacks a valid V2 sequence snapshot';
  END IF;
END
$$;

SELECT
  (SELECT COUNT(*) FROM program_exercises) AS program_exercises,
  (SELECT COUNT(*) FROM patient_exercises) AS prescriptions,
  (SELECT COUNT(*) FROM exercise_occurrences) AS occurrences,
  (SELECT COUNT(*) FROM sessions) AS sessions,
  (SELECT COUNT(*) FROM exercise_occurrences
    WHERE status = 'pending' AND cancelled_at IS NULL) AS pending_occurrences,
  (SELECT COUNT(*) FROM exercise_occurrences
    WHERE status = 'in_progress' AND cancelled_at IS NULL) AS in_progress_occurrences,
  (SELECT COUNT(*) FROM exercise_occurrences
    WHERE status = 'completed' AND cancelled_at IS NULL) AS completed_occurrences;

SELECT
  status,
  COALESCE(prescription_snapshot_version, 0) AS snapshot_version,
  COUNT(*) AS occurrence_count
FROM exercise_occurrences
WHERE cancelled_at IS NULL
GROUP BY status, COALESCE(prescription_snapshot_version, 0)
ORDER BY status, snapshot_version;
