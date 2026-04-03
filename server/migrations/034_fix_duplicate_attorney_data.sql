-- Fix cases where the old parser put the prosecutor's name into
-- defense_attorney. This happens when the generic "Attorney:" field
-- was assigned to defense_attorney, then reports.php enrichment later
-- set prosecuting_attorney to the same name.

UPDATE court_events
SET defense_attorney = NULL, updated_at = NOW()
WHERE defense_attorney IS NOT NULL
  AND prosecuting_attorney IS NOT NULL
  AND UPPER(TRIM(defense_attorney)) = UPPER(TRIM(prosecuting_attorney));
