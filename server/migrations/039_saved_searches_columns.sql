ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS search_type VARCHAR(50);
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS search_value VARCHAR(255);
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'auto_search';
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMP;

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

UPDATE saved_searches SET source = 'auto_search' WHERE source IS NULL;

CREATE INDEX IF NOT EXISTS idx_saved_searches_search ON saved_searches(search_type, search_value);

CREATE TABLE IF NOT EXISTS one_time_tasks (
  task_name VARCHAR(100) PRIMARY KEY,
  completed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  result JSONB
);
