-- Run as the users table owner to show who is online on the admin dashboard.
-- Additive only: no account seeding, grants, row changes, or history changes.
-- last_seen_at is refreshed while a signed-in page is open; signed_out_at is set by Log Out.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_out_at TIMESTAMPTZ;
COMMIT;
