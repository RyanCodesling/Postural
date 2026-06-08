-- In-app notifications schema.
-- Run this in pgAdmin or via psql.

CREATE TABLE IF NOT EXISTS notifications (
  id            SERIAL       PRIMARY KEY,
  user_id       VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         VARCHAR(255) NOT NULL,
  message       TEXT         NOT NULL,
  type          VARCHAR(50)  NOT NULL,
  occurrence_id INTEGER      REFERENCES exercise_occurrences(id) ON DELETE CASCADE,
  is_read       BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  is_deleted    BOOLEAN      NOT NULL DEFAULT FALSE
);

-- Ensure the is_deleted column exists for databases that already had notifications table
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);

GRANT ALL PRIVILEGES ON TABLE notifications TO postural;
GRANT USAGE, SELECT ON SEQUENCE notifications_id_seq TO postural;
