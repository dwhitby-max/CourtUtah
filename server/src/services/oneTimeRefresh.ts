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
        [TASK_NAME, JSON.stringify({ total: 0, succeeded: 0, failed: 0 })]
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
      console.log(`  [${i + 1}/${searches.length}] Search #${s.id}: ${s.label} (user: ${s.email})`);

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
      total: searches.length,
      succeeded: totalSucceeded,
      failed: totalFailed,
      retriedSuccessfully: retrySucceeded,
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
