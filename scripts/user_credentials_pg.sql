-- Postural Mock Users Database Setup (PostgreSQL)
-- pgAdmin 4: Open Query Tool connected to the "postgres" database, then run this file.

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(50) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('patient', 'therapist', 'admin')),
  "clinicId" VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_role ON users (role);

-- Insert mock credentials
INSERT INTO users (id, email, password, name, role, "clinicId") VALUES
('patient_001', 'patient@example.com', 'patient123', 'John Patient', 'patient', NULL),
('therapist_001', 'therapist@clinic.com', 'therapist123', 'Sarah Therapist', 'therapist', 'CLINIC_001'),
('admin_001', 'admin@postural.com', 'admin123', 'Admin User', 'admin', NULL)
ON CONFLICT (id) DO NOTHING;

GRANT ALL PRIVILEGES ON TABLE users TO postural;
