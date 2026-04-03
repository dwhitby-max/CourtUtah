-- Fix corrupt attorney data from the old parser that blindly assigned the
-- generic "Attorney:" field from search.php to defense_attorney, regardless
-- of the attorney's actual role. Records where defense_attorney is set but
-- prosecuting_attorney is NULL were likely populated by this bug (reports.php
-- enrichment always sets BOTH fields). Clear defense_attorney so the next
-- reports.php enrichment or scrape can populate it correctly.

UPDATE court_events
SET defense_attorney = NULL, updated_at = NOW()
WHERE defense_attorney IS NOT NULL
  AND (prosecuting_attorney IS NULL OR prosecuting_attorney = '');
