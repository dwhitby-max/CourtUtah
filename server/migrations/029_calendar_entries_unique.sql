-- Prevent duplicate calendar events for the same user + court event + calendar connection.
-- Before adding the constraint, clean up any existing duplicates by keeping the most
-- recently synced entry (or the one with the highest id as tiebreaker).

-- Step 1: Delete duplicate rows, keeping the best one per (user_id, court_event_id, calendar_connection_id)
DELETE FROM calendar_entries
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, court_event_id, calendar_connection_id) id
  FROM calendar_entries
  ORDER BY user_id, court_event_id, calendar_connection_id,
           CASE WHEN sync_status = 'synced' THEN 0 ELSE 1 END,
           updated_at DESC,
           id DESC
);

-- Step 2: Add unique constraint
ALTER TABLE calendar_entries
  ADD CONSTRAINT uq_calendar_entries_user_event_connection
  UNIQUE (user_id, court_event_id, calendar_connection_id);
