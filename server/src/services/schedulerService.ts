import cron from "node-cron";
import { getPool } from "../db/pool";
import { liveSearchUtcourts, LiveSearchParams } from "./courtScraper";
import { parseHtmlCalendarResults, ParsedCourtEvent } from "./courtEventParser";
import { detectChanges, processChanges } from "./changeDetector";
import { syncCalendarEntry } from "./calendarSync";
import { captureException, captureMessage } from "./sentryService";
import { createNotification } from "./notificationService";
import { sendDigestNotifications } from "./digestService";
import { sendDailySummaryEmail, DailySummaryItem } from "./emailService";

/**
 * Per-user accumulator for daily summary emails.
 * Collects all changes/cancellations/new matches during the refresh cycle,
 * then sends ONE consolidated email per user at the end.
 */
const dailySummary = new Map<number, { email: string; items: DailySummaryItem[] }>();

function addSummaryItem(userId: number, email: string, item: DailySummaryItem): void {
  const existing = dailySummary.get(userId);
  if (existing) {
    existing.items.push(item);
  } else {
    dailySummary.set(userId, { email, items: [item] });
  }
}

let isRunning = false;

export interface WatchedCaseRow {
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

/**
 * Map a watched case's search_type + search_value to LiveSearchParams
 * for the utcourts.gov search.php endpoint (without date — dates are
 * searched individually for complete coverage).
 *
 * Returns null if the search type can't be mapped to a live search
 * (e.g. court_date, citation_number, defendant_otn — these only work
 * as local DB filters after results are fetched).
 */
function watchedCaseToLiveParams(wc: WatchedCaseRow): LiveSearchParams | null {
  // search_watch type: use stored search_params to reconstruct the original search
  if (wc.search_type === "search_watch" && wc.search_params) {
    return searchParamsToLiveParams(wc.search_params);
  }

  switch (wc.search_type) {
    case "defendant_name":
      return { partyName: wc.search_value };
    case "case_number":
      return { caseNumber: wc.search_value };
    case "judge_name":
      return { judgeName: wc.search_value };
    case "attorney": {
      const parts = wc.search_value.trim().split(/\s+/);
      if (parts.length >= 2) {
        return {
          attorneyFirstName: parts.slice(0, -1).join(" "),
          attorneyLastName: parts[parts.length - 1],
        };
      }
      return { attorneyLastName: parts[0] };
    }
    default:
      // court_name, court_date, defendant_otn, citation_number
      // can't be directly searched via utcourts — need a primary search field
      return null;
  }
}

/**
 * Convert stored search params (from the UI search form) to LiveSearchParams.
 * Picks the primary search field that utcourts.gov requires, stripping dates
 * since watched searches always search all available dates (up to 4 weeks).
 */
function searchParamsToLiveParams(params: Record<string, string>): LiveSearchParams | null {
  const p: LiveSearchParams = {};

  // Map stored params to live search params — priority order matches utcourts.gov
  if (params.case_number || params.caseNumber) {
    p.caseNumber = params.case_number || params.caseNumber;
  } else if (params.defendant_name || params.defendantName) {
    p.partyName = params.defendant_name || params.defendantName;
  } else if (params.judge_name || params.judgeName) {
    p.judgeName = params.judge_name || params.judgeName;
  } else if (params.attorney) {
    const parts = params.attorney.trim().split(/\s+/);
    if (parts.length >= 2) {
      p.attorneyFirstName = parts.slice(0, -1).join(" ");
      p.attorneyLastName = parts[parts.length - 1];
    } else {
      p.attorneyLastName = parts[0];
    }
  } else {
    // No searchable field — can't query utcourts.gov
    return null;
  }

  return p;
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
      `SELECT id, user_id, search_type, search_value, label, monitor_changes, auto_add_new, search_params, COALESCE(source, 'manual') as source
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

    // Single request to utcourts.gov with loc=all — works for all search types
    const allParsed: ParsedCourtEvent[] = [];
    console.log(`🔍 Searching utcourts.gov for watched case ${wc.id}: ${wc.search_type}="${wc.search_value}"`);
    try {
      const html = await liveSearchUtcourts({ ...liveParams, date: "all", locationCode: "all" });
      allParsed.push(...parseHtmlCalendarResults(html));
    } catch (err) {
      console.warn(`  ⚠️ Search failed: ${err instanceof Error ? err.message : err}`);
    }

    // Update last_refreshed_at even if no results
    await client.query(
      `UPDATE watched_cases SET last_refreshed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [wc.id]
    );

