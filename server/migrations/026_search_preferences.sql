-- Add search_preferences JSONB column for default search settings (e.g. preferred courts)
ALTER TABLE users ADD COLUMN IF NOT EXISTS search_preferences JSONB DEFAULT '{}';
