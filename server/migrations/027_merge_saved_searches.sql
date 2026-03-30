-- Merge saved_searches into watched_cases
-- Add columns to watched_cases to support multi-field search params
ALTER TABLE watched_cases ADD COLUMN IF NOT EXISTS search_params JSONB;
ALTER TABLE watched_cases ADD COLUMN IF NOT EXISTS results_count INTEGER DEFAULT 0;
ALTER TABLE watched_cases ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual';

-- Migrate active saved_searches into watched_cases
INSERT INTO watched_cases (user_id, search_type, search_value, label, is_active, search_params, results_count, last_refreshed_at, source, created_at, updated_at, monitor_changes, auto_add_new)
SELECT
  ss.user_id,
  CASE
    WHEN ss.search_params->>'defendantName' IS NOT NULL AND ss.search_params->>'defendantName' != '' THEN 'defendant_name'
    WHEN ss.search_params->>'caseNumber' IS NOT NULL AND ss.search_params->>'caseNumber' != '' THEN 'case_number'
    WHEN ss.search_params->>'judgeName' IS NOT NULL AND ss.search_params->>'judgeName' != '' THEN 'judge_name'
    WHEN ss.search_params->>'attorney' IS NOT NULL AND ss.search_params->>'attorney' != '' THEN 'attorney'
    WHEN ss.search_params->>'courtName' IS NOT NULL AND ss.search_params->>'courtName' != '' THEN 'court_name'
    WHEN ss.search_params->>'defendantOtn' IS NOT NULL AND ss.search_params->>'defendantOtn' != '' THEN 'defendant_otn'
    WHEN ss.search_params->>'citationNumber' IS NOT NULL AND ss.search_params->>'citationNumber' != '' THEN 'citation_number'
    ELSE 'defendant_name'
  END,
  COALESCE(
    NULLIF(ss.search_params->>'defendantName', ''),
    NULLIF(ss.search_params->>'caseNumber', ''),
    NULLIF(ss.search_params->>'judgeName', ''),
    NULLIF(ss.search_params->>'attorney', ''),
    NULLIF(ss.search_params->>'courtName', ''),
    NULLIF(ss.search_params->>'defendantOtn', ''),
    NULLIF(ss.search_params->>'citationNumber', ''),
    'unknown'
  ),
  ss.label,
  ss.is_active,
  ss.search_params,
  ss.results_count,
  ss.last_run_at,
  'auto_search',
  ss.created_at,
  ss.updated_at,
  false,
  CASE WHEN ss.search_params->>'_autoAddToCalendar' = 'true' THEN true ELSE false END
FROM saved_searches ss
WHERE ss.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM watched_cases wc
    WHERE wc.user_id = ss.user_id
      AND wc.search_params->>'_key' = ss.search_params->>'_key'
      AND wc.is_active = true
  );