    if (allParsed.length === 0) {
      console.log(`  📭 No results for "${wc.label}"`);
      return { eventsFound: 0, newEntries: 0, changes: 0 };
    }

    console.log(`  📋 Found ${allParsed.length} events for "${wc.label}"`);

    let changes = 0;

    // Upsert each event to court_events
    for (const event of allParsed) {
      const changed = await upsertCourtEvent(event);
      if (changed) changes++;
    }

    // Only auto-create calendar entries for new events if user opted in
    const newEntries = wc.auto_add_new
      ? await createCalendarEntriesForWatchedCase(wc, client)
      : 0;

    // Detect cancellations: future DB events matching this watched case that
    // are NOT in the scraped results may have been cancelled on the court side
    const cancellations = await detectCancelledEvents(wc, allParsed, client);

    return { eventsFound: allParsed.length, newEntries, changes: changes + cancellations };
  } finally {
    client.release();
  }
}

/**
 * Detect events that previously matched this watched case but no longer appear
 * in scrape results. These are likely cancelled or rescheduled hearings.
 * Marks them as cancelled, updates the user's calendar, and notifies the user.
 */
async function detectCancelledEvents(
  wc: WatchedCaseRow,
  scrapedEvents: ParsedCourtEvent[],
  client: { query: <T = Record<string, unknown>>(q: string, p?: unknown[]) => Promise<{ rows: T[] }> }
): Promise<number> {
  // Build a set of scraped event identifiers (case_number + date + time)
  const scrapedKeys = new Set(
    scrapedEvents.map(e => `${e.caseNumber}|${e.eventDate}|${e.eventTime}`)
  );

  // Find future court_events in DB that match this watched case's criteria
  const { whereClause, searchVal } = buildWhereClause(wc);
  const dbEvents = await client.query<{
    id: number; case_number: string; event_date: string; event_time: string;
    defendant_name: string; court_name: string; hearing_type: string;
    is_cancelled: boolean;
  }>(
    `SELECT id, case_number, event_date, event_time, defendant_name,
            court_name, hearing_type, COALESCE(is_cancelled, false) as is_cancelled
     FROM court_events
     WHERE ${whereClause}
       AND event_date >= CURRENT_DATE
       AND COALESCE(is_cancelled, false) = false`,
    [searchVal]
  );

  if (dbEvents.rows.length === 0) return 0;

  let cancelled = 0;
  for (const dbEvent of dbEvents.rows) {
    const rawDate = dbEvent.event_date as unknown;
    const dateStr = rawDate instanceof Date
      ? rawDate.toISOString().split("T")[0]
      : typeof rawDate === "string" ? rawDate.split("T")[0] : String(rawDate);
    const key = `${dbEvent.case_number}|${dateStr}|${dbEvent.event_time}`;

    if (!scrapedKeys.has(key)) {
      // This event was in DB but not in scrape results — likely cancelled
      await client.query(
        `UPDATE court_events SET is_cancelled = true, cancelled_detected_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [dbEvent.id]
      );

      // Find and update any calendar entries tracking this event
      const calEntries = await client.query<{ id: number; user_id: number }>(
        `SELECT ce.id, ce.user_id FROM calendar_entries ce
         WHERE ce.court_event_id = $1 AND ce.sync_status NOT IN ('removed')`,
        [dbEvent.id]
      );

      for (const entry of calEntries.rows) {
        // Create in-app notification (no immediate email — batched into daily summary)
        await createNotification({
          userId: entry.user_id,
          type: "event_cancelled",
          title: `Hearing may be cancelled: ${dbEvent.defendant_name || dbEvent.case_number}`,
          message: `A hearing for ${dbEvent.defendant_name || "Unknown"} (${dbEvent.case_number}) on ${dateStr} at ${dbEvent.event_time || "TBD"} at ${dbEvent.court_name} no longer appears on the court calendar. It may have been cancelled or rescheduled. Your calendar has been updated.`,
          metadata: {
            courtEventId: dbEvent.id,
            calendarEntryId: entry.id,
            caseNumber: dbEvent.case_number,
            defendantName: dbEvent.defendant_name,
            eventDate: dateStr,
            eventTime: dbEvent.event_time,
            courtName: dbEvent.court_name,
            _skipEmail: true,
          },
        });

        // Collect for daily summary email
        const userRow = await client.query<{ email: string }>(
          "SELECT email FROM users WHERE id = $1", [entry.user_id]
        );
        if (userRow.rows.length > 0) {
          addSummaryItem(entry.user_id, userRow.rows[0].email, {
            type: "cancellation",
            caseName: dbEvent.defendant_name || dbEvent.case_number,
            caseNumber: dbEvent.case_number,
            defendant: dbEvent.defendant_name || "",
            date: dateStr,
            time: dbEvent.event_time || "",
            court: dbEvent.court_name || "",
            calendarSynced: true,
          });
        }
      }

      cancelled++;
      console.log(`  🚫 Event likely cancelled: ${dbEvent.case_number} on ${dateStr} at ${dbEvent.event_time}`);
    }
  }

  if (cancelled > 0) {
    console.log(`  🚫 Detected ${cancelled} potentially cancelled event(s) for "${wc.label}"`);
  }

  return cancelled;
}

/**
 * After upserting events, find matching court_events for this watched case
 * and create calendar_entries for any new matches.
 */
export async function createCalendarEntriesForWatchedCase(
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
    `SELECT id FROM court_events WHERE ${whereClause} AND event_date >= CURRENT_DATE AND COALESCE(is_cancelled, false) = false`,
    [searchVal]
  );

  if (eventsResult.rows.length === 0) return 0;

  let created = 0;
  for (const calConn of calResult.rows) {
    for (const event of eventsResult.rows) {
      // Check if ANY entry already exists for this user + event + connection
      // (regardless of watched_case_id) to prevent duplicate calendar events.
      // Also respects 'removed' status — user explicitly removed it, don't re-add.
      const existing = await client.query<{ id: number; watched_case_id: number | null; sync_status: string }>(
        `SELECT id, watched_case_id, sync_status FROM calendar_entries
         WHERE user_id = $1 AND court_event_id = $2 AND calendar_connection_id = $3
         LIMIT 1`,
        [wc.user_id, event.id, calConn.id]
      );

      if (existing.rows.length > 0) {
        // If user explicitly removed this entry, don't re-add
        if (existing.rows[0].sync_status === "removed") continue;
        // Entry exists — if unlinked (manual add), attach the watched case
        if (existing.rows[0].watched_case_id === null) {
          await client.query(
            `UPDATE calendar_entries SET watched_case_id = $1, updated_at = NOW() WHERE id = $2`,
            [wc.id, existing.rows[0].id]
          );
        }
        continue;
      }

      // No entry exists — create a new one
      let entryId: number;
      const insertResult = await client.query<{ id: number }>(
        `INSERT INTO calendar_entries (user_id, watched_case_id, court_event_id, calendar_connection_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [wc.user_id, wc.id, event.id, calConn.id]
      );
      entryId = insertResult.rows[0].id;
      created++;

      try {
        await syncCalendarEntry(entryId);
      } catch (syncErr) {
        const syncErrMsg = syncErr instanceof Error ? syncErr.message : String(syncErr);
        console.warn(`  ⚠️ Sync failed for entry ${entryId}: ${syncErrMsg}`);
        await createNotification({
          userId: wc.user_id,
          type: "sync_error",
          title: `Calendar sync failed for "${wc.label}"`,
          message: `Failed to sync a court event to your calendar: ${syncErrMsg}`,
          metadata: {
            calendarEntryId: entryId,
            watchedCaseId: wc.id,
            error: syncErrMsg,
          },
        });
      }
    }
  }

  if (created > 0) {
    // Fetch event details for the email template
    const matchedDetails = await client.query<{
      event_date: string; event_time: string; court_name: string; hearing_type: string;
    }>(
      `SELECT event_date, event_time, court_name, hearing_type
       FROM court_events WHERE ${whereClause} AND event_date >= CURRENT_DATE AND COALESCE(is_cancelled, false) = false`,
      [searchVal]
    );
    const matchedEvents = matchedDetails.rows.map(r => {
      const rawDate = r.event_date as unknown;
      const dateStr = rawDate instanceof Date ? rawDate.toISOString().split("T")[0] : String(r.event_date).split("T")[0];
      return { date: dateStr, time: r.event_time, court: r.court_name, hearingType: r.hearing_type };
    });

    await createNotification({
      userId: wc.user_id,
      type: "new_match",
      title: `New matches for "${wc.label}"`,
      message: `Found ${created} new court event${created !== 1 ? "s" : ""} matching your search "${wc.label}". Calendar entries have been created automatically.`,
      metadata: {
        watchedCaseId: wc.id,
        searchType: wc.search_type,
        searchValue: wc.search_value,
        matchedEvents,
      },
    });
  }

  return created;
}

/**
 * Build a WHERE clause for matching a watched case against court_events.
 */
function buildWhereClause(wc: WatchedCaseRow): { whereClause: string; searchVal: string } {
  // search_watch: use the primary search field from stored search_params
  if (wc.search_type === "search_watch" && wc.search_params) {
    const p = wc.search_params;
    if (p.attorney) {
      return {
        whereClause: `(UPPER(prosecuting_attorney) LIKE $1 OR UPPER(defense_attorney) LIKE $1)`,
        searchVal: `%${p.attorney.toUpperCase()}%`,
      };
    }
    if (p.defendant_name || p.defendantName) {
      const val = (p.defendant_name || p.defendantName).toUpperCase();
      return { whereClause: `UPPER(defendant_name) LIKE $1`, searchVal: `%${val}%` };
    }
    if (p.case_number || p.caseNumber) {
      const val = (p.case_number || p.caseNumber).toUpperCase();
      return { whereClause: `UPPER(case_number) LIKE $1`, searchVal: `%${val}%` };
    }
    if (p.judge_name || p.judgeName) {
      const val = (p.judge_name || p.judgeName).toUpperCase();
      return { whereClause: `UPPER(judge_name) LIKE $1`, searchVal: `%${val}%` };
    }
    // Fallback: use search_value as defendant name
    return { whereClause: `UPPER(defendant_name) LIKE $1`, searchVal: `%${wc.search_value.toUpperCase()}%` };
  }

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

  // Daily cleanup — 12:30 UTC (~6:30 AM MT), after refresh completes
  // Deactivates watched cases with only past events, marks past calendar entries as completed
  cron.schedule("30 12 * * *", async () => {
    console.log("🧹 Daily past-event cleanup triggered");
    try {
      await cleanupPastEvents();
    } catch (err) {
      console.error("❌ Past event cleanup failed:", err instanceof Error ? err.message : err);
    }
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
        `SELECT id, user_id, search_type, search_value, label, monitor_changes, auto_add_new, search_params, COALESCE(source, 'manual') as source
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

    // Deduplicate: group watched cases by search key so we only hit utcourts.gov
    // once per unique search (e.g. multiple users watching the same defendant)
    const deduped = new Map<string, WatchedCaseRow[]>();
    for (const wc of watchedCases) {
      const key = `${wc.search_type}:${wc.search_value.toUpperCase().trim()}`;
      const group = deduped.get(key) || [];
      group.push(wc);
      deduped.set(key, group);
    }

    const uniqueSearches = [...deduped.values()].map((group) => group[0]);
    console.log(`  📊 ${watchedCases.length} watched cases → ${uniqueSearches.length} unique searches`);

    // Run searches in batches with adaptive delays.
    // Starts with 3s between batches, increases on failures, resets on clean batches.
    const BATCH_SIZE = 3;
    const BASE_DELAY_MS = 3000;
    const MAX_DELAY_MS = 60000;
    let currentDelay = BASE_DELAY_MS;
    let consecutiveFailedBatches = 0;
    const shuffled = [...uniqueSearches].sort(() => Math.random() - 0.5);

    for (let i = 0; i < shuffled.length; i += BATCH_SIZE) {
      // If too many consecutive failures, abort remaining searches
      if (consecutiveFailedBatches >= 3) {
        console.error(`🛑 Aborting refresh — ${consecutiveFailedBatches} consecutive batch failures (likely rate limited)`);
        captureMessage(
          `Refresh aborted after ${consecutiveFailedBatches} consecutive batch failures`,
          "warning",
          { tags: { service: "scheduler" } }
        );
        break;
      }

      const batch = shuffled.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (wc) => {
          const result = await runWatchedCaseSearch(wc.id);
          // Also update last_refreshed_at for duplicate watched cases
          const key = `${wc.search_type}:${wc.search_value.toUpperCase().trim()}`;
          const group = deduped.get(key) || [];
          if (group.length > 1) {
            const otherIds = group.filter((g) => g.id !== wc.id).map((g) => g.id);
            if (otherIds.length > 0) {
              const pool2 = getPool();
              if (pool2) {
                const c = await pool2.connect();
                try {
                  await c.query(
                    `UPDATE watched_cases SET last_refreshed_at = NOW(), updated_at = NOW()
                     WHERE id = ANY($1)`,
                    [otherIds]
                  );
                } finally {
                  c.release();
                }
              }
            }
          }
          return result;
        })
      );

      let batchFailed = false;
      for (const r of results) {
        if (r.status === "fulfilled") {
          totalEvents += r.value.eventsFound;
          totalNewEntries += r.value.newEntries;
          totalChanges += r.value.changes;
        } else {
          batchFailed = true;
          const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
          console.error(`❌ Refresh failed:`, errMsg);
          captureException(r.reason instanceof Error ? r.reason : new Error(String(r.reason)), {
            tags: { service: "scheduler" },
          });
        }
      }

      // Adaptive delay: back off on failures, reset on success
      if (batchFailed) {
        consecutiveFailedBatches++;
        currentDelay = Math.min(currentDelay * 2, MAX_DELAY_MS);
        console.warn(`⚠️ Batch had failures — increasing delay to ${Math.round(currentDelay / 1000)}s (${consecutiveFailedBatches} consecutive)`);
      } else {
        consecutiveFailedBatches = 0;
        currentDelay = Math.max(currentDelay * 0.75, BASE_DELAY_MS);
      }

      // Pause between batches
      if (i + BATCH_SIZE < shuffled.length) {
        await new Promise((r) => setTimeout(r, currentDelay));
      }
    }

    console.log(`✅ Refresh complete: ${watchedCases.length} cases, ${totalEvents} events, ${totalNewEntries} new entries, ${totalChanges} changes`);

    // Send one consolidated daily summary email per user
    if (dailySummary.size > 0) {
      console.log(`📧 Sending daily summary emails to ${dailySummary.size} user(s)...`);
      for (const [userId, { email, items }] of dailySummary) {
        try {
          await sendDailySummaryEmail(email, items);
          console.log(`  ✅ Summary email sent to ${email}: ${items.length} item(s)`);
        } catch (err) {
          console.warn(`  ⚠️ Summary email failed for user ${userId}:`, err instanceof Error ? err.message : err);
        }
      }
      dailySummary.clear();
    }

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
    dailySummary.clear();
    isRunning = false;
  }
}

/**
 * Deactivate watched cases and calendar entries for events that have passed.
 * Uses Mountain Time (America/Denver) as the reference timezone since all
 * Utah court events are in Mountain Time.
 */
export async function cleanupPastEvents(): Promise<{ deactivatedCases: number; completedEntries: number }> {
  const pool = getPool();
  if (!pool) return { deactivatedCases: 0, completedEntries: 0 };

  const client = await pool.connect();
  try {
    // Mark calendar entries as 'completed' for events that have passed (Mountain Time)
    const entriesResult = await client.query(
      `UPDATE calendar_entries ce
       SET sync_status = 'completed', updated_at = NOW()
       FROM court_events ev
       WHERE ce.court_event_id = ev.id
         AND ce.sync_status IN ('synced', 'pending', 'pending_update')
         AND ev.event_date < (NOW() AT TIME ZONE 'America/Denver')::date`
    );
    const completedEntries = entriesResult.rowCount || 0;

    // Deactivate auto_search watched cases where ALL associated court events are in the past.
    // A watched case is "expired" if it has no future events AND at least one past event.
    // Manual watched cases are kept active (user may want ongoing monitoring).
    const casesResult = await client.query(
      `UPDATE watched_cases wc
       SET is_active = false, updated_at = NOW()
       WHERE wc.is_active = true
         AND wc.source = 'auto_search'
         AND NOT EXISTS (
           SELECT 1 FROM calendar_entries ce
           JOIN court_events ev ON ev.id = ce.court_event_id
           WHERE ce.watched_case_id = wc.id
             AND ev.event_date >= (NOW() AT TIME ZONE 'America/Denver')::date
         )
         AND EXISTS (
           SELECT 1 FROM calendar_entries ce
           JOIN court_events ev ON ev.id = ce.court_event_id
           WHERE ce.watched_case_id = wc.id
             AND ev.event_date < (NOW() AT TIME ZONE 'America/Denver')::date
         )`
    );
    const deactivatedCases = casesResult.rowCount || 0;

    if (completedEntries > 0 || deactivatedCases > 0) {
      console.log(`🧹 Cleanup: ${completedEntries} calendar entries completed, ${deactivatedCases} watched cases deactivated`);
    }

    return { deactivatedCases, completedEntries };
  } catch (err) {
    console.error("❌ Past event cleanup failed:", err instanceof Error ? err.message : err);
    return { deactivatedCases: 0, completedEntries: 0 };
  } finally {
    client.release();
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
    // Look for existing event by case_number + event_date + event_time
    // Including event_time prevents collapsing separate hearings for the
    // same case at different times on the same day (e.g. 9:00 AM vs 10:30 AM)
    const existing = await client.query(
      `SELECT * FROM court_events
       WHERE case_number = $1 AND event_date = $2 AND COALESCE(event_time, '') = COALESCE($3, '')
       LIMIT 1`,
      [event.caseNumber, event.eventDate, event.eventTime]
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

        // Auto-sync affected calendar entries and notify users of changes
        // Only auto-sync entries linked to watched cases with monitor_changes enabled,
        // or entries not linked to any watched case (manually added by user)
        const calEntries = await client.query<{ id: number; user_id: number; watched_case_id: number | null; monitor_changes: boolean | null }>(
          `SELECT ce.id, ce.user_id, ce.watched_case_id, wc.monitor_changes
           FROM calendar_entries ce
           LEFT JOIN watched_cases wc ON wc.id = ce.watched_case_id
           WHERE ce.court_event_id = $1`,
          [existingRow.id]
        );
        for (const entry of calEntries.rows) {
          // Skip auto-sync if this entry is from a watched case that didn't opt into change monitoring
          const shouldAutoSync = entry.watched_case_id === null || entry.monitor_changes === true;
          if (!shouldAutoSync) continue;

          // Set to pending so syncCalendarEntry will push the updated data
          await client.query(
            `UPDATE calendar_entries SET sync_status = 'pending', last_synced_content_hash = NULL, updated_at = NOW() WHERE id = $1`,
            [entry.id]
          );

          // Auto-sync the calendar entry with updated event data
          let synced = false;
          try {
            synced = await syncCalendarEntry(entry.id);
          } catch (syncErr) {
            console.warn(`⚠️  Auto-sync failed for entry ${entry.id}:`, syncErr instanceof Error ? syncErr.message : syncErr);
          }

          const changeDescription = changes.map(c => `${c.field}: "${c.oldValue}" → "${c.newValue}"`).join(", ");
          const caseName = event.defendantName || event.caseNumber || "Court Hearing";

          // Create in-app notification (no immediate email — batched into daily summary)
          await createNotification({
            userId: entry.user_id,
            type: "schedule_change",
            title: `Schedule Change: ${caseName}`,
            message: `Changes detected and ${synced ? "your calendar has been updated automatically" : "calendar update is pending"}. Changes: ${changeDescription}`,
            metadata: {
              calendarEntryId: entry.id,
              courtEventId: existingRow.id,
              caseNumber: event.caseNumber,
              defendantName: event.defendantName,
              changes,
              autoSynced: synced,
              _skipEmail: true,  // Signal to skip immediate email — daily summary handles it
            },
          });

          // Collect for daily summary email
          const userRow = await client.query<{ email: string }>(
            "SELECT email FROM users WHERE id = $1", [entry.user_id]
          );
          if (userRow.rows.length > 0) {
            addSummaryItem(entry.user_id, userRow.rows[0].email, {
              type: "change",
              caseName,
              caseNumber: event.caseNumber || "",
              defendant: event.defendantName || "",
              date: event.eventDate || "",
              time: event.eventTime || "",
              court: event.hearingLocation || "",
              calendarSynced: synced,
              changes,
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
