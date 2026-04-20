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
    for (const change of changes) {
      await client.query(
        `INSERT INTO change_log (court_event_id, field_changed, old_value, new_value)
         VALUES ($1, $2, $3, $4)`,
        [courtEventId, change.field, change.oldValue, change.newValue]
      );
    }

    const eventResult = await client.query<{ case_number: string; defendant_name: string | null }>(
      `SELECT case_number, defendant_name FROM court_events WHERE id = $1`,
      [courtEventId]
    );
    if (eventResult.rows.length === 0) return;
    const caseName = eventResult.rows[0].defendant_name?.trim()
      || eventResult.rows[0].case_number
      || `Event ${courtEventId}`;

    // Fan out to every user tracking this event via calendar_entries, plus
    // any saved_search this event was matched against.
    const recipients = await client.query<{ user_id: number; saved_search_id: number | null }>(
      `SELECT DISTINCT user_id, saved_search_id FROM calendar_entries
       WHERE court_event_id = $1 AND sync_status NOT IN ('removed')`,
      [courtEventId]
    );
    for (const row of recipients.rows) {
      try {
        await notifyScheduleChange(
          row.user_id,
          caseName,
          changes,
          row.saved_search_id ?? undefined,
          { courtEventId },
        );
      } catch (err) {
        console.warn(`⚠️ Schedule-change notification failed for user ${row.user_id}:`, err instanceof Error ? err.message : err);
      }
    }
  } finally {
    client.release();
  }
}
