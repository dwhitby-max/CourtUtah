/**
 * Daily refresh of all active saved searches.
 *
 * Runs once per day via cron. For each active saved search:
 * 1. Sets last_scrape_had_failures = true so the search route honors force_refresh
 * 2. Triggers the search via internal HTTP (same as admin trigger)
 * 3. The search route scrapes utcourts.gov, detects changes, persists results,
 *    and cleans up stale events
 *
 * This is the system's primary mechanism for detecting new hearings, schedule
 * changes, and removed events. Courts update once daily (~5:30 AM MT), so
 * running this cron once per day is sufficient. The scheduler fires at 6:00 AM
 * MT (jittered 0–30 min) to guarantee we scrape AFTER the court update window.
 *
 * To avoid looking like automated bot traffic:
 * - Searches are shuffled into random order each day
 * - Delays between searches are randomized (8–45 seconds)
 * - Retry delays are also randomized
 */

import { getPool } from "../db/pool";
import { config } from "../config/env";
import jwt from "jsonwebtoken";
import { captureException } from "./sentryService";

// Randomized delays so traffic doesn't look like a bot running cron jobs
const MIN_DELAY_MS = 8_000;   // min 8s between searches
const MAX_DELAY_MS = 45_000;  // max 45s between searches
const RETRY_MIN_DELAY_MS = 30_000;  // min 30s before retry round
const RETRY_MAX_DELAY_MS = 90_000;  // max 90s before retry round
const REQUEST_TIMEOUT_MS = 120_000;  // 2 min per search

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

/** Random integer between min and max (inclusive). */
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Fisher-Yates shuffle — returns a new array in random order. */
function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function triggerSearch(
  search: SavedSearchRow,
  baseUrl: string
): Promise<{ ok: boolean; resultsCount?: number; changes?: number; error?: string }> {
  const params = typeof search.search_params === "string"
    ? JSON.parse(search.search_params)
    : search.search_params;

  const queryParams: Record<string, string> = { force_refresh: "true" };
  for (const [jsonKey, queryKey] of Object.entries(QUERY_MAP)) {
    if (params[jsonKey]) queryParams[queryKey] = params[jsonKey];
  }

  // Must have at least one real search field
  const hasSearchField = !!(
    queryParams.defendant_name || queryParams.case_number ||
    queryParams.defendant_otn || queryParams.citation_number ||
    queryParams.charges || queryParams.judge_name || queryParams.attorney
  );
  if (!hasSearchField) {
    return { ok: true, resultsCount: 0, error: "skipped — no searchable field" };
  }

  // Must include issuer/audience claims — authenticateToken verifies them and
  // rejects tokens that lack them, which would silently 401 every cron request.
  const token = jwt.sign(
    { userId: search.user_id, email: search.email },
    config.jwtSecret,
    { expiresIn: "5m", issuer: "courttracker", audience: "courttracker-app" }
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
    const changes = Array.isArray(data.detectedChanges) ? data.detectedChanges.length : 0;
    return { ok: true, resultsCount: data.resultsCount as number, changes };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runDailyRefresh(): Promise<void> {
  const pool = getPool();
  if (!pool) {
    console.warn("⚠️ Daily refresh: no DB pool — skipping");
    return;
  }

  const startTime = Date.now();
  console.log("🔄 Daily refresh: starting...");

  const client = await pool.connect();
  try {
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
      console.log("✅ Daily refresh: no active saved searches");
      return;
    }

    // Shuffle order each day so the same user/search isn't always first
    const shuffled = shuffle(searches);
    console.log(`🔄 Daily refresh: processing ${shuffled.length} saved search(es) in randomized order...`);

    // Mark all searches as having failures so force_refresh is honored.
    // The search route will overwrite this with the real outcome when done.
    const searchIds = shuffled.map((s) => s.id);
    await client.query(
      `UPDATE saved_searches SET last_scrape_had_failures = true WHERE id = ANY($1)`,
      [searchIds]
    );

    // Release the DB connection during the long scrape phase
    client.release();

    const baseUrl = `http://localhost:${config.port}`;
    const failed: SavedSearchRow[] = [];
    let succeeded = 0;
    let totalChanges = 0;

    for (let i = 0; i < shuffled.length; i++) {
      const s = shuffled[i];
      console.log(`  [${i + 1}/${shuffled.length}] Search #${s.id}: ${s.label} (user: ${s.email})`);

      const result = await triggerSearch(s, baseUrl);

      if (result.ok) {
        succeeded++;
        totalChanges += result.changes || 0;
        const extra = [
          `${result.resultsCount ?? 0} results`,
          result.changes ? `${result.changes} change(s)` : null,
          result.error || null,
        ].filter(Boolean).join(", ");
        console.log(`    ✅ ${extra}`);
      } else {
        failed.push(s);
        console.warn(`    ❌ Failed: ${result.error}`);
      }

      // Random delay before next search — varies each time
      if (i < shuffled.length - 1) {
        const delay = randomDelay(MIN_DELAY_MS, MAX_DELAY_MS);
        console.log(`    ⏳ Waiting ${(delay / 1000).toFixed(0)}s before next search...`);
        await sleep(delay);
      }
    }

    // Retry failures once after a random pause
    let retrySucceeded = 0;
    if (failed.length > 0) {
      const retryPause = randomDelay(RETRY_MIN_DELAY_MS, RETRY_MAX_DELAY_MS);
      console.log(`🔄 Retrying ${failed.length} failed search(es) after ${(retryPause / 1000).toFixed(0)}s pause...`);
      await sleep(retryPause);

      // Shuffle retries too
      const shuffledRetries = shuffle(failed);
      for (let i = 0; i < shuffledRetries.length; i++) {
        const s = shuffledRetries[i];
        console.log(`  [retry ${i + 1}/${shuffledRetries.length}] Search #${s.id}: ${s.label}`);

        const result = await triggerSearch(s, baseUrl);

        if (result.ok) {
          retrySucceeded++;
          totalChanges += result.changes || 0;
          console.log(`    ✅ Retry succeeded: ${result.resultsCount ?? 0} results`);
        } else {
          console.warn(`    ❌ Retry failed: ${result.error}`);
        }

        if (i < shuffledRetries.length - 1) {
          const delay = randomDelay(MIN_DELAY_MS, MAX_DELAY_MS);
          await sleep(delay);
        }
      }
    }

    const totalSucceeded = succeeded + retrySucceeded;
    const totalFailed = failed.length - retrySucceeded;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(
      `✅ Daily refresh complete in ${elapsed}s: ${totalSucceeded}/${shuffled.length} succeeded, ` +
      `${totalFailed} failed, ${totalChanges} change(s) detected`
    );

    if (totalFailed > 0) {
      const failedLabels = failed.slice(0, 5).map((s) => `#${s.id} ${s.label}`).join("; ");
      console.warn(`⚠️ Failed searches: ${failedLabels}${failed.length > 5 ? ` and ${failed.length - 5} more` : ""}`);
    }
    return; // client already released above
  } catch (err) {
    console.error("❌ Daily refresh failed:", err instanceof Error ? err.message : err);
    captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { service: "daily-refresh" },
    });
  } finally {
    // client.release() may have already been called — pool handles double-release gracefully
    try { client.release(); } catch { /* already released */ }
  }
}
