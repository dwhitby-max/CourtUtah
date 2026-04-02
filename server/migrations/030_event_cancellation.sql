-- Track when a court event disappears from scrape results (likely cancelled)
ALTER TABLE court_events
  ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_detected_at TIMESTAMP;

-- Track user-dismissed calendar entries so auto-sync doesn't re-add them
-- (soft-delete: status = 'removed' instead of hard DELETE)
ALTER TABLE calendar_entries
  DROP CONSTRAINT IF EXISTS calendar_entries_sync_status_check;

-- Allow 'removed' as a sync_status value
-- No CHECK constraint needed — app code controls valid values
