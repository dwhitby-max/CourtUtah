import cron from "node-cron";
import { getPool } from "../db/pool";
import { liveSearchUtcourts, LiveSearchParams } from "./courtScraper";
import { parseHtmlCalendarResults, ParsedCourtEvent } from "./courtEventParser";
import { detectChanges, processChanges } from "./changeDetector";
import { syncCalendarEntry } from "./calendarSync";
import { captureException, captureMessage } from "./sentryService";
import { createNotification } from "./notificationService";
import { sendDigestNotifications } from "./digestService";

let isRunning = false;

interface WatchedCaseRow {
  id: number;
  user_id: number;
  search_type: string;
  search_value: string;
  label: string;
}

/**
 * Map a watched case's search_type + search_value to LiveSearchParams
 * for the utcourts.gov search.php endpoint.
 *
 * Returns null if the search type can't be mapped to a live search
 * (e.g. court_date, citation_number, defendant_otn — these only work
 * as local DB filters after results are fetched).
 */
function watchedCaseToLiveParams(wc: WatchedCaseRow): LiveSearchParams | null {
  switch (wc.search_type) {
    case "defendant_name":
      return { partyName: wc.search_value };
    case "case_number":
      return { caseNumber: wc.search_value };
    case "judge_name":
      return { judgeName: wc.search_value };
    case "attorney":
      return { attorneyLastName: wc.search_value };
    default:
      // court_name, court_date, defendant_otn, citation_number
      // can't be directly searched via utcourts — need a primary search field
      return null;
  }
}

/**
 * Run a targeted live search for a single watched case against utcourts.gov,
 * parse results, upsert to court_events, and create/sync calendar entries.
 *
 * Returns the number of events found and new calendar entries created.
 */
