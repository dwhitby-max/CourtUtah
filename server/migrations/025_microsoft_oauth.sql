-- Add Microsoft OAuth support: microsoft_id column on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS microsoft_id VARCHAR(255) UNIQUE;
CREATE INDEX IF NOT EXISTS idx_users_microsoft_id ON users(microsoft_id);
