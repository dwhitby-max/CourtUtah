CREATE TABLE IF NOT EXISTS change_log (
  id SERIAL PRIMARY KEY,
  court_event_id INTEGER NOT NULL REFERENCES court_events(id) ON DELETE CASCADE,
  field_changed VARCHAR(100) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  detected_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_change_log_event ON change_log(court_event_id);
