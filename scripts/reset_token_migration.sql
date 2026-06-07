-- =============================================================================
-- Reset Token Migration
-- =============================================================================
-- REQUIRES: PostgreSQL superuser (postural)
--
-- Run email_features.sql first if you haven't already.

ALTER TABLE password_reset_otps
  ADD COLUMN IF NOT EXISTS reset_token VARCHAR(64),
  ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_otp_reset_token
  ON password_reset_otps(email, reset_token)
  WHERE reset_token IS NOT NULL;