export async function runWatchedCaseSearch(watchedCaseId: number): Promise<{
  eventsFound: number;
  newEntries: number;
  changes: number;
}> {
  const pool = getPool();
  if (!pool) return { eventsFound: 0, newEntries: 0, changes: 0 };

  const client = await pool.connect();
  try {
    // Load the watched case
    const wcResult = await client.query<WatchedCaseRow>(
      `SELECT id, user_id, search_type, search_value, label
       FROM watched_cases WHERE id = $1`,
      [watchedCaseId]
    );
    if (wcResult.rows.length === 0) return { eventsFound: 0, newEntries: 0, changes: 0 };

    const wc = wcResult.rows[0];
    const liveParams = watchedCaseToLiveParams(wc);
    if (!liveParams) {
      console.log(`⚠️ Watched case ${wc.id} (${wc.search_type}) cannot be searched live — skipping`);
      return { eventsFound: 0, newEntries: 0, changes: 0 };
    }

    // Search utcourts.gov
    console.log(`🔍 Searching utcourts.gov for watched case ${wc.id}: ${wc.search_type}="${wc.search_value}"`);
    const html = await liveSearchUtcourts(liveParams);
    const parsed = parseHtmlCalendarResults(html);

    // Update last_refreshed_at even if no results
    await client.query(
      `UPDATE watched_cases SET last_refreshed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [wc.id]
    );

    if (parsed.length === 0) {
      console.log(`  📭 No results for "${wc.label}"`);
      return { eventsFound: 0, newEntries: 0, changes: 0 };
    }

    console.log(`  📋 Found ${parsed.length} events for "${wc.label}"`);

    let changes = 0;

    // Upsert each event to court_events
    for (const event of parsed) {
      const changed = await upsertCourtEvent(event);
      if (changed) changes++;
    }

    // Now match against the DB to create calendar entries
    const newEntries = await createCalendarEntriesForWatchedCase(wc, client);

    return { eventsFound: parsed.length, newEntries, changes };
  } finally {
    client.release();
  }
}

/**
 * After upserting events, find matching court_events for this watched case
 * and create calendar_entries for any new matches.
 */
async function createCalendarEntriesForWatchedCase(
  wc: WatchedCaseRow,
  client: { query: <T = Record<string, unknown>>(q: string, p?: unknown[]) => Promise<{ rows: T[] }> }
): Promise<number> {
  // Get user's active calendar connections
  const calResult = await client.query<{ id: number }>(
    `SELECT id FROM calendar_connections WHERE user_id = $1 AND is_active = true`,
    [wc.user_id]
  );
  if (calResult.rows.length === 0) return 0;

  // Build WHERE clause for matching
  const { whereClause, searchVal } = buildWhereClause(wc);

  const eventsResult = await client.query<{ id: number }>(
    `SELECT id FROM court_events WHERE ${whereClause} AND event_date >= CURRENT_DATE`,
    [searchVal]
  );

  if (eventsResult.rows.length === 0) return 0;

  let created = 0;
  for (const calConn of calResult.rows) {
    for (const event of eventsResult.rows) {
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM calendar_entries
         WHERE watched_case_id = $1 AND court_event_id = $2 AND calendar_connection_id = $3`,
        [wc.id, event.id, calConn.id]
      );
      if (existing.rows.length > 0) continue;

      const insertResult = await client.query<{ id: number }>(
        `INSERT INTO calendar_entries (user_id, watched_case_id, court_event_id, calendar_connection_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [wc.user_id, wc.id, event.id, calConn.id]
      );
      created++;

      try {
        await syncCalendarEntry(insertResult.rows[0].id);
      } catch (syncErr) {
        const syncErrMsg = syncErr instanceof Error ? syncErr.message : String(syncErr);
        console.warn(`  ⚠️ Sync failed for entry ${insertResult.rows[0].id}: ${syncErrMsg}`);
        await createNotification({
          userId: wc.user_id,
          type: "sync_error",
          title: `Calendar sync failed for "${wc.label}"`,
          message: `Failed to sync a court event to your calendar: ${syncErrMsg}`,
          metadata: {
            calendarEntryId: insertResult.rows[0].id,
            watchedCaseId: wc.id,
            error: syncErrMsg,
          },
        });
      }
    }
  }

  if (created > 0) {
    await createNotification({
      userId: wc.user_id,
      type: "new_match",
      title: `New matches for "${wc.label}"`,
      message: `Found ${eventsResult.rows.length} court events matching your search "${wc.label}". Calendar entries have been created automatically.`,
      metadata: {
        watchedCaseId: wc.id,
        searchType: wc.search_type,
        searchValue: wc.search_value,
      },
    });
  }

  return created;
}

/**
 * Build a WHERE clause for matching a watched case against court_events.
 */
function buildWhereClause(wc: WatchedCaseRow): { whereClause: string; searchVal: string } {
  if (wc.search_type === "attorney") {
    return {
      whereClause: `(UPPER(prosecuting_attorney) LIKE $1 OR UPPER(defense_attorney) LIKE $1)`,
      searchVal: `%${wc.search_value.toUpperCase()}%`,
    };
  }

  const columnMap: Record<string, string> = {
    defendant_name: "defendant_name",
    case_number: "case_number",
    court_name: "court_name",
    court_date: "event_date",
    defendant_otn: "defendant_otn",
    citation_number: "citation_number",
    judge_name: "judge_name",
  };

  const column = columnMap[wc.search_type];
  if (!column) return { whereClause: "1=0", searchVal: "" };

  if (wc.search_type === "court_date") {
    return { whereClause: `${column} = $1`, searchVal: wc.search_value };
  }

  return {
    whereClause: `UPPER(${column}) LIKE $1`,
    searchVal: `%${wc.search_value.toUpperCase()}%`,
  };
}

/**
 * Start the scheduler. Runs daily to refresh all active watched case searches.
 * Times are in Mountain Time (America/Denver = UTC-7 MST / UTC-6 MDT).
 *
 * Refresh window: 5:15–6:15 AM MT (12:15–13:15 UTC during MDT, 11:15–12:15 UTC during MST).
 * Cron fires at 11:15 AM UTC (≈5:15 AM MST / 5:15 AM MDT depending on season),
 * then adds a random 0–60 min delay before starting. Each case gets a random
 * gap between searches so they don't all hit utcourts.gov at once.
 */
export function startScheduler(): void {
  console.log("⏰ Starting watched-case refresh scheduler (daily ~5:15–6:15 AM MT)");

  // Daily refresh — 11:15 UTC (~5:15 AM MT) + random 0-60 min start delay
  cron.schedule("15 11 * * *", async () => {
    const delay = Math.floor(Math.random() * 60 * 60 * 1000);
    console.log(`⏰ Scheduled refresh triggered, starting in ${Math.round(delay / 60000)} minutes`);
    await new Promise((r) => setTimeout(r, delay));
    await refreshAllWatchedCases();
  });

  // Daily digest — 7:00 AM MT (13:00 UTC), after refresh window completes
  cron.schedule("0 13 * * *", async () => {
    console.log("📬 Daily digest triggered");
    try {
      await sendDigestNotifications("daily_digest");
    } catch (err) {
      console.error("❌ Daily digest failed:", err instanceof Error ? err.message : err);
      captureException(err instanceof Error ? err : new Error(String(err)), {
        tags: { service: "scheduler", phase: "daily-digest" },
      });
    }
  });

  // Weekly digest — Monday 7:00 AM MT (13:00 UTC)
  cron.schedule("0 13 * * 1", async () => {
    console.log("📬 Weekly digest triggered");
    try {
      await sendDigestNotifications("weekly_digest");
    } catch (err) {
      console.error("❌ Weekly digest failed:", err instanceof Error ? err.message : err);
      captureException(err instanceof Error ? err : new Error(String(err)), {
        tags: { service: "scheduler", phase: "weekly-digest" },
      });
    }
  });
}

/**
 * Refresh all active watched cases by running targeted searches against utcourts.gov.
 * This replaces the old bulk scrape — only fetches data relevant to users' saved searches.
 */
export async function refreshAllWatchedCases(): Promise<{
  casesChecked: number;
  totalEvents: number;
  totalNewEntries: number;
  totalChanges: number;
}> {
  if (isRunning) {
    console.warn("⚠️ Refresh already running — skipping");
    return { casesChecked: 0, totalEvents: 0, totalNewEntries: 0, totalChanges: 0 };
  }

  isRunning = true;
  const pool = getPool();
  if (!pool) {
    isRunning = false;
    return { casesChecked: 0, totalEvents: 0, totalNewEntries: 0, totalChanges: 0 };
  }

  try {
    console.log("🔄 Starting watched-case refresh...");

    const client = await pool.connect();
    let watchedCases: WatchedCaseRow[];
    try {
      const result = await client.query<WatchedCaseRow>(
        `SELECT id, user_id, search_type, search_value, label
         FROM watched_cases WHERE is_active = true`
      );
      watchedCases = result.rows;
    } finally {
      client.release();
    }

    if (watchedCases.length === 0) {
      console.log("📭 No active watched cases — nothing to refresh");
      isRunning = false;
      return { casesChecked: 0, totalEvents: 0, totalNewEntries: 0, totalChanges: 0 };
    }

    console.log(`🔍 Refreshing ${watchedCases.length} active watched cases...`);

    let totalEvents = 0;
    let totalNewEntries = 0;
    let totalChanges = 0;

    // Shuffle the order so the same cases don't always run first
    const shuffled = [...watchedCases].sort(() => Math.random() - 0.5);

    for (const wc of shuffled) {
      try {
        const result = await runWatchedCaseSearch(wc.id);
        totalEvents += result.eventsFound;
        totalNewEntries += result.newEntries;
        totalChanges += result.changes;

        // Random delay between 3-15s per search to spread load on utcourts.gov
        const gap = 3000 + Math.floor(Math.random() * 12000);
        await new Promise((r) => setTimeout(r, gap));
      } catch (err) {
        console.error(`❌ Refresh failed for watched case ${wc.id} (${wc.label}):`, err instanceof Error ? err.message : err);
        captureException(err instanceof Error ? err : new Error(String(err)), {
          tags: { service: "scheduler", watchedCaseId: String(wc.id) },
        });
      }
    }

    console.log(`✅ Refresh complete: ${watchedCases.length} cases, ${totalEvents} events, ${totalNewEntries} new entries, ${totalChanges} changes`);

    captureMessage(
      `Watched-case refresh: ${watchedCases.length} cases, ${totalEvents} events, ${totalNewEntries} new entries`,
      "info",
      { tags: { service: "scheduler" }, extra: { casesChecked: watchedCases.length, totalEvents, totalNewEntries, totalChanges } }
    );

    return { casesChecked: watchedCases.length, totalEvents, totalNewEntries, totalChanges };
  } catch (err) {
    console.error("❌ Refresh job failed:", err);
    captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { service: "scheduler", phase: "refresh" },
    });
    return { casesChecked: 0, totalEvents: 0, totalNewEntries: 0, totalChanges: 0 };
  } finally {
    isRunning = false;
  }
}

/**
 * Insert or update a court event. Returns true if the event changed.
 */
async function upsertCourtEvent(event: ParsedCourtEvent): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;

  const client = await pool.connect();
  try {
    // Look for existing event by case_number + event_date + court name from hearing location
    const existing = await client.query(
      `SELECT * FROM court_events
       WHERE case_number = $1 AND event_date = $2
       LIMIT 1`,
      [event.caseNumber, event.eventDate]
    );

    if (existing.rows.length > 0) {
      const existingRow = existing.rows[0];

      const changes = detectChanges(existingRow, {
        court_room: event.courtRoom,
        event_date: event.eventDate,
        event_time: event.eventTime,
        hearing_type: event.hearingType,
        case_number: event.caseNumber,
        case_type: event.caseType,
        defendant_name: event.defendantName,
        prosecuting_attorney: event.prosecutingAttorney,
        defense_attorney: event.defenseAttorney,
        judge_name: event.judgeName,
        hearing_location: event.hearingLocation,
      } as Record<string, unknown>);

      if (changes.length > 0) {
        await client.query(
          `UPDATE court_events SET
            court_room = $1, event_time = $2, hearing_type = $3,
            case_type = $4, defendant_name = $5, defendant_otn = $6,
            defendant_dob = $7, prosecuting_attorney = $8,
            defense_attorney = $9, citation_number = $10,
            sheriff_number = $11, lea_number = $12,
            content_hash = $13, scraped_at = NOW(), updated_at = NOW(),
            judge_name = $14, hearing_location = $15, is_virtual = $16
          WHERE id = $17`,
          [
            event.courtRoom, event.eventTime, event.hearingType,
            event.caseType, event.defendantName, event.defendantOtn,
            event.defendantDob, event.prosecutingAttorney,
            event.defenseAttorney, event.citationNumber,
            event.sheriffNumber, event.leaNumber,
            event.contentHash, event.judgeName, event.hearingLocation,
            event.isVirtual, existingRow.id,
          ]
        );

        await processChanges(existingRow.id, changes);

        // Re-sync affected calendar entries
        const calEntries = await client.query<{ id: number; user_id: number }>(
          `SELECT id, user_id FROM calendar_entries WHERE court_event_id = $1`,
          [existingRow.id]
        );
        for (const entry of calEntries.rows) {
          try {
            await syncCalendarEntry(entry.id);
          } catch (syncErr) {
            const syncErrMsg = syncErr instanceof Error ? syncErr.message : String(syncErr);
            console.warn(`  ⚠️ Re-sync failed for entry ${entry.id}: ${syncErrMsg}`);
            await createNotification({
              userId: entry.user_id,
              type: "sync_error",
              title: "Calendar sync failed after schedule change",
              message: `A court event changed but failed to update in your calendar: ${syncErrMsg}`,
              metadata: { calendarEntryId: entry.id, courtEventId: existingRow.id, error: syncErrMsg },
            });
          }
        }

        return true;
      }

      return false;
    }

    // Insert new event
    await client.query(
      `INSERT INTO court_events (
        court_type, court_name, court_room, event_date, event_time,
        hearing_type, case_number, case_type, defendant_name,
        defendant_otn, defendant_dob, prosecuting_attorney,
        defense_attorney, citation_number, sheriff_number,
        lea_number, content_hash,
        judge_name, hearing_location, is_virtual
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        "", event.hearingLocation || "", event.courtRoom, event.eventDate,
        event.eventTime, event.hearingType, event.caseNumber,
        event.caseType, event.defendantName, event.defendantOtn,
        event.defendantDob, event.prosecutingAttorney,
        event.defenseAttorney, event.citationNumber,
        event.sheriffNumber, event.leaNumber, event.contentHash,
        event.judgeName, event.hearingLocation, event.isVirtual,
      ]
    );

    return false;
  } finally {
    client.release();
  }
}
