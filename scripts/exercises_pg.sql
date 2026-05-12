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

GRANT ALL PRIVILEGES ON TABLE exercises TO postural;
