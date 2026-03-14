-- Add calendar event appearance preferences (color + tag) to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_preferences JSONB DEFAULT '{}';
