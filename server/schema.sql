CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('pm_to_dev', 'dev_to_pm')),
  rater_id TEXT NOT NULL,
  ratee_id TEXT NOT NULL,
  rater_email TEXT NOT NULL,
  ratee_email TEXT NOT NULL DEFAULT '',
  saved_by_email TEXT NOT NULL,
  scores JSONB NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_task_id_direction_key;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_task_id_direction_rater_id_ratee_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_slot_unique ON reviews (task_id, direction, rater_id, ratee_id);

CREATE INDEX IF NOT EXISTS reviews_saved_by_email_idx ON reviews (saved_by_email);
CREATE INDEX IF NOT EXISTS reviews_rater_email_idx ON reviews (rater_email);
CREATE INDEX IF NOT EXISTS reviews_ratee_email_idx ON reviews (ratee_email);
CREATE INDEX IF NOT EXISTS reviews_task_id_idx ON reviews (task_id);

CREATE TABLE IF NOT EXISTS tw_people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tw_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tw_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  dev_id TEXT NOT NULL,
  pm_id TEXT NOT NULL,
  dev_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  pm_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  assignee_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tw_tasks_project_id_idx ON tw_tasks (project_id);
CREATE INDEX IF NOT EXISTS tw_tasks_active_idx ON tw_tasks (active);

CREATE TABLE IF NOT EXISTS sync_state (
  id TEXT PRIMARY KEY,
  running_since TIMESTAMPTZ,
  last_started_at TIMESTAMPTZ,
  last_finished_at TIMESTAMPTZ,
  last_status TEXT NOT NULL DEFAULT 'never',
  last_error TEXT,
  default_pm_id TEXT NOT NULL DEFAULT '',
  people_count INTEGER NOT NULL DEFAULT 0,
  project_count INTEGER NOT NULL DEFAULT 0,
  task_count INTEGER NOT NULL DEFAULT 0
);

INSERT INTO sync_state (id, last_status) VALUES ('default', 'never') ON CONFLICT (id) DO NOTHING;
