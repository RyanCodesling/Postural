-- Exercises table for the admin dashboard.
-- Run this in pgAdmin after alter_users_pg.sql.

CREATE TABLE IF NOT EXISTS exercises (
  id                   VARCHAR(50)  PRIMARY KEY,
  name                 VARCHAR(255) NOT NULL,
  description          TEXT         NOT NULL,
  is_custom            BOOLEAN      NOT NULL DEFAULT FALSE,
  owner_therapist_id   VARCHAR(50)  REFERENCES users(id) ON DELETE RESTRICT,
  monitoring_mode      VARCHAR(20)  NOT NULL DEFAULT 'camera'
                                     CHECK (monitoring_mode IN ('camera', 'manual')),
  archived_at          TIMESTAMPTZ,
  archived_by          VARCHAR(50)  REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- Safe to re-run on existing tables
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS owner_therapist_id VARCHAR(50)
  REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS monitoring_mode VARCHAR(20) NOT NULL DEFAULT 'camera';
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS archived_by VARCHAR(50)
  REFERENCES users(id) ON DELETE SET NULL;

-- Ownership is durable history. Archive the therapist account while any custom
-- exercise remains attributed to it; do not silently erase ownership.
ALTER TABLE exercises DROP CONSTRAINT IF EXISTS exercises_owner_therapist_id_fkey;
ALTER TABLE exercises
  ADD CONSTRAINT exercises_owner_therapist_id_fkey
  FOREIGN KEY (owner_therapist_id) REFERENCES users(id) ON DELETE RESTRICT;

DO $$
BEGIN
  ALTER TABLE exercises
    ADD CONSTRAINT exercises_monitoring_mode_check
    CHECK (monitoring_mode IN ('camera', 'manual'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Custom exercises are deliberately manual-only until a validated camera
-- definition (metric, mode, thresholds, and tests) exists in the registry.
UPDATE exercises
SET monitoring_mode = 'manual'
WHERE is_custom = TRUE AND monitoring_mode <> 'manual';

CREATE INDEX IF NOT EXISTS idx_exercises_name ON exercises (name);
CREATE INDEX IF NOT EXISTS idx_exercises_owner ON exercises (owner_therapist_id)
  WHERE owner_therapist_id IS NOT NULL;

INSERT INTO exercises (id, name, description) VALUES
  ('ex_001', 'Lateral Arm Raises',    'Raise arms to the side at shoulder height. Improves shoulder strength and posture.'),
  ('ex_002', 'Overhead Arm Raises',   'Raise arms straight up overhead. Strengthens shoulders and improves upper back flexibility.'),
  ('ex_003', 'Shoulder Shrugs',       'Lift shoulders towards ears and release. Relieves tension and strengthens trapezius.'),
  ('ex_004', 'Neck Lateral Flexion',  'Bend neck to each side gently. Improves neck flexibility and reduces stiffness.'),
  ('ex_005', 'Standing Side Bends',   'Bend torso to the side while standing. Strengthens obliques and improves spinal mobility.'),
  ('ex_006', 'Arm Abduction at 90°',  'Raise arms to 90 degrees from body. Targets shoulder stability and strength.')
ON CONFLICT (id) DO NOTHING;

-- EX_SWAP 2026-05-21: ex_007/ex_008 replace deprecated ex_002/ex_003.
-- Deprecated rows stay for audit/history and are filtered from active UI.
-- Use DO UPDATE here so rerunning the seed refreshes name/description text.
INSERT INTO exercises (id, name, description) VALUES
  ('ex_007', 'Overhead Shoulder Press', 'Press both arms straight up overhead from shoulder height. Bilateral, frontal-plane (front-camera-clean).'),
  ('ex_008', 'Wall Angels',             'Slide arms up a wall from a W-position (elbows at shoulder height) to a Y-position (arms extended overhead), keeping back and arms against the wall.')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description;

GRANT ALL PRIVILEGES ON TABLE exercises TO postural;
