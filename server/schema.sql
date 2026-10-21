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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, direction)
);

CREATE INDEX IF NOT EXISTS reviews_saved_by_email_idx ON reviews (saved_by_email);
CREATE INDEX IF NOT EXISTS reviews_rater_email_idx ON reviews (rater_email);
CREATE INDEX IF NOT EXISTS reviews_ratee_email_idx ON reviews (ratee_email);
CREATE INDEX IF NOT EXISTS reviews_task_id_idx ON reviews (task_id);
