-- One-time replacement of the existing system administrator's email.
-- Run as the database owner after a backup. Do not rerun the user seed to do this.
-- The account ID, password, roles, history and all other columns are preserved.
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  existing_email text;
  existing_role text;
BEGIN
  SELECT email, role INTO existing_email, existing_role
    FROM users WHERE id = 'admin_001' FOR UPDATE;
  IF NOT FOUND OR existing_role <> 'admin' THEN
    RAISE EXCEPTION 'Expected admin_001 with the admin role; nothing changed';
  END IF;
  -- Accept either former system address when updating an existing deployment.
  IF lower(existing_email) NOT IN (
    'accbpostural.noreply@gmail.com', 'accbacoor.postural@gmail.com',
    'accbacoor.noreply@gmail.com'
  ) THEN
    RAISE EXCEPTION 'Administrator email differs from the expected old or replacement address; nothing changed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM users
    WHERE lower(email) = 'accbpostural.noreply@gmail.com' AND id <> 'admin_001'
  ) THEN
    RAISE EXCEPTION 'Replacement email belongs to another user; nothing changed';
  END IF;
  UPDATE users SET email = 'accbpostural.noreply@gmail.com'
    WHERE id = 'admin_001' AND email IS DISTINCT FROM 'accbpostural.noreply@gmail.com';
END $$;

SELECT id, email, role FROM users WHERE id = 'admin_001';
COMMIT;
