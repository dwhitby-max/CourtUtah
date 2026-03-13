-- Migration 009: Add columns for the HTML calendar scraper format.
-- The old PDF format lacked judge name, hearing location, and virtual hearing flags.
-- source_url replaces source_pdf_url semantically (but we keep both for backward compat).

ALTER TABLE court_events ADD COLUMN IF NOT EXISTS judge_name VARCHAR(255);
ALTER TABLE court_events ADD COLUMN IF NOT EXISTS hearing_location VARCHAR(255);
ALTER TABLE court_events ADD COLUMN IF NOT EXISTS is_virtual BOOLEAN DEFAULT false;
ALTER TABLE court_events ADD COLUMN IF NOT EXISTS source_url TEXT;

CREATE INDEX IF NOT EXISTS idx_court_events_judge ON court_events(judge_name);
