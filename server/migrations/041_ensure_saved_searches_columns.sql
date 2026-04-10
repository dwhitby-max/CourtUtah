-- Migration 041: Ensure saved_searches has all expected columns.
-- The table may have been created via migration 017 (which lacks search_type,
-- search_value, source, last_refreshed_at) or via the 004→027→039 path
-- (which has them). This migration adds any missing columns.

ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS search_type VARCHAR(50);
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS search_value VARCHAR(255);
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'auto_search';
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMP;

-- Backfill search_type and search_value from search_params JSONB for existing rows
UPDATE saved_searches
SET search_type = CASE
      WHEN search_params->>'defendantName' IS NOT NULL AND search_params->>'defendantName' != '' THEN 'defendant_name'
      WHEN search_params->>'caseNumber' IS NOT NULL AND search_params->>'caseNumber' != '' THEN 'case_number'
      WHEN search_params->>'judgeName' IS NOT NULL AND search_params->>'judgeName' != '' THEN 'judge_name'
      WHEN search_params->>'attorney' IS NOT NULL AND search_params->>'attorney' != '' THEN 'attorney'
      WHEN search_params->>'courtName' IS NOT NULL AND search_params->>'courtName' != '' THEN 'court_name'
      WHEN search_params->>'defendantOtn' IS NOT NULL AND search_params->>'defendantOtn' != '' THEN 'defendant_otn'
      WHEN search_params->>'citationNumber' IS NOT NULL AND search_params->>'citationNumber' != '' THEN 'citation_number'
      ELSE 'defendant_name'
    END,
    search_value = COALESCE(
      NULLIF(search_params->>'defendantName', ''),
      NULLIF(search_params->>'caseNumber', ''),
      NULLIF(search_params->>'judgeName', ''),
      NULLIF(search_params->>'attorney', ''),
      NULLIF(search_params->>'courtName', ''),
      NULLIF(search_params->>'defendantOtn', ''),
      NULLIF(search_params->>'citationNumber', ''),
      'unknown'
    )
WHERE search_type IS NULL OR search_value IS NULL;

-- Ensure source is set for existing rows
UPDATE saved_searches SET source = 'auto_search' WHERE source IS NULL;

CREATE INDEX IF NOT EXISTS idx_saved_searches_search ON saved_searches(search_type, search_value);
