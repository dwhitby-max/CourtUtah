-- Migration 037: Consolidate duplicate court_events rows and enforce
-- unique constraint on (case_number, event_date, event_time).
--
-- The upsert key must include event_time because the same case can have
-- multiple hearings on the same date at different times (e.g. 9:00 AM
-- pretrial + 1:30 PM sentencing). See CLAUDE.md and migration 032.
--
-- This migration keeps only the most recently updated row per
-- (case_number, event_date, event_time) and adds a unique constraint
-- to prevent future duplicates.

-- Step 0: Normalize NULL event_time to empty string so the unique constraint
-- works without COALESCE tricks (simpler ON CONFLICT in app code).
UPDATE court_events SET event_time = '' WHERE event_time IS NULL;
ALTER TABLE court_events ALTER COLUMN event_time SET DEFAULT '';
ALTER TABLE court_events ALTER COLUMN event_time SET NOT NULL;

-- Step 1: Re-parent calendar_entries and change_log from duplicate rows
-- to the surviving (most recently updated) row BEFORE deleting duplicates.
-- This preserves users' synced calendar events instead of cascade-deleting them.

-- Build a mapping of duplicate IDs -> survivor IDs
WITH survivors AS (
  SELECT DISTINCT ON (case_number, event_date, event_time)
    id AS survivor_id, case_number, event_date, event_time
  FROM court_events
  WHERE case_number IS NOT NULL AND event_date IS NOT NULL
  ORDER BY case_number, event_date, event_time, updated_at DESC NULLS LAST, id DESC
),
duplicates AS (
  SELECT ce.id AS dup_id, s.survivor_id
  FROM court_events ce
  JOIN survivors s
    ON s.case_number = ce.case_number
   AND s.event_date = ce.event_date
   AND s.event_time = ce.event_time
  WHERE ce.id != s.survivor_id
    AND ce.case_number IS NOT NULL
    AND ce.event_date IS NOT NULL
)
UPDATE calendar_entries ce
SET court_event_id = d.survivor_id
FROM duplicates d
WHERE ce.court_event_id = d.dup_id;

-- Same for change_log
WITH survivors AS (
  SELECT DISTINCT ON (case_number, event_date, event_time)
    id AS survivor_id, case_number, event_date, event_time
  FROM court_events
  WHERE case_number IS NOT NULL AND event_date IS NOT NULL
  ORDER BY case_number, event_date, event_time, updated_at DESC NULLS LAST, id DESC
),
duplicates AS (
  SELECT ce.id AS dup_id, s.survivor_id
  FROM court_events ce
  JOIN survivors s
    ON s.case_number = ce.case_number
   AND s.event_date = ce.event_date
   AND s.event_time = ce.event_time
  WHERE ce.id != s.survivor_id
    AND ce.case_number IS NOT NULL
    AND ce.event_date IS NOT NULL
)
UPDATE change_log cl
SET court_event_id = d.survivor_id
FROM duplicates d
WHERE cl.court_event_id = d.dup_id;

-- Step 2: Now safe to delete duplicate rows — all references point to survivors.
DELETE FROM court_events
WHERE id NOT IN (
  SELECT DISTINCT ON (case_number, event_date, event_time) id
  FROM court_events
  WHERE case_number IS NOT NULL AND event_date IS NOT NULL
  ORDER BY case_number, event_date, event_time, updated_at DESC NULLS LAST, id DESC
)
AND case_number IS NOT NULL
AND event_date IS NOT NULL;

-- Step 3: De-duplicate any calendar_entries that now point to the same
-- (user_id, court_event_id, calendar_connection_id) after re-parenting.
-- Keep the most recently updated one; mark the rest as 'pending_delete'
-- so the server can remove them from Google/Microsoft/CalDAV on startup
-- before clearing them from the DB.
UPDATE calendar_entries
SET sync_status = 'pending_delete', updated_at = NOW()
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, court_event_id, calendar_connection_id) id
  FROM calendar_entries
  ORDER BY user_id, court_event_id, calendar_connection_id, updated_at DESC NULLS LAST, id DESC
)
AND sync_status != 'removed';

-- Step 4: Add unique constraint to prevent future duplicates.
ALTER TABLE court_events
  ADD CONSTRAINT uq_court_events_case_date_time UNIQUE (case_number, event_date, event_time);
