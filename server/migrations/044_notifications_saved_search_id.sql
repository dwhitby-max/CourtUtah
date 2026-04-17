-- Add saved_search_id to notifications so deleting a saved search
-- automatically cascades to remove all its notifications.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS saved_search_id INTEGER REFERENCES saved_searches(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_notifications_saved_search ON notifications(saved_search_id);
