-- Demo-only application clock offset. Authentication and password expiry always
-- use the real server clock.
-- Run as the database owner after user_credentials_pg.sql.

CREATE TABLE IF NOT EXISTS demo_clock_settings (
  id          SMALLINT PRIMARY KEY CHECK (id = 1),
  offset_ms   BIGINT NOT NULL DEFAULT 0,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by  VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Legacy offsets remain ignored until an admin explicitly enables the tools.
-- Re-running setup preserves an existing admin choice.
ALTER TABLE demo_clock_settings ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO demo_clock_settings (id, offset_ms)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON TABLE demo_clock_settings TO postural;
