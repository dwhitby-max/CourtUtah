import { getPool } from "../db/pool";

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

    // Skip if incoming value is empty — a sparse scrape should not count as
    // a "deletion" of existing enriched data (e.g. attorney fields from
    // details.php that won't appear in search.php results).
    if (oldVal !== newVal && newVal !== "") {
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

    // User notifications are handled by the scheduler after auto-syncing calendar entries
  } finally {
    client.release();
  }
}
