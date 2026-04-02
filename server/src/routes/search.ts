import { Router, Request, Response } from "express";
import { heavyLimiter } from "../middleware/rateLimiter";
import { authenticateToken } from "../middleware/auth";
import { searchCourtEvents } from "../services/searchService";
import { liveSearchUtcourts, fetchCourtList, CourtInfo } from "../services/courtScraper";
import { parseHtmlCalendarResults, ParsedCourtEvent } from "../services/courtEventParser";
import { DetectedChange } from "@shared/types";
import { getPool } from "../db/pool";
import {
  toLiveSearchBase,
  expandDates,
  resolveCourtCodes,
  searchParamsKey,
  saveSearch,
  findExistingAutoSearch,
  persistLiveResults,
  markNewEvents,
  toCourtEvent,
  applyAllFilters,
} from "./searchHelpers";


const router = Router();

// --- Court list cache (refreshed every 24h) ---
let cachedCourts: CourtInfo[] = [];
let courtsCachedAt = 0;
const COURTS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function getCourts(): Promise<CourtInfo[]> {
  if (cachedCourts.length > 0 && Date.now() - courtsCachedAt < COURTS_CACHE_TTL) {
    return cachedCourts;
  }
  try {
    cachedCourts = await fetchCourtList();
    courtsCachedAt = Date.now();
  } catch (err) {
    console.error("Failed to fetch court list:", err);
    // Return stale cache if available
    if (cachedCourts.length > 0) return cachedCourts;
    throw err;
  }
  return cachedCourts;
}

// GET /api/search/courts — list all available courts (public, cached)
router.get("/courts", async (_req: Request, res: Response) => {
  try {
    const courts = await getCourts();
    res.json(courts.map((c) => ({
      name: c.name,
      type: c.type,
      locationCode: c.locationCode,
    })));
  } catch (err) {
    console.error("Failed to serve court list:", err);
    res.status(500).json({ error: "Failed to fetch court list" });
  }
});

