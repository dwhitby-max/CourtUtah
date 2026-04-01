-- Add first_name and last_name to users table (collected at terms acceptance)
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
