-- Add account approval workflow
-- New users default to not approved; admin must approve before account goes live
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT false;

-- Existing users are grandfathered in as approved
UPDATE users SET is_approved = true WHERE is_approved IS NULL OR is_approved = false;

-- Index for quick lookup of pending users
CREATE INDEX IF NOT EXISTS idx_users_is_approved ON users (is_approved) WHERE is_approved = false;
