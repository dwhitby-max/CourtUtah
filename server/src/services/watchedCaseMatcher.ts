import { getPool } from "../db/pool";
import { syncCalendarEntry } from "./calendarSync";
import { createNotification } from "./notificationService";
import { captureException } from "./sentryService";

interface WatchedCaseRow {
  id: number;
  user_id: number;
  search_type: string;
  search_value: string;
  label: string;
  monitor_changes: boolean;
  auto_add_new: boolean;
  search_params: Record<string, string> | null;
  source: string;
}

interface CalendarConnectionRow {
  id: number;
}

interface MatchResult {
  watchedCasesChecked: number;
  newEntriesCreated: number;
  syncTriggered: number;
  errors: number;
}

/**
 * Column mapping for watched case search types → court_events columns.
 */
const COLUMN_MAP: Record<string, string> = {
  defendant_name: "defendant_name",
  case_number: "case_number",
  court_name: "court_name",
  court_date: "event_date",
  defendant_otn: "defendant_otn",
  citation_number: "citation_number",
  judge_name: "judge_name",
  attorney: "prosecuting_attorney", // attorney matches against both, handled specially below
};

/**
 * After a scrape job completes, auto-match all active watched cases
 * against court events in the database. For each new match:
 * 1. Create a calendar_entry linking watched_case → court_event → calendar_connection
 * 2. Trigger calendar sync for the new entry
 * 3. Notify the user of the new match
 *
 * This runs after every scrape cycle, ensuring users get calendar entries
 * for newly-scraped events without needing to manually trigger "sync".
 */
export async function matchWatchedCases(): Promise<MatchResult> {
  const pool = getPool();
  if (!pool) return { watchedCasesChecked: 0, newEntriesCreated: 0, syncTriggered: 0, errors: 0 };

  const result: MatchResult = {
    watchedCasesChecked: 0,
    newEntriesCreated: 0,
    syncTriggered: 0,
    errors: 0,
  };

  const client = await pool.connect();
  try {
    // Get all active watched cases
    const watchedResult = await client.query<WatchedCaseRow>(
      `SELECT id, user_id, search_type, search_value, label, monitor_changes, auto_add_new, search_params, COALESCE(source, 'manual') as source
       FROM watched_cases
       WHERE is_active = true`
    );

    const watchedCases = watchedResult.rows;
    result.watchedCasesChecked = watchedCases.length;

    if (watchedCases.length === 0) return result;

    for (const wc of watchedCases) {
      // Only auto-create calendar entries for cases that opted into auto_add_new
      if (!wc.auto_add_new) continue;
      try {
        await matchSingleWatchedCase(client, wc, result);
      } catch (err) {
        result.errors++;
        console.error(`❌ Auto-match failed for watched case ${wc.id} (${wc.label}):`, err instanceof Error ? err.message : err);
        captureException(err instanceof Error ? err : new Error(String(err)), {
          tags: { service: "watchedCaseMatcher", watchedCaseId: String(wc.id) },
        });
      }
    }
  } finally {
    client.release();
  }

  if (result.newEntriesCreated > 0) {
    console.log(`🔗 Auto-match: ${result.newEntriesCreated} new calendar entries, ${result.syncTriggered} syncs triggered`);
  }

  return result;
}

/**
 * Match a single watched case against court events.
 * Creates calendar entries for any new matches that don't already have entries.
 */
async function matchSingleWatchedCase(
  client: { query: <T = Record<string, unknown>>(q: string, p?: unknown[]) => Promise<{ rows: T[] }> },
  wc: WatchedCaseRow,
  result: MatchResult
): Promise<void> {
  const column = COLUMN_MAP[wc.search_type];
  if (!column) return; // Unknown search type — skip silently

  // Get user's active calendar connections
  const calResult = await client.query<CalendarConnectionRow>(
    `SELECT id FROM calendar_connections
     WHERE user_id = $1 AND is_active = true`,
    [wc.user_id]
  );

  // No calendar connected — skip (user hasn't set up calendar yet)
  if (calResult.rows.length === 0) return;

  // Build the search query — exact match for dates, ILIKE for text
  // Attorney is special: matches against both prosecuting_attorney and defense_attorney
  const useExact = wc.search_type === "court_date";
  let whereClause: string;
  let searchVal: string;

  if (wc.search_type === "attorney") {
    whereClause = `(UPPER(prosecuting_attorney) LIKE $1 OR UPPER(defense_attorney) LIKE $1)`;
    searchVal = `%${wc.search_value.toUpperCase()}%`;
  } else if (useExact) {
    whereClause = `${column} = $1`;
    searchVal = wc.search_value;
  } else {
    whereClause = `UPPER(${column}) LIKE $1`;
    searchVal = `%${wc.search_value.toUpperCase()}%`;
  }

  // Find matching court events that are upcoming (today or future)
  const eventsResult = await client.query<{ id: number }>(
    `SELECT id FROM court_events
     WHERE ${whereClause}
       AND event_date >= CURRENT_DATE`,
    [searchVal]
  );

  if (eventsResult.rows.length === 0) return;

  // For each calendar connection × each matching event, create entry if not exists
  for (const calConn of calResult.rows) {
    for (const event of eventsResult.rows) {
      // Check if entry already exists (avoid duplicates)
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM calendar_entries
         WHERE watched_case_id = $1 AND court_event_id = $2 AND calendar_connection_id = $3`,
        [wc.id, event.id, calConn.id]
      );

      if (existing.rows.length > 0) continue; // Already linked

      // Create the calendar entry
      const insertResult = await client.query<{ id: number }>(
        `INSERT INTO calendar_entries (user_id, watched_case_id, court_event_id, calendar_connection_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [wc.user_id, wc.id, event.id, calConn.id]
      );

      result.newEntriesCreated++;

      // Trigger calendar sync for the new entry
      try {
        const synced = await syncCalendarEntry(insertResult.rows[0].id);
        if (synced) result.syncTriggered++;
      } catch (syncErr) {
        // Sync failure is non-fatal — entry exists, will retry later
        console.warn(`  ⚠️  Sync failed for new entry ${insertResult.rows[0].id}: ${syncErr instanceof Error ? syncErr.message : syncErr}`);
      }
    }
  }

  // If we created new entries, notify the user
  if (result.newEntriesCreated > 0) {
    await createNotification({
      userId: wc.user_id,
      type: "new_match",
      title: `New matches for "${wc.label}"`,
      message: `Found new court events matching your watched case "${wc.label}". Calendar entries have been created automatically.`,
      metadata: {
        watchedCaseId: wc.id,
        searchType: wc.search_type,
        searchValue: wc.search_value,
      },
    });
  }
}
