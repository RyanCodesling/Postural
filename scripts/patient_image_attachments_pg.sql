-- Patient attachments stored in PostgreSQL.
-- Run as the database owner after user_credentials_pg.sql.

CREATE TABLE IF NOT EXISTS patient_image_attachments (
  id          SERIAL PRIMARY KEY,
  patient_id  VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name   VARCHAR(255) NOT NULL,
  mime_type   VARCHAR(100) NOT NULL,
  data        BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE patient_image_attachments
  ALTER COLUMN mime_type TYPE VARCHAR(100);
ALTER TABLE patient_image_attachments
  DROP CONSTRAINT IF EXISTS patient_image_attachments_mime_type_check;
ALTER TABLE patient_image_attachments
  ADD CONSTRAINT patient_image_attachments_mime_type_check CHECK (mime_type IN (
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/rtf', 'text/plain'
  ));

CREATE INDEX IF NOT EXISTS idx_patient_image_attachments_patient
  ON patient_image_attachments (patient_id, created_at DESC);

GRANT ALL PRIVILEGES ON TABLE patient_image_attachments TO postural;
GRANT USAGE, SELECT ON SEQUENCE patient_image_attachments_id_seq TO postural;