-- Postural Users Database Setup (PostgreSQL)
-- pgAdmin 4: Open Query Tool connected to the "postural" database, then run this file.

CREATE TABLE IF NOT EXISTS users (
  id                VARCHAR(50)  PRIMARY KEY,
  email             VARCHAR(255) NOT NULL UNIQUE,
  password          VARCHAR(255) NOT NULL,
  name              VARCHAR(255) NOT NULL,
  role              VARCHAR(20)  NOT NULL CHECK (role IN ('patient', 'therapist', 'admin')),
  "clinicId"        VARCHAR(50),
  diagnosis         TEXT,
  prescription      TEXT,
  condition         TEXT,
  created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
); 

CREATE INDEX IF NOT EXISTS idx_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_role ON users (role);

-- Add missing columns safely
ALTER TABLE users ADD COLUMN IF NOT EXISTS password          VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name        VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS middle_name       VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name         VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS therapist_id      VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth     DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS age               INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender            VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS specialty         VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS diagnosis         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS prescription      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS condition         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived       BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at       TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_therapist_id ON users (therapist_id);
CREATE INDEX IF NOT EXISTS idx_is_archived  ON users (is_archived);


INSERT INTO users (id, email, password, name, first_name, last_name, role, "clinicId") VALUES
('patient_001',   'patient@example.com',           'patient123',   'John Patient',    'John',  'Patient',   'patient',   NULL),
('therapist_001', 'therapist@clinic.com',          'therapist123', 'Sarah Therapist', 'Sarah', 'Therapist', 'therapist', 'CLINIC_001'),
('admin_001',     'accbpostural.noreply@gmail.com', 'admin123',     'Admin User',      'Admin', 'User',      'admin',     NULL)
ON CONFLICT (id) DO NOTHING;

-- Sync admin email to the system address on re-runs
UPDATE users SET email = 'accbpostural.noreply@gmail.com' WHERE id = 'admin_001';

GRANT ALL PRIVILEGES ON TABLE users TO postural;


-- Insert demo credentials
-- Local demo login reference only; do not use these credentials in production.
-- Seeded below:
--   Patient:   patient@example.com / patient123
--   Therapist: therapist@clinic.com / therapist123
--   Admin:     accbpostural.noreply@gmail.com / admin123
-- Added by `cd web` then `npm run seed:demo:accounts` (not inserted by this SQL):
--   Therapist: demo.therapist@example.com / demo123
--   Patients:  demo.maria@example.com, demo.liam@example.com,
--              demo.aisha@example.com, demo.tomas@example.com,
--              demo.noor@example.com, demo.ethan@example.com,
--              demo.grace@example.com (all use demo123)