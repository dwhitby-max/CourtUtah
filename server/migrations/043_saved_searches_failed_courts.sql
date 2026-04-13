-- Migration 043: Track which court location codes failed during the last scrape.
-- Used by force_refresh/retry to only re-scrape the failed courts instead of
-- re-running the entire search.

ALTER TABLE saved_searches
  ADD COLUMN IF NOT EXISTS failed_courts TEXT[] DEFAULT '{}';
