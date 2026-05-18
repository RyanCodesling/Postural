-- Exercise templates for therapists.
-- Run after exercises_pg.sql.

CREATE TABLE IF NOT EXISTS exercise_templates (
  id           VARCHAR(50)  PRIMARY KEY,
  therapist_id VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS template_exercises (
  id           SERIAL       PRIMARY KEY,
  template_id  VARCHAR(50)  NOT NULL REFERENCES exercise_templates(id) ON DELETE CASCADE,
  exercise_id  VARCHAR(50)  REFERENCES exercises(id) ON DELETE SET NULL,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  is_custom    BOOLEAN      NOT NULL DEFAULT FALSE,
  sets         INT,
  reps         INT
);

CREATE INDEX IF NOT EXISTS idx_et_therapist_id ON exercise_templates (therapist_id);
CREATE INDEX IF NOT EXISTS idx_te_template_id  ON template_exercises  (template_id);

GRANT ALL PRIVILEGES ON TABLE exercise_templates TO postural;
GRANT ALL PRIVILEGES ON TABLE template_exercises TO postural;
GRANT USAGE, SELECT ON SEQUENCE template_exercises_id_seq TO postural;
