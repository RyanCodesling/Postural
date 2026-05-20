-- Patient-therapist assignment.
-- The therapist_id column on the users table is the assignment record.
-- A patient row stores the id of their assigned therapist (e.g. therapist_001).
-- Run this in pgAdmin after user_credentials_pg.sql.

-- Ensure therapist_id column exists (safe to re-run)
ALTER TABLE users ADD COLUMN IF NOT EXISTS therapist_id VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_therapist_id ON users (therapist_id);

-- Add FK constraint only if it does not already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_therapist_id'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_therapist_id
      FOREIGN KEY (therapist_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Query to view all current patient-therapist assignments:
-- SELECT
--   p.id        AS patient_id,
--   p.name      AS patient_name,
--   t.id        AS therapist_id,
--   t.name      AS therapist_name
-- FROM users p
-- JOIN users t ON t.id = p.therapist_id
-- WHERE p.role = 'patient'
-- ORDER BY t.name, p.name;
