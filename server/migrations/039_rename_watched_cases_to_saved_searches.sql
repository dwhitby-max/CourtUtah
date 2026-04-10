-- Rename watched_cases table to saved_searches
ALTER TABLE watched_cases RENAME TO saved_searches;

-- Rename calendar_entries foreign key column
ALTER TABLE calendar_entries RENAME COLUMN watched_case_id TO saved_search_id;

-- Drop and recreate indexes with new names
DROP INDEX IF EXISTS idx_watched_cases_user;
DROP INDEX IF EXISTS idx_watched_cases_search;
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_search ON saved_searches(search_type, search_value);

DROP INDEX IF EXISTS idx_calendar_entries_watched;
CREATE INDEX IF NOT EXISTS idx_calendar_entries_saved_search ON calendar_entries(saved_search_id);
