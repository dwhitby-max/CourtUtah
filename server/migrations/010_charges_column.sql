-- Migration 010: Add charges JSONB column to court_events
-- Stores charge descriptions from reports.php Full Court Calendar data
-- Idempotent: uses IF NOT EXISTS

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'court_events' AND column_name = 'charges'
  ) THEN
    ALTER TABLE court_events ADD COLUMN charges JSONB DEFAULT '[]';
  END IF;
END $$;
