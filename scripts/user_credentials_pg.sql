-- Postural Users Database Setup (PostgreSQL)
-- pgAdmin 4: Open Query Tool connected to the "postural" database, then run this file.

CREATE TABLE IF NOT EXISTS users (
  id                VARCHAR(50)  PRIMARY KEY,
  email             TEXT         NOT NULL UNIQUE,
  email_hash        CHAR(64),
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
ALTER TABLE users ADD COLUMN IF NOT EXISTS therapist_id_num  VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS specialty         VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS diagnosis         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS prescription      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS condition         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived       BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at       TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_therapist_id ON users (therapist_id);
CREATE INDEX IF NOT EXISTS idx_is_archived  ON users (is_archived);


-- Passwords are stored only as bcrypt hashes (pgcrypto's 'bf' produces the $2a$ format bcryptjs verifies).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Email addresses are never stored readable. email_hash is the SHA-256 (hex) of the
-- lowercased, trimmed address and is what sign-in and duplicate checks look up. email
-- holds the address encrypted with AES-256-GCM ('enc:v1:' prefix) under EMAIL_ENCRYPTION_KEY;
-- the app encrypts any readable address left here (such as the admin row below) when it starts.
ALTER TABLE users ALTER COLUMN email TYPE TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_hash CHAR(64);
DROP INDEX IF EXISTS idx_email;
UPDATE users
SET email_hash = encode(digest(lower(trim(email)), 'sha256'), 'hex')
WHERE email NOT LIKE 'enc:v1:%'
  AND email_hash IS DISTINCT FROM encode(digest(lower(trim(email)), 'sha256'), 'hex');
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash ON users (email_hash);

-- The only seeded account is the administrator. Create patients and therapists from the admin dashboard.
INSERT INTO users (id, email, email_hash, password, name, first_name, last_name, role, "clinicId") VALUES
('admin_001', 'accbpostural.noreply@gmail.com',
 encode(digest('accbpostural.noreply@gmail.com', 'sha256'), 'hex'),
 crypt('admin123', gen_salt('bf', 10)), 'Admin User', 'Admin', 'User', 'admin', NULL)
ON CONFLICT (id) DO NOTHING;

-- Hash any password still stored as plaintext (earlier seeds); the account keeps the same password.
-- The app no longer accepts plaintext passwords, so rerun this file on existing databases.
UPDATE users
SET password = crypt(password, gen_salt('bf', 10))
WHERE password !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$';

-- Sync admin email to the system address on re-runs (left alone while it already matches,
-- so the encrypted value is kept)
UPDATE users
SET email      = 'accbpostural.noreply@gmail.com',
    email_hash = encode(digest('accbpostural.noreply@gmail.com', 'sha256'), 'hex')
WHERE id = 'admin_001'
  AND email_hash IS DISTINCT FROM encode(digest('accbpostural.noreply@gmail.com', 'sha256'), 'hex');

GRANT ALL PRIVILEGES ON TABLE users TO postural;


-- Seeded login (local demonstration only; change it at first sign-in and never use it in production):
--   Admin: accbpostural.noreply@gmail.com / admin123
-- The former demo patient and therapist (patient_001, therapist_001) and the demo_* accounts
-- are no longer seeded; scripts/remove_demo_accounts_pg.sql deletes them from existing databases.
