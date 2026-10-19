-- Records which scheduled emails have gone out, so each recipient gets at most one
-- of each kind per day (therapist_id holds the recipient: a therapist or patient):
--   completed / missed  daily summaries of a finished Manila day (the day summarised)
--   partial             therapists: patients who did only part of a day's exercises
--   due_tomorrow        patients: the evening reminder of the next day's exercises
--   due_today           patients: the morning reminder of that day's exercises
-- Run as the database owner after user_credentials_pg.sql. Safe to rerun: an
-- existing table gets the newer kinds.

CREATE TABLE IF NOT EXISTS notification_email_digests (
  therapist_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         VARCHAR(20) NOT NULL,
  day          DATE        NOT NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (therapist_id, kind, day)
);

ALTER TABLE notification_email_digests DROP CONSTRAINT IF EXISTS notification_email_digests_kind_check;
ALTER TABLE notification_email_digests
  ADD CONSTRAINT notification_email_digests_kind_check
  CHECK (kind IN ('completed', 'missed', 'partial', 'due_tomorrow', 'due_today'));

GRANT SELECT, INSERT, DELETE ON TABLE notification_email_digests TO postural;
