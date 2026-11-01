-- Recently Deleted: run as the database owner after patient_image_attachments_pg.sql,
-- exercises_pg.sql and sessions_pg.sql. Additive only; safe to rerun.
--
-- A patient's deleted session video, an attached file deleted by the admin or a
-- therapist, and a custom exercise's removed or replaced guide video are kept
-- here until an admin restores them or deletes them for good. Until this runs,
-- the app refuses to delete session videos and attached files rather than
-- losing them, and keeps replaced guide video files on disk.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE patient_image_attachments
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS deleted_items (
  id             SERIAL       PRIMARY KEY,
  kind           VARCHAR(20)  NOT NULL CHECK (kind IN ('session_video', 'patient_file', 'exercise_video')),
  patient_id     VARCHAR(50)  REFERENCES users(id) ON DELETE CASCADE,
  session_id     INTEGER      REFERENCES sessions(id) ON DELETE CASCADE,
  attachment_id  INTEGER      REFERENCES patient_image_attachments(id) ON DELETE CASCADE,
  exercise_id    VARCHAR(50)  REFERENCES exercises(id) ON DELETE CASCADE,
  label          VARCHAR(255) NOT NULL,
  -- session_video: { folder, startedAt }; exercise_video: { source, mimeType, fileName } or { source, youtubeVideoId }
  details        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  deleted_by     VARCHAR(50)  REFERENCES users(id) ON DELETE SET NULL,
  deleted_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deleted_items_deleted_at_idx ON deleted_items (deleted_at DESC);

GRANT ALL PRIVILEGES ON TABLE deleted_items TO postural;
GRANT USAGE, SELECT ON SEQUENCE deleted_items_id_seq TO postural;

COMMIT;
