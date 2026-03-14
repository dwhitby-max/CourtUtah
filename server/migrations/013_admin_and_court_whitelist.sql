-- Add admin flag to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Set dwhitby@gmail.com as admin
UPDATE users SET is_admin = true WHERE email = 'dwhitby@gmail.com';

-- App-level settings (key-value store for things like court whitelist)
CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Initialize court whitelist as empty (empty = scrape all courts)
INSERT INTO app_settings (key, value) VALUES ('court_whitelist', '[]')
ON CONFLICT (key) DO NOTHING;
