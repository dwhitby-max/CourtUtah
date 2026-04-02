-- Deduplicate court_events: keep only the most recently scraped row per
-- (case_number, event_date). Prior code used case_number+event_date+event_time
-- as the upsert key, so search.php and reports.php could create duplicate rows
-- with different times for the same hearing.

-- Step 1: For each duplicate, identify the "keeper" (most recent scraped_at)
-- and re-point calendar_entries and change_log to the keeper before deleting.

-- Re-point calendar_entries from duplicate court_event_id to the keeper.
-- If the keeper already has a calendar_entry for the same user+connection,
-- drop the duplicate entry (the ON DELETE CASCADE will handle it).
UPDATE calendar_entries ce
SET court_event_id = keeper.id
FROM court_events dup
JOIN (
  SELECT DISTINCT ON (case_number, event_date) id, case_number, event_date
  FROM court_events
  ORDER BY case_number, event_date, scraped_at DESC
) keeper ON keeper.case_number = dup.case_number AND keeper.event_date = dup.event_date
WHERE ce.court_event_id = dup.id
  AND dup.id != keeper.id
  AND NOT EXISTS (
    -- Don't re-point if it would violate the unique constraint
    SELECT 1 FROM calendar_entries existing
    WHERE existing.user_id = ce.user_id
      AND existing.court_event_id = keeper.id
      AND existing.calendar_connection_id = ce.calendar_connection_id
  );

-- Re-point change_log from duplicates to the keeper
UPDATE change_log cl
SET court_event_id = keeper.id
FROM court_events dup
JOIN (
  SELECT DISTINCT ON (case_number, event_date) id, case_number, event_date
  FROM court_events
  ORDER BY case_number, event_date, scraped_at DESC
) keeper ON keeper.case_number = dup.case_number AND keeper.event_date = dup.event_date
WHERE cl.court_event_id = dup.id
  AND dup.id != keeper.id;

-- Step 2: Delete duplicate rows. Any calendar_entries/change_log still pointing
-- at duplicates (e.g. skipped by the NOT EXISTS above) will cascade-delete.
DELETE FROM court_events
WHERE id NOT IN (
  SELECT DISTINCT ON (case_number, event_date) id
  FROM court_events
  ORDER BY case_number, event_date, scraped_at DESC
);

-- Step 3: Add a unique index to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_court_events_case_date_unique
  ON court_events (case_number, event_date);
