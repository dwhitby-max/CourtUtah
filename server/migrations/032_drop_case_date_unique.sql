-- Revert the unique index from 031: a case can have multiple hearings
-- on the same date at different times (e.g. 9:00 AM pretrial + 1:30 PM sentencing).
-- The (case_number, event_date) constraint was too aggressive.
DROP INDEX IF EXISTS idx_court_events_case_date_unique;
