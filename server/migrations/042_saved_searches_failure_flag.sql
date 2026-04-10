-- Migration 042: Track whether the prior scrape for a saved search had partial
-- failures. Used to gate user-facing "Retry" buttons and to allow force-refresh
-- only when recovering from a failed scrape.

ALTER TABLE saved_searches
  ADD COLUMN IF NOT EXISTS last_scrape_had_failures BOOLEAN DEFAULT false;
