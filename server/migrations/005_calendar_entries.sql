CREATE TABLE IF NOT EXISTS calendar_entries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  watched_case_id INTEGER NOT NULL REFERENCES watched_cases(id) ON DELETE CASCADE,
  court_event_id INTEGER NOT NULL REFERENCES court_events(id) ON DELETE CASCADE,
  calendar_connection_id INTEGER NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  external_event_id VARCHAR(255),
  external_calendar_id VARCHAR(255),
  last_synced_content_hash VARCHAR(64),
  sync_status VARCHAR(50) DEFAULT 'pending',
  sync_error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_entries_user ON calendar_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_entries_watched ON calendar_entries(watched_case_id);
CREATE INDEX IF NOT EXISTS idx_calendar_entries_event ON calendar_entries(court_event_id);
CREATE INDEX IF NOT EXISTS idx_calendar_entries_external ON calendar_entries(external_event_id);
