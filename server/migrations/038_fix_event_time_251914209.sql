UPDATE court_events
SET event_time = '09:00 AM', updated_at = NOW()
WHERE case_number = '251914209'
  AND event_date = '2026-04-16'
  AND event_time = '08:30 AM';
