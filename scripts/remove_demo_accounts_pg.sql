-- Remove the hardcoded demo accounts (PostgreSQL)
-- pgAdmin 4: Open Query Tool connected to the "postural" database, then run this file
-- once on an existing database, after rerunning user_credentials_pg.sql (it fills in
-- users.email_hash, which identifies the two former seeded accounts below).
--
-- Deletes, with everything recorded for them:
--   - patient_001 (patient@example.com) and therapist_001 (therapist@clinic.com),
--     formerly seeded by user_credentials_pg.sql
--   - the demo_* patients and demo therapist formerly added by the demo seeder
-- The admin account (admin_001) is kept. Patients still assigned to a removed therapist
-- become unassigned. Everything runs in one transaction: if any record cannot be
-- deleted (for example a real patient prescribed a removed therapist's custom
-- exercise), nothing is deleted.

BEGIN;

CREATE TEMP TABLE removed_demo_accounts ON COMMIT DROP AS
SELECT id, role
FROM users
WHERE (id = 'patient_001'
       AND email_hash = encode(digest('patient@example.com', 'sha256'), 'hex'))
   OR (id = 'therapist_001'
       AND email_hash = encode(digest('therapist@clinic.com', 'sha256'), 'hex'))
   OR (id LIKE 'demo\_%' AND role IN ('patient', 'therapist'));

-- Sessions cascade to their set/rep events, raw frames and reviews.
DELETE FROM sessions
WHERE patient_id IN (SELECT id FROM removed_demo_accounts);

DELETE FROM session_reviews
WHERE therapist_id IN (SELECT id FROM removed_demo_accounts);

DELETE FROM exercise_occurrences
WHERE patient_exercise_id IN (
  SELECT id FROM patient_exercises
  WHERE patient_id IN (SELECT id FROM removed_demo_accounts)
);

DELETE FROM patient_exercises
WHERE patient_id IN (SELECT id FROM removed_demo_accounts);

DELETE FROM exercise_programs
WHERE therapist_id IN (SELECT id FROM removed_demo_accounts);

DELETE FROM exercises
WHERE owner_therapist_id IN (SELECT id FROM removed_demo_accounts);

UPDATE users
SET therapist_id = NULL
WHERE therapist_id IN (SELECT id FROM removed_demo_accounts WHERE role = 'therapist')
  AND id NOT IN (SELECT id FROM removed_demo_accounts);

-- Patients before therapists (users.therapist_id is ON DELETE RESTRICT). Notifications,
-- password reset codes, attachments and email digest claims cascade.
DELETE FROM users
WHERE id IN (SELECT id FROM removed_demo_accounts WHERE role = 'patient');

DELETE FROM users
WHERE id IN (SELECT id FROM removed_demo_accounts WHERE role = 'therapist');

COMMIT;
