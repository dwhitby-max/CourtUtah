-- Add account_type column to users table
-- Values: 'individual_attorney' or 'agency'
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type VARCHAR(20) DEFAULT NULL;

-- Backfill existing users who have completed onboarding
UPDATE users SET account_type = 'individual_attorney' WHERE account_type IS NULL AND tos_agreed_at IS NOT NULL;
