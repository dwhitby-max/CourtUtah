UPDATE court_events
SET defendant_name = 'MIGUEL ANGEL OBREGON-VARGAS',
    prosecuting_attorney = 'RYAN ROBINSON',
    defense_attorney = 'PATRICK MOENCH',
    hearing_type = 'FINAL PRETRIAL CONFERENCE',
    updated_at = NOW()
WHERE id = 41759
  AND case_number = '251914209'
  AND event_date = '2026-04-16';

DELETE FROM court_events WHERE id = 41365
  AND case_number = '251914209'
  AND event_time = '08:30 AM';
