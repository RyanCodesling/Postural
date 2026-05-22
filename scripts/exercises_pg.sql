-- Exercises table for the admin dashboard.
-- Run this in pgAdmin after alter_users_pg.sql.

CREATE TABLE IF NOT EXISTS exercises (
  id          VARCHAR(50)  PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT         NOT NULL,
  is_custom   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- Safe to re-run on existing tables
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_exercises_name ON exercises (name);

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
  ('ex_007', 'Overhead Shoulder Press', 'Press both arms straight up overhead from shoulder height. Bilateral, frontal-plane (front-camera-clean). Replaces the deprecated ex_002 Overhead Arm Raises.'),
  ('ex_008', 'Wall Angels',             'Slide arms up a wall from a W-position (elbows at shoulder height) to a Y-position (arms extended overhead), keeping back and arms against the wall. Replaces the deprecated ex_003 Shoulder Shrugs.')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description;

GRANT ALL PRIVILEGES ON TABLE exercises TO postural;
