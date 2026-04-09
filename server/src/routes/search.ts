import { Router, Request, Response } from "express";
import { heavyLimiter } from "../middleware/rateLimiter";
import { authenticateToken } from "../middleware/auth";
import { searchCourtEvents } from "../services/searchService";
import { liveSearchUtcourts, fetchCourtList, CourtInfo } from "../services/courtScraper";
import { parseHtmlCalendarResults, ParsedCourtEvent, SearchContext, enrichFromDetailsPages } from "../services/courtEventParser";
import { DetectedChange } from "@shared/types";
import { getPool } from "../db/pool";
import {
  toLiveSearchBase,
  resolveCourtCodes,
  searchParamsKey,
  saveSearch,
  findExistingAutoSearch,
  persistLiveResults,
  markNewEvents,
  toCourtEvent,
  applyAllFilters,
  expandDates,
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

  // Get user plan and account type for limit enforcement
  let userPlan = "free";
  let accountType: string | null = null;
  try {
    const pool = getPool();
    if (pool) {
      const client = await pool.connect();
      try {
        const planResult = await client.query<{ subscription_plan: string; account_type: string | null }>(
          "SELECT subscription_plan, account_type FROM users WHERE id = $1",
          [userId]
        );
        userPlan = planResult.rows[0]?.subscription_plan || "free";
        accountType = planResult.rows[0]?.account_type || null;
      } finally {
        client.release();
      }
    }
  } catch { /* default to free */ }
  const isPro = userPlan === "pro";

  // Individual attorneys: strip date filters (always search all dates)
  if (accountType === "individual_attorney") {
    delete searchParams.dateFrom;
    delete searchParams.dateTo;
    delete searchParams.courtDate;
  }

  const forceRefresh = qp("force_refresh") === "true";

  const existing = await findExistingAutoSearch(userId, pKey);
  if (!forceRefresh && existing?.last_refreshed_at) {
    const lastRun = new Date(existing.last_refreshed_at);
    const now = new Date();
    const sameDay =
      lastRun.getUTCFullYear() === now.getUTCFullYear() &&
      lastRun.getUTCMonth() === now.getUTCMonth() &&
      lastRun.getUTCDate() === now.getUTCDate();

    if (sameDay) {
      const cacheDbParams = { ...searchParams };
      if (cacheDbParams.attorney) delete cacheDbParams.attorney;
      const dbResults = await searchCourtEvents(cacheDbParams);
      const filtered = applyAllFilters(dbResults, searchParams);

      const LOW_RESULT_THRESHOLD = 3;
      if (accountType === "agency" && filtered.length < LOW_RESULT_THRESHOLD) {
        console.log(`📋 Cached results suspiciously low (${filtered.length}) for agency search — forcing refresh`);
      } else {
        console.log(`📋 Search already run today (${lastRun.toISOString()}) — returning ${filtered.length} cached results`);
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
  }

  // Utah courts only publish calendars ~1 month out — cap dates
  const maxDate = new Date();
  maxDate.setMonth(maxDate.getMonth() + 1);
  const maxDateStr = maxDate.toISOString().split("T")[0];
  if (searchParams.dateFrom && searchParams.dateFrom > maxDateStr) {
    searchParams.dateFrom = maxDateStr;
  }
  if (searchParams.dateTo && searchParams.dateTo > maxDateStr) {
    searchParams.dateTo = maxDateStr;
  }
  if (searchParams.courtDate && searchParams.courtDate > maxDateStr) {
    searchParams.courtDate = maxDateStr;
  }

  // Free plan or agency: enforce 1-week max date range
  const enforceWeekLimit = !isPro || accountType === "agency";
  if (enforceWeekLimit && searchParams.dateFrom && searchParams.dateTo) {
    const from = new Date(searchParams.dateFrom);
    const to = new Date(searchParams.dateTo);
    const diffDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 7) {
      const msg = accountType === "agency"
        ? "Agency accounts are limited to a 1-week date range. Searches are run day by day."
        : "Free plan is limited to a 1-week date range. Upgrade to Pro for unlimited date ranges.";
      res.status(403).json({
        error: msg,
        upgradeRequired: accountType !== "agency",
      });
      return;
    }
  }

  // Agency: default dates to current Mon–Fri week if not provided
  if (accountType === "agency" && !searchParams.dateFrom && !searchParams.dateTo && !searchParams.courtDate) {
    const today = new Date();
    const day = today.getDay();
    const diffToMon = day === 0 ? -6 : 1 - day;
    const monday = new Date(today);
    monday.setDate(monday.getDate() + diffToMon);
    const friday = new Date(monday);
    friday.setDate(friday.getDate() + 4);
    searchParams.dateFrom = monday.toISOString().split("T")[0];
    searchParams.dateTo = friday.toISOString().split("T")[0];
  }

  try {
    const liveBase = toLiveSearchBase(searchParams);
    const courts = await getCourts();
    const courtCodes = resolveCourtCodes(searchParams, courts);

    // Require explicit court selection — don't silently search all courts
    // Exception: re-running a saved search (existing) or when courtNames were
    // provided but didn't resolve (court list may have changed since save)
    if (liveBase && courtCodes.length === 0 && searchParams.allCourts !== "true") {
      if (existing || searchParams.courtNames) {
        // Saved search or unresolved court names — default to all courts
        searchParams.allCourts = "true";
      } else {
        res.status(400).json({ error: "Please select one or more courts, or check \"All Courts\" to search everywhere." });
        return;
      }
    }

    // No live-searchable field (OTN, citation, charges) → DB only
    if (!liveBase) {
      const dbResults = await searchCourtEvents(searchParams);
      console.log(`  📊 DB-only search (no live-searchable field): ${dbResults.length} results`);
      const { savedSearchId, previousRunAt, limitReached } = await saveSearch(userId, searchParams, pKey, dbResults.length, userPlan);
      markNewEvents(dbResults, previousRunAt);
      res.json({
        results: dbResults,
        resultsCount: dbResults.length,
        searchParams,
        source: "database",
        savedSearchId,
        previousRunAt,
        savedSearchLimitReached: limitReached || false,
        userPlan,
        processedAt: new Date().toISOString(),
      });
      return;
    }

    // Determine search strategy:
    // - Agency accounts: search day by day (one request per weekday)
    // - Individual attorneys / default: use d=all
    //   - "All courts" or many courts (>3): use loc=all&d=all (single request)
    //   - 1-3 specific courts: use loc=CODE&d=all per court (1-3 requests)
    // Then filter by date range locally after parsing.
    const useBroadSearch = searchParams.allCourts === "true" || courtCodes.length > 3;

    // Build a lookup from location code → full court info so we can annotate parsed events
    const courtByLoc = new Map(courts.map((c) => [c.locationCode, c]));

    const dbResultsPromise = searchCourtEvents(searchParams);
    const allParsed: ParsedCourtEvent[] = [];
    const parseContext: SearchContext = {
      searchedAttorney: searchParams.attorney || undefined,
    };
    const searchWarnings: string[] = [];

    if (accountType === "agency") {
      const dates = expandDates(searchParams);
      const locationCodes = useBroadSearch ? ["all"] : courtCodes;
      const totalRequests = dates.length * locationCodes.length;
      console.log(`🌐 Agency day-by-day search: ${dates.length} date(s) x ${locationCodes.length} location(s) = ${totalRequests} request(s)`);

      let successCount = 0;
      let failCount = 0;
      const failedRequests: string[] = [];

      for (const date of dates) {
        const dayResults = await Promise.all(
          locationCodes.map((loc) =>
            liveSearchUtcourts({ ...liveBase, locationCode: loc, date })
              .then((html) => ({ html, loc, error: null as string | null }))
              .catch((err) => {
                const errMsg = err instanceof Error ? err.message : String(err);
                console.warn(`⚠️ Search failed for loc=${loc} date=${date}:`, errMsg);
                return { html: "", loc, error: errMsg };
              })
          )
        );
        for (const { html, loc, error } of dayResults) {
          const courtLabel = courtByLoc.get(loc)?.name || loc;
          if (error) {
            failCount++;
            failedRequests.push(`${courtLabel} on ${date}`);
            console.log(`  ❌ FAIL loc=${loc} date=${date}: ${error}`);
            continue;
          }
          successCount++;
          if (html.length === 0) {
            console.log(`  ✅ OK   loc=${loc} date=${date}: empty response (0 chars, 0 events)`);
            continue;
          }
          const parsed = parseHtmlCalendarResults(html, parseContext);
          console.log(`  ✅ OK   loc=${loc} date=${date}: ${html.length} chars HTML, ${parsed.length} events parsed`);
          if (!useBroadSearch) {
            const courtInfo = courtByLoc.get(loc);
            for (const event of parsed) {
              event.courtName = courtInfo?.name ?? null;
              event.courtLocationCode = loc;
            }
          }
          allParsed.push(...parsed);
        }
      }

      console.log(`  📋 Agency search complete: ${successCount} succeeded, ${failCount} failed, ${allParsed.length} events total`);

      if (failCount > 0) {
        const summary = failedRequests.length <= 5
          ? failedRequests.join("; ")
          : `${failedRequests.slice(0, 5).join("; ")} and ${failedRequests.length - 5} more`;
        searchWarnings.push(`${failCount} of ${totalRequests} court/date requests failed — results may be incomplete (${summary}).`);
      }
    } else if (useBroadSearch) {
      console.log(`🌐 Broad search: loc=all&d=all (1 request for all ${courtCodes.length} courts)`);
      try {
        const html = await liveSearchUtcourts({ ...liveBase, date: "all", locationCode: "all" });
        if (html.length > 0) {
          const parsed = parseHtmlCalendarResults(html, parseContext);
          allParsed.push(...parsed);
          console.log(`  ✅ OK   loc=all d=all: ${html.length} chars HTML, ${parsed.length} events parsed`);
        } else {
          console.log(`  ✅ OK   loc=all d=all: empty response (0 chars, 0 events)`);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`  ❌ FAIL loc=all d=all: ${errMsg}`);
        searchWarnings.push(`Broad court search failed — results may be incomplete. Please try again.`);
      }
    } else {
      console.log(`🌐 Targeted search: ${courtCodes.length} court(s) with d=all = ${courtCodes.length} request(s)`);
      let targetedFails = 0;
      const targetedFailNames: string[] = [];
      const results = await Promise.all(
        courtCodes.map((loc) =>
          liveSearchUtcourts({ ...liveBase, locationCode: loc, date: "all" })
            .then((html) => ({ html, loc, error: null as string | null }))
            .catch((err) => {
              const errMsg = err instanceof Error ? err.message : String(err);
              console.warn(`⚠️ Search failed for loc=${loc}:`, errMsg);
              return { html: "", loc, error: errMsg };
            })
        )
      );
      for (const { html, loc, error } of results) {
        const courtLabel = courtByLoc.get(loc)?.name || loc;
        if (error) {
          targetedFails++;
          targetedFailNames.push(courtLabel);
          console.log(`  ❌ FAIL loc=${loc}: ${error}`);
          continue;
        }
        if (html.length === 0) {
          console.log(`  ✅ OK   loc=${loc}: empty response (0 chars, 0 events)`);
          continue;
        }
        const courtInfo = courtByLoc.get(loc);
        const parsed = parseHtmlCalendarResults(html, parseContext);
        console.log(`  ✅ OK   loc=${loc}: ${html.length} chars HTML, ${parsed.length} events parsed`);
        for (const event of parsed) {
          event.courtName = courtInfo?.name ?? null;
          event.courtLocationCode = loc;
        }
        allParsed.push(...parsed);
      }
      console.log(`  📋 Targeted search complete: ${courtCodes.length - targetedFails} succeeded, ${targetedFails} failed, ${allParsed.length} events total`);
      if (targetedFails > 0) {
        searchWarnings.push(`${targetedFails} of ${courtCodes.length} court requests failed — results may be incomplete (${targetedFailNames.join("; ")}).`);
      }
    }

    const dbResults = await dbResultsPromise;

    // Diagnostic logging
    console.log(`  📋 Live: ${allParsed.length} parsed events, DB: ${dbResults.length} events`);

    // Enrich events with attorney data from details.php pages
    // (search.php only shows one attorney with no role label)
    let enrichmentFailed = 0;
    let enrichmentTotal = 0;
    try {
      const enrichResult = await enrichFromDetailsPages(allParsed);
      enrichmentFailed = enrichResult.failed;
      enrichmentTotal = enrichResult.total;
      if (enrichResult.enriched > 0) {
        console.log(`  👤 Enriched ${enrichResult.enriched}/${enrichResult.total} events with attorney data from details pages`);
      }
      if (enrichResult.failed > 0) {
        console.warn(`  ⚠️ Details enrichment failed for ${enrichResult.failed}/${enrichResult.total} events (after retries)`);
      }
    } catch (err) {
      console.warn("⚠️ Details enrichment failed:", err instanceof Error ? err.message : err);
    }

    // Surface enrichment failures as a user-facing warning
    if (enrichmentFailed > 0) {
      searchWarnings.push(
        `Attorney data incomplete for ${enrichmentFailed} of ${enrichmentTotal} events due to court website timeouts or time limits. Previously cached attorney data was used where available.`
      );
    }

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

    // Look up real DB IDs for persisted live results so the frontend can
    // reference them (e.g. "Add to Calendar" needs a real court_event ID).
    const dbIdLookup = new Map<string, number>();
    try {
      const pool = getPool();
      if (pool && allParsed.length > 0) {
        const client = await pool.connect();
        try {
          const caseNumbers = [...new Set(allParsed.map(e => e.caseNumber).filter(Boolean))];
          if (caseNumbers.length > 0) {
            const result = await client.query<{ id: number; case_number: string; event_date: string }>(
              `SELECT id, case_number, event_date::text
               FROM court_events WHERE case_number = ANY($1)
               ORDER BY updated_at DESC`,
              [caseNumbers]
            );
            for (const row of result.rows) {
              const key = `${row.case_number}|${row.event_date}`;
              if (!dbIdLookup.has(key)) dbIdLookup.set(key, row.id);
            }
          }
        } finally {
          client.release();
        }
      }
    } catch (err) {
      console.warn("⚠️ DB ID lookup failed:", err instanceof Error ? err.message : err);
    }

    // Convert live-parsed results to CourtEvent format, using real DB IDs when available
    const liveEvents = allParsed.map((event) => {
      const ce = toCourtEvent(event);
      const dbId = dbIdLookup.get(`${event.caseNumber}|${event.eventDate}`);
      if (dbId) ce.id = dbId;
      return ce;
    });

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
    // Skip attorney backfill from DB when doing attorney searches — the DB may
    // have corrupt data from the old parser that assigned the searched attorney
    // to defenseAttorney regardless of their actual role.
    const isAttorneySearch = !!searchParams.attorney;

    function normalizeTime(t: string | null | undefined): string {
      if (!t) return "";
      return t.replace(/\s+/g, " ").trim().toUpperCase();
    }

    const liveCaseDateTimeKeys = new Set<string>();
    for (const event of liveEvents) {
      liveCaseDateTimeKeys.add(`${event.caseNumber}|${event.eventDate}|${normalizeTime(event.eventTime)}`);
      const dbMatches = dbByCase.get(`${event.caseNumber}|${event.eventDate}`);
      if (dbMatches) {
        for (const dbMatch of dbMatches) {
          if (!isAttorneySearch) {
            if (!event.prosecutingAttorney && dbMatch.prosecutingAttorney) event.prosecutingAttorney = dbMatch.prosecutingAttorney;
            if (!event.defenseAttorney && dbMatch.defenseAttorney) event.defenseAttorney = dbMatch.defenseAttorney;
          }
          if (!event.defendantOtn && dbMatch.defendantOtn) event.defendantOtn = dbMatch.defendantOtn;
          if (!event.defendantDob && dbMatch.defendantDob) event.defendantDob = dbMatch.defendantDob;
          if (!event.citationNumber && dbMatch.citationNumber) event.citationNumber = dbMatch.citationNumber;
          if ((!event.charges || event.charges.length === 0) && dbMatch.charges && dbMatch.charges.length > 0) event.charges = dbMatch.charges;
        }
      }
    }

    // Apply filters — but skip attorney filter for live results since
    // utcourts.gov already filtered by attorney (search.php t=a).
    // The parser leaves prosecutingAttorney/defenseAttorney null until
    // details.php enrichment runs, which may fail or be incomplete.
    const liveFilterParams = { ...searchParams };
    if (isAttorneySearch) delete liveFilterParams.attorney;
    const filteredLive = applyAllFilters(liveEvents, liveFilterParams);

    // Add DB-only results (not in live) and merge.
    // Only exclude DB records when the live scrape has a matching case+date+time.
    // This preserves DB records for hearings at different times that the live
    // scrape may not have returned (e.g., partial scrape results).
    // If a DB record matches case+date but NOT time, it's kept — it may represent
    // a different hearing that the live scrape missed.
    const extraDb = dbResults.filter(
      (r) => !liveCaseDateTimeKeys.has(`${r.caseNumber}|${r.eventDate}|${normalizeTime(r.eventTime)}`)
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
      searchWarnings: searchWarnings.length > 0 ? searchWarnings : undefined,
    });
  } catch (err) {
    console.error("❌ Search failed:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