// GET /api/search/coverage — date range and counts of scraped data (public)
router.get("/coverage", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT COUNT(*) as total_events,
                COUNT(DISTINCT court_name) as total_courts,
                MIN(event_date) as earliest_date,
                MAX(event_date) as latest_date
         FROM court_events`
      );
      const row = result.rows[0];
      res.json({
        totalEvents: parseInt(row.total_events, 10),
        totalCourts: parseInt(row.total_courts, 10),
        earliestDate: row.earliest_date ? new Date(row.earliest_date).toISOString().split("T")[0] : null,
        latestDate: row.latest_date ? new Date(row.latest_date).toISOString().split("T")[0] : null,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Failed to fetch coverage:", err);
    res.status(500).json({ error: "Failed to fetch coverage" });
  }
});

// Search is public (no auth required) — rate-limited to prevent abuse
router.use(heavyLimiter);

// GET /api/search — supports: defendant_name, case_number, court_name, court_date,
// date_from, date_to, defendant_otn, citation_number, charges, judge_name, attorney
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  console.log("🔍 Search params:", req.query);
  /** Extract a query param as string or undefined (type-safe) */
  function qp(key: string): string | undefined {
    const val = req.query[key];
    return typeof val === "string" ? val : undefined;
  }
  const searchParams: Record<string, string | undefined> = {
    defendantName: qp("defendant_name"),
    caseNumber: qp("case_number"),
    courtName: qp("court_name"),
    courtNames: qp("court_names"),
    allCourts: qp("all_courts"),
    courtDate: qp("court_date"),
    dateFrom: qp("date_from"),
    dateTo: qp("date_to"),
    defendantOtn: qp("defendant_otn"),
    citationNumber: qp("citation_number"),
    charges: qp("charges"),
    judgeName: qp("judge_name"),
    attorney: qp("attorney"),
  };

  // Courts, dates, and allCourts are filters — at least one actual search field is required
  const hasSearchField = !!(
    searchParams.defendantName || searchParams.caseNumber ||
    searchParams.defendantOtn || searchParams.citationNumber ||
    searchParams.charges || searchParams.judgeName || searchParams.attorney
  );
  if (!hasSearchField) {
    res.status(400).json({ error: "Please enter at least one search field (defendant name, case number, OTN, citation, charges, judge, or attorney)." });
    return;
  }

  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const userId = req.user.userId;
  const pKey = searchParamsKey(searchParams);

  // Get user plan for limit enforcement
  let userPlan = "free";
  try {
    const pool = getPool();
    if (pool) {
      const client = await pool.connect();
      try {
        const planResult = await client.query<{ subscription_plan: string }>(
          "SELECT subscription_plan FROM users WHERE id = $1",
          [userId]
        );
        userPlan = planResult.rows[0]?.subscription_plan || "free";
      } finally {
        client.release();
      }
    }
  } catch { /* default to free */ }
  const isPro = userPlan === "pro";

  // If this exact search was already run today, return cached DB results.
  // Utah courts only update once daily, so re-scraping is unnecessary.
  const existing = await findExistingAutoSearch(userId, pKey);
  if (existing?.last_refreshed_at) {
    const lastRun = new Date(existing.last_refreshed_at);
    const now = new Date();
    const sameDay =
      lastRun.getUTCFullYear() === now.getUTCFullYear() &&
      lastRun.getUTCMonth() === now.getUTCMonth() &&
      lastRun.getUTCDate() === now.getUTCDate();

    if (sameDay) {
      console.log(`📋 Search already run today (${lastRun.toISOString()}) — returning cached results`);
      const dbResults = await searchCourtEvents(searchParams);
      const filtered = applyAllFilters(dbResults, searchParams);
      markNewEvents(filtered, existing.last_refreshed_at);
      res.json({
        results: filtered,
        resultsCount: filtered.length,
        searchParams,
        source: "cached",
        savedSearchId: existing.id,
        previousRunAt: lastRun.toISOString(),
        cachedToday: true,
        userPlan,
        processedAt: new Date().toISOString(),
      });
      return;
    }
  }

  // Free plan: enforce 1-week max date range
  if (!isPro && searchParams.dateFrom && searchParams.dateTo) {
    const from = new Date(searchParams.dateFrom);
    const to = new Date(searchParams.dateTo);
    const diffDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 7) {
      res.status(403).json({
        error: "Free plan is limited to a 1-week date range. Upgrade to Pro for unlimited date ranges.",
        upgradeRequired: true,
      });
      return;
    }
  }

  try {
    const liveBase = toLiveSearchBase(searchParams);
    const courts = await getCourts();
    const courtCodes = resolveCourtCodes(searchParams, courts);

    // utcourts.gov REQUIRES a location code for searches to return results.
    // If no courts selected or no live-searchable field, use DB only.
    if (!liveBase || courtCodes.length === 0) {
      const dbResults = await searchCourtEvents(searchParams);
      const source = !liveBase ? "database" : "database";
      if (courtCodes.length === 0 && liveBase) {
        console.log("  ⚠️ No courts selected — using DB only (utcourts.gov requires a court location)");
      }
      console.log(`  📊 DB-only search: ${dbResults.length} results`);
      const { savedSearchId, previousRunAt, limitReached } = await saveSearch(userId, searchParams, pKey, dbResults.length, userPlan);
      markNewEvents(dbResults, previousRunAt);
      res.json({
        results: dbResults,
        resultsCount: dbResults.length,
        searchParams,
        source,
        savedSearchId,
        previousRunAt,
        savedSearchLimitReached: limitReached || false,
        userPlan,
        processedAt: new Date().toISOString(),
      });
      return;
    }

    // Build exact court × date combinations to query.
    // Each request to utcourts.gov mirrors exactly what a user would do on
    // the site: one search with a specific court, date, and search field.
    const dates = expandDates(searchParams);
    const jobs: { loc: string; date: string }[] = [];
    for (const loc of courtCodes) {
      for (const date of dates) {
        jobs.push({ loc, date });
      }
    }

    const BATCH_SIZE = 15;
    console.log(`🌐 Live searching: ${courtCodes.length} court(s) × ${dates.length} date(s) = ${jobs.length} request(s)`);

    // Build a lookup from location code → full court info so we can annotate parsed events
    const courtByLoc = new Map(courts.map((c) => [c.locationCode, c]));

    const dbResultsPromise = searchCourtEvents(searchParams);
    const allParsed: ParsedCourtEvent[] = [];
    let failedJobs = 0;
    let emptyJobs = 0;
    let totalHtmlLen = 0;
    for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
      const batch = jobs.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((j) =>
          liveSearchUtcourts({ ...liveBase, locationCode: j.loc, date: j.date })
            .then((html) => ({ html, loc: j.loc }))
            .catch((err) => {
              failedJobs++;
              console.warn(`⚠️ Search failed for loc=${j.loc} date=${j.date}:`, err instanceof Error ? err.message : err);
              return { html: "", loc: j.loc };
            })
        )
      );
      // Parse each job's HTML separately and annotate with court metadata
      for (const { html, loc } of results) {
        totalHtmlLen += html.length;
        if (html.length === 0) { emptyJobs++; continue; }
        const courtInfo = courtByLoc.get(loc);
        const parsed = parseHtmlCalendarResults(html);
        for (const event of parsed) {
          event.courtName = courtInfo?.name ?? null;
          event.courtLocationCode = loc;
        }
        allParsed.push(...parsed);
      }
    }

    const dbResults = await dbResultsPromise;

    // Diagnostic logging
    console.log(`  📋 Live: ${allParsed.length} parsed events from ${totalHtmlLen} chars HTML (${failedJobs} failed jobs, ${emptyJobs} empty responses)`);
    console.log(`  📋 DB: ${dbResults.length} events`);

    // Persist live results and detect changes (awaited so we can return changes)
    let detectedChanges: DetectedChange[] = [];
    try {
      detectedChanges = await persistLiveResults(allParsed);
      if (detectedChanges.length > 0) {
        console.log(`🔔 ${detectedChanges.length} event(s) with changes detected`);
      }
    } catch (err) {
      console.warn("⚠️ Failed to persist live results:", err instanceof Error ? err.message : err);
    }

    // Convert live-parsed results to CourtEvent format
    const liveEvents = allParsed.map((event) => toCourtEvent(event));

    // Enrich live results with DB data (attorneys, OTN, DOB, charges) BEFORE
    // filtering, so attorney-based searches don't drop results that only have
    // attorney data in the DB from prior reports.php enrichment.
    const dbByCase = new Map<string, typeof dbResults>();
    for (const r of dbResults) {
      const key = `${r.caseNumber}|${r.eventDate}`;
      const arr = dbByCase.get(key) || [];
      arr.push(r);
      dbByCase.set(key, arr);
    }
    const liveKeys = new Set<string>();
    for (const event of liveEvents) {
      liveKeys.add(`${event.caseNumber}|${event.eventDate}|${event.eventTime || ""}`);
      const dbMatches = dbByCase.get(`${event.caseNumber}|${event.eventDate}`);
      if (dbMatches) {
        for (const dbMatch of dbMatches) {
          if (!event.prosecutingAttorney && dbMatch.prosecutingAttorney) event.prosecutingAttorney = dbMatch.prosecutingAttorney;
          if (!event.defenseAttorney && dbMatch.defenseAttorney) event.defenseAttorney = dbMatch.defenseAttorney;
          if (!event.defendantOtn && dbMatch.defendantOtn) event.defendantOtn = dbMatch.defendantOtn;
          if (!event.defendantDob && dbMatch.defendantDob) event.defendantDob = dbMatch.defendantDob;
          if (!event.citationNumber && dbMatch.citationNumber) event.citationNumber = dbMatch.citationNumber;
          if ((!event.charges || event.charges.length === 0) && dbMatch.charges && dbMatch.charges.length > 0) event.charges = dbMatch.charges;
        }
      }
    }

    // Now apply filters (attorney filter works because enrichment already ran)
    const filteredLive = applyAllFilters(liveEvents, searchParams);

    // Add DB-only results (not in live) and merge
    const extraDb = dbResults.filter(
      (r) => !liveKeys.has(`${r.caseNumber}|${r.eventDate}|${r.eventTime || ""}`)
    );
    const merged = [...filteredLive, ...extraDb].slice(0, 2000);

    console.log(`  📊 Merge: ${filteredLive.length} live + ${extraDb.length} extra DB = ${merged.length} total results`);

    const { savedSearchId, previousRunAt, limitReached } = await saveSearch(userId, searchParams, pKey, merged.length, userPlan);
    markNewEvents(merged, previousRunAt);
    res.json({
      results: merged,
      resultsCount: merged.length,
      searchParams,
      source: "live",
      savedSearchId,
      previousRunAt,
      savedSearchLimitReached: limitReached || false,
      userPlan,
      processedAt: new Date().toISOString(),
      detectedChanges: detectedChanges.length > 0 && previousRunAt ? detectedChanges : undefined,
    });
  } catch (err) {
    console.error("❌ Search failed:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
