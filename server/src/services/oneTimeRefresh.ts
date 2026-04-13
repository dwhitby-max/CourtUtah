/**
 * One-time refresh of all saved searches.
 *
 * On first startup after deployment, re-runs every active saved search so the
 * new stale-event cleanup logic in persistLiveResults() can purge ghost events.
 *
 * - Processes searches sequentially with a delay between each to respect
 *   utcourts.gov rate limits.
 * - Retries failed searches once after all others complete.
 * - Records completion in `one_time_tasks` so it never runs again.
 */

import { getPool } from "../db/pool";
import { config } from "../config/env";
import jwt from "jsonwebtoken";

const TASK_NAME = "refresh_all_searches_v1";
const DELAY_BETWEEN_SEARCHES_MS = 5_000; // 5 seconds between searches
const RETRY_DELAY_MS = 10_000; // 10 seconds before retrying failures
const REQUEST_TIMEOUT_MS = 120_000; // 2 minutes per search request

interface SavedSearchRow {
  id: number;
  user_id: number;
  email: string;
  search_params: Record<string, string>;
  label: string;
}

const QUERY_MAP: Record<string, string> = {
  defendantName: "defendant_name",
  caseNumber: "case_number",
  courtName: "court_name",
  courtNames: "court_names",
  allCourts: "all_courts",
  courtDate: "court_date",
  dateFrom: "date_from",
  dateTo: "date_to",
  defendantOtn: "defendant_otn",
  citationNumber: "citation_number",
  charges: "charges",
  judgeName: "judge_name",
  attorney: "attorney",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function triggerSearch(
  search: SavedSearchRow,
  baseUrl: string
): Promise<{ ok: boolean; resultsCount?: number; error?: string }> {
  const params = typeof search.search_params === "string"
    ? JSON.parse(search.search_params)
    : search.search_params;

  const queryParams: Record<string, string> = { force_refresh: "true" };
  for (const [jsonKey, queryKey] of Object.entries(QUERY_MAP)) {
    if (params[jsonKey]) queryParams[queryKey] = params[jsonKey];
  }

  // Check there's at least one real search field (not just _key or dates)
  const hasSearchField = !!(
    queryParams.defendant_name || queryParams.case_number ||
    queryParams.defendant_otn || queryParams.citation_number ||
    queryParams.charges || queryParams.judge_name || queryParams.attorney
  );
  if (!hasSearchField) {
    return { ok: true, resultsCount: 0, error: "skipped — no searchable field" };
  }

  const token = jwt.sign(
    { userId: search.user_id, email: search.email },
    config.jwtSecret,
    { expiresIn: "5m" }
  );

  const qs = new URLSearchParams(queryParams).toString();
  const url = `${baseUrl}/api/search?${qs}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    const data = await res.json() as Record<string, unknown>;

    if (!res.ok) {
      return { ok: false, error: String(data.error || `HTTP ${res.status}`) };
    }
    return { ok: true, resultsCount: data.resultsCount as number };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runOneTimeRefresh(): Promise<void> {
  const pool = getPool();
  if (!pool) {
    console.warn("⚠️ One-time refresh: no DB pool — skipping");
    return;
  }

  const client = await pool.connect();
  try {
    // Ensure the table exists (migration may not have run yet)
    await client.query(`
      CREATE TABLE IF NOT EXISTS one_time_tasks (
        task_name VARCHAR(100) PRIMARY KEY,
        completed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        result JSONB
      )
    `);

    // Check if already completed
    const check = await client.query(
      `SELECT 1 FROM one_time_tasks WHERE task_name = $1`,
      [TASK_NAME]
    );
    if (check.rows.length > 0) {
      console.log(`✅ One-time refresh already completed — skipping`);
      return;
    }

    // --- Phase 1: Deduplicate existing court_events ---
    // For each case_number, keep only the most recently updated row per
    // (case_number, event_date, event_time). Delete older duplicates and
    // clean up their calendar entries.
    console.log("🧹 Phase 1: Deduplicating existing court_events...");
    await client.query("BEGIN");

    // Find duplicate groups: same (case_number, event_date, event_time) with multiple rows
    const dupeResult = await client.query<{ case_number: string; event_date: string; event_time: string; cnt: string }>(`
      SELECT case_number, event_date::text, COALESCE(event_time, '') as event_time, COUNT(*) as cnt
      FROM court_events
      GROUP BY case_number, event_date, event_time
      HAVING COUNT(*) > 1
    `);

    let dupesDeleted = 0;
    let dupeCalDeleted = 0;

    for (const dupe of dupeResult.rows) {
      // Keep the most recently updated row, delete the rest
      const rows = await client.query<{ id: number }>(
        `SELECT id FROM court_events
         WHERE case_number = $1 AND event_date = $2 AND COALESCE(event_time, '') = $3
         ORDER BY updated_at DESC`,
        [dupe.case_number, dupe.event_date, dupe.event_time]
      );

      const keepId = rows.rows[0].id;
      const deleteIds = rows.rows.slice(1).map(r => r.id);

      if (deleteIds.length > 0) {
        // Re-point calendar entries from deleted events to the kept event
        // where possible (same user+connection), delete the rest
        const calEntries = await client.query<{ id: number; user_id: number; calendar_connection_id: number }>(
          `SELECT id, user_id, calendar_connection_id FROM calendar_entries
           WHERE court_event_id = ANY($1) AND sync_status NOT IN ('removed')`,
          [deleteIds]
        );

        for (const ce of calEntries.rows) {
          // Check if a calendar entry already exists for this user+connection on the kept event
          const existing = await client.query(
            `SELECT 1 FROM calendar_entries
             WHERE court_event_id = $1 AND user_id = $2 AND calendar_connection_id = $3`,
            [keepId, ce.user_id, ce.calendar_connection_id]
          );

          if (existing.rows.length > 0) {
            // Duplicate — delete from provider and remove
            try {
              const { deleteCalendarEntry } = await import("./calendarSync");
              await deleteCalendarEntry(ce.id, ce.user_id);
              dupeCalDeleted++;
            } catch (err) {
              console.warn(`  ⚠️ Failed to delete duplicate calendar entry ${ce.id}:`, err instanceof Error ? err.message : err);
              // Force-remove the DB row so it doesn't linger
              await client.query(
                `UPDATE calendar_entries SET sync_status = 'removed', external_event_id = NULL, updated_at = NOW() WHERE id = $1`,
                [ce.id]
              );
              dupeCalDeleted++;
            }
          } else {
            // Re-point to the kept event
            await client.query(
              `UPDATE calendar_entries SET court_event_id = $1, updated_at = NOW() WHERE id = $2`,
              [keepId, ce.id]
            );
          }
        }

        // Delete duplicate court_events
        await client.query(`DELETE FROM court_events WHERE id = ANY($1)`, [deleteIds]);
        dupesDeleted += deleteIds.length;
      }
    }

    await client.query("COMMIT");

    if (dupesDeleted > 0 || dupeCalDeleted > 0) {
      console.log(`  🧹 Removed ${dupesDeleted} duplicate event(s), ${dupeCalDeleted} duplicate calendar entry/entries`);
    } else {
      console.log("  ✅ No duplicates found");
    }

    // --- Phase 2: Remove orphaned calendar entries ---
    // Calendar entries pointing to court_events that no longer exist
    const orphanResult = await client.query<{ id: number; user_id: number }>(
      `SELECT ce.id, ce.user_id FROM calendar_entries ce
       LEFT JOIN court_events ev ON ev.id = ce.court_event_id
       WHERE ev.id IS NULL AND ce.sync_status NOT IN ('removed')`
    );

    let orphansDeleted = 0;
    if (orphanResult.rows.length > 0) {
      console.log(`🧹 Removing ${orphanResult.rows.length} orphaned calendar entry/entries...`);
      const { deleteCalendarEntry } = await import("./calendarSync");
      for (const orphan of orphanResult.rows) {
        try {
          await deleteCalendarEntry(orphan.id, orphan.user_id);
          orphansDeleted++;
        } catch {
          await client.query(
            `UPDATE calendar_entries SET sync_status = 'removed', external_event_id = NULL, updated_at = NOW() WHERE id = $1`,
            [orphan.id]
          );
          orphansDeleted++;
        }
      }
      console.log(`  ✅ Cleaned up ${orphansDeleted} orphaned calendar entry/entries`);
    }

    // --- Phase 3: Re-run all saved searches to purge stale events ---
    // Load all active saved searches
    const searchResult = await client.query<SavedSearchRow>(
      `SELECT ss.id, ss.user_id, ss.search_params, ss.label, u.email
       FROM saved_searches ss
       JOIN users u ON u.id = ss.user_id
       WHERE ss.is_active = true AND ss.search_params IS NOT NULL
       ORDER BY ss.user_id, ss.id`
    );

    const searches = searchResult.rows;
    if (searches.length === 0) {
      console.log("✅ One-time refresh: no saved searches to process");
      await client.query(
        `INSERT INTO one_time_tasks (task_name, result) VALUES ($1, $2)`,
        [TASK_NAME, JSON.stringify({
          phase1_dupes_deleted: dupesDeleted,
          phase1_cal_deleted: dupeCalDeleted,
          phase2_orphans_deleted: orphansDeleted,
          phase3_total: 0, phase3_succeeded: 0, phase3_failed: 0,
        })]
      );
      return;
    }

    console.log(`🔄 One-time refresh: processing ${searches.length} saved search(es)...`);

    const baseUrl = `http://localhost:${config.port}`;
    const failed: SavedSearchRow[] = [];
    let succeeded = 0;

    // Process sequentially with delays
    for (let i = 0; i < searches.length; i++) {
      const s = searches[i];
      console.log(`  [${i + 1}/${searches.length}] Search #${s.id}: ${s.label} (userId: ${s.user_id})`);

      const result = await triggerSearch(s, baseUrl);

      if (result.ok) {
        succeeded++;
        console.log(`    ✅ ${result.resultsCount ?? 0} results ${result.error ? `(${result.error})` : ""}`);
      } else {
        failed.push(s);
        console.warn(`    ❌ Failed: ${result.error}`);
      }

      // Delay before next search (skip delay after last one)
      if (i < searches.length - 1) {
        await sleep(DELAY_BETWEEN_SEARCHES_MS);
      }
    }

    // Retry failures once
    let retrySucceeded = 0;
    if (failed.length > 0) {
      console.log(`🔄 Retrying ${failed.length} failed search(es) after ${RETRY_DELAY_MS / 1000}s...`);
      await sleep(RETRY_DELAY_MS);

      for (let i = 0; i < failed.length; i++) {
        const s = failed[i];
        console.log(`  [retry ${i + 1}/${failed.length}] Search #${s.id}: ${s.label}`);

        const result = await triggerSearch(s, baseUrl);

        if (result.ok) {
          retrySucceeded++;
          console.log(`    ✅ Retry succeeded: ${result.resultsCount ?? 0} results`);
        } else {
          console.warn(`    ❌ Retry failed: ${result.error}`);
        }

        if (i < failed.length - 1) {
          await sleep(DELAY_BETWEEN_SEARCHES_MS);
        }
      }
    }

    const totalSucceeded = succeeded + retrySucceeded;
    const totalFailed = failed.length - retrySucceeded;

    const summary = {
      phase1_dupes_deleted: dupesDeleted,
      phase1_cal_deleted: dupeCalDeleted,
      phase2_orphans_deleted: orphansDeleted,
      phase3_total: searches.length,
      phase3_succeeded: totalSucceeded,
      phase3_failed: totalFailed,
      phase3_retried: retrySucceeded,
    };

    // Mark as complete so it never runs again
    await client.query(
      `INSERT INTO one_time_tasks (task_name, result) VALUES ($1, $2)`,
      [TASK_NAME, JSON.stringify(summary)]
    );

    console.log(`✅ One-time refresh complete: ${totalSucceeded}/${searches.length} succeeded, ${totalFailed} failed`);
  } catch (err) {
    console.error("❌ One-time refresh failed:", err instanceof Error ? err.message : err);
  } finally {
    client.release();
  }
}
