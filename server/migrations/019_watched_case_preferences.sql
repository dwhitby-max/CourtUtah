-- Add monitor_changes and auto_add_new preference columns to watched_cases
ALTER TABLE watched_cases ADD COLUMN IF NOT EXISTS monitor_changes BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE watched_cases ADD COLUMN IF NOT EXISTS auto_add_new BOOLEAN NOT NULL DEFAULT false;
