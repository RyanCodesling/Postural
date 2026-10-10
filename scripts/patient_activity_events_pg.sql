-- Patient sign-in and therapist assignment activity used by therapist dashboards.
-- Run as the database owner after user_credentials_pg.sql.

CREATE TABLE IF NOT EXISTS patient_activity_events (
  id           BIGSERIAL PRIMARY KEY,
  patient_id   VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  therapist_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type   VARCHAR(20) NOT NULL CHECK (event_type IN ('login', 'logout', 'assigned', 'unassigned')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_activity_events_therapist_created
  ON patient_activity_events (therapist_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_activity_events_patient_created
  ON patient_activity_events (patient_id, created_at DESC);

GRANT ALL PRIVILEGES ON TABLE patient_activity_events TO postural;
GRANT USAGE, SELECT ON SEQUENCE patient_activity_events_id_seq TO postural;