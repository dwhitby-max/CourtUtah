-- Add last_refreshed_at to track when each watched case search was last run
ALTER TABLE watched_cases ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMP;
