-- Email features migration

-- 1. Add must_change_password column to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;

-- 2. Set existing users to FALSE (safe default)
UPDATE users SET must_change_password = FALSE WHERE must_change_password IS NULL;

-- 3. Grant schema permissions to postural user
GRANT CREATE ON SCHEMA public TO postural;
GRANT ALL ON SCHEMA public TO postural;

-- 4. Create password_reset_otps table
CREATE TABLE IF NOT EXISTS password_reset_otps (
  id         SERIAL PRIMARY KEY,
  user_id    VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email      VARCHAR(255) NOT NULL,
  otp        VARCHAR(6) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Index for fast OTP lookups by email
CREATE INDEX IF NOT EXISTS idx_otp_email ON password_reset_otps(email, used);

-- 6. Grant table and sequence permissions to postural user
GRANT ALL ON TABLE password_reset_otps TO postural;
GRANT USAGE, SELECT ON SEQUENCE password_reset_otps_id_seq TO postural;
