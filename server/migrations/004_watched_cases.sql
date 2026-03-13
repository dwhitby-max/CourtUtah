CREATE TABLE IF NOT EXISTS watched_cases (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  search_type VARCHAR(50) NOT NULL,
  search_value VARCHAR(255) NOT NULL,
  label VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_watched_cases_user ON watched_cases(user_id);
CREATE INDEX IF NOT EXISTS idx_watched_cases_search ON watched_cases(search_type, search_value);
