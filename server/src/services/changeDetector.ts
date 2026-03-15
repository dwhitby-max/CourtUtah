import { getPool } from "../db/pool";
import { notifyScheduleChange } from "./notificationService";

interface ChangeRecord {
  field: string;
  oldValue: string;
  newValue: string;
}

const TRACKED_FIELDS = [
  "court_room", "event_date", "event_time", "hearing_type",
  "case_number", "case_type", "defendant_name",
  "prosecuting_attorney", "defense_attorney",
  "judge_name", "hearing_location",
];

/**
 * Compare an existing court event with new scraped data.
 * Returns list of changed fields, or empty array if no changes.
 */
export function detectChanges(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): ChangeRecord[] {
  const changes: ChangeRecord[] = [];

  for (const field of TRACKED_FIELDS) {
    const oldVal = existing[field] ? String(existing[field]) : "";
    const newVal = incoming[field] ? String(incoming[field]) : "";

    if (oldVal !== newVal) {
      changes.push({
        field,
        oldValue: oldVal,
        newValue: newVal,
      });
    }
  }

  return changes;
}

/**
 * Record changes in the change_log table and notify affected users.
 */
export async function processChanges(
  courtEventId: number,
  changes: ChangeRecord[]
): Promise<void> {
  if (changes.length === 0) return;

  const pool = getPool();
  if (!pool) return;

  const client = await pool.connect();
  try {
    // Log each change
    for (const change of changes) {
      await client.query(
        `INSERT INTO change_log (court_event_id, field_changed, old_value, new_value)
         VALUES ($1, $2, $3, $4)`,
        [courtEventId, change.field, change.oldValue, change.newValue]
      );
    }

    // Find users watching this event
    const watchResult = await client.query(
      `SELECT DISTINCT wc.user_id, wc.label
       FROM watched_cases wc
       JOIN calendar_entries ce ON ce.watched_case_id = wc.id
       WHERE ce.court_event_id = $1 AND wc.is_active = true`,
      [courtEventId]
    );

    // Notify each affected user
    for (const row of watchResult.rows) {
      await notifyScheduleChange(
        row.user_id,
        row.label,
        changes
      );
    }
  } finally {
    client.release();
  }
}
