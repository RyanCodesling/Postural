-- Run as the users table owner when enabling the optional clinical profile fields.
-- Additive only: no account seeding, grants, row changes, or history changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS diagnosis TEXT,
  ADD COLUMN IF NOT EXISTS prescription TEXT,
  ADD COLUMN IF NOT EXISTS condition TEXT;
COMMIT;
