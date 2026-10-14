-- Records which daily summary emails (therapist_id holds the recipient: a therapist or patient) (completed / missed exercises)
-- have been sent, so each therapist gets at most one of each kind per day.
-- Run as the database owner after user_credentials_pg.sql.

CREATE TABLE IF NOT EXISTS notification_email_digests (
  therapist_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         VARCHAR(20) NOT NULL CHECK (kind IN ('completed', 'missed')),
  day          DATE        NOT NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (therapist_id, kind, day)
);

GRANT SELECT, INSERT, DELETE ON TABLE notification_email_digests TO postural;
