-- Migration 037: Consolidate duplicate court_events rows and enforce
-- unique constraint on (case_number, event_date).
--
-- Previously event_time was part of the dedup key, so the same case on the
-- same date could produce multiple rows when the parser extracted different
-- times across scrape runs. This migration keeps only the most recently
-- updated row per (case_number, event_date) and adds a unique constraint
-- to prevent future duplicates.

-- Step 1: Re-parent calendar_entries and change_log from duplicate rows
-- to the surviving (most recently updated) row BEFORE deleting duplicates.
-- This preserves users' synced calendar events instead of cascade-deleting them.

-- Build a mapping of duplicate IDs -> survivor IDs
WITH survivors AS (
  SELECT DISTINCT ON (case_number, event_date) id AS survivor_id, case_number, event_date
  FROM court_events
  WHERE case_number IS NOT NULL AND event_date IS NOT NULL
  ORDER BY case_number, event_date, updated_at DESC NULLS LAST, id DESC
),
duplicates AS (
  SELECT ce.id AS dup_id, s.survivor_id
  FROM court_events ce
  JOIN survivors s ON s.case_number = ce.case_number AND s.event_date = ce.event_date
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
  SELECT DISTINCT ON (case_number, event_date) id AS survivor_id, case_number, event_date
  FROM court_events
  WHERE case_number IS NOT NULL AND event_date IS NOT NULL
  ORDER BY case_number, event_date, updated_at DESC NULLS LAST, id DESC
),
duplicates AS (
  SELECT ce.id AS dup_id, s.survivor_id
  FROM court_events ce
  JOIN survivors s ON s.case_number = ce.case_number AND s.event_date = ce.event_date
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
  SELECT DISTINCT ON (case_number, event_date) id
  FROM court_events
  WHERE case_number IS NOT NULL AND event_date IS NOT NULL
  ORDER BY case_number, event_date, updated_at DESC NULLS LAST, id DESC
)
AND case_number IS NOT NULL
AND event_date IS NOT NULL;

-- Step 3: De-duplicate any calendar_entries that now point to the same
-- (user_id, court_event_id, calendar_connection_id) after re-parenting.
-- Keep the most recently updated one.
DELETE FROM calendar_entries
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, court_event_id, calendar_connection_id) id
  FROM calendar_entries
  ORDER BY user_id, court_event_id, calendar_connection_id, updated_at DESC NULLS LAST, id DESC
);

-- Step 4: Add unique constraint to prevent future duplicates.
ALTER TABLE court_events
  ADD CONSTRAINT uq_court_events_case_date UNIQUE (case_number, event_date);
