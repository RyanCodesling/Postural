-- Run as the users table owner to remove the unused therapist ID number.
-- No form ever filled it and the app no longer reads or writes it.
-- This permanently deletes the column and any value in it; take a backup first.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE users DROP COLUMN IF EXISTS therapist_id_num;
COMMIT;
