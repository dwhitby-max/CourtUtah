import { Router, Request, Response } from "express";
import { heavyLimiter } from "../middleware/rateLimiter";
import { authenticateToken } from "../middleware/auth";
import { searchCourtEvents } from "../services/searchService";
import { liveSearchUtcourts, LiveSearchParams } from "../services/courtScraper";
import { parseHtmlCalendarResults, ParsedCourtEvent } from "../services/courtEventParser";
import { CourtEvent } from "../../../shared/types";
import { getPool } from "../db/pool";
import { config } from "../config/env";

const router = Router();

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

/**
 * Map user search params to LiveSearchParams for utcourts.gov.
 * Returns null if no searchable field is provided (utcourts requires
 * at least one of: party name, case number, judge, or attorney).
 */
function toLiveSearchParams(params: Record<string, string | undefined>): LiveSearchParams | null {
  if (params.caseNumber) return { caseNumber: params.caseNumber, date: params.courtDate || "all" };
  if (params.defendantName) return { partyName: params.defendantName, date: params.courtDate || "all" };
  if (params.judgeName) return { judgeName: params.judgeName, date: params.courtDate || "all" };
  if (params.attorney) return { attorneyLastName: params.attorney, date: params.courtDate || "all" };
  return null;
}

/**
 * Build a canonical key from search params for deduplication.
 */
function searchParamsKey(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v).toUpperCase().trim()}`);
  return entries.join("&");
}

/**
 * Build a human-readable label from search params.
 */
function buildSearchLabel(params: Record<string, string | undefined>): string {
  const parts: string[] = [];
  if (params.defendantName) parts.push(`Defendant: ${params.defendantName}`);
  if (params.caseNumber) parts.push(`Case: ${params.caseNumber}`);
  if (params.courtName) parts.push(`Court: ${params.courtName}`);
  if (params.judgeName) parts.push(`Judge: ${params.judgeName}`);
  if (params.attorney) parts.push(`Attorney: ${params.attorney}`);
  if (params.defendantOtn) parts.push(`OTN: ${params.defendantOtn}`);
  if (params.citationNumber) parts.push(`Citation: ${params.citationNumber}`);
  if (params.charges) parts.push(`Charges: ${params.charges}`);
  if (params.courtDate) parts.push(`Date: ${params.courtDate}`);
  if (params.dateFrom && params.dateTo) parts.push(`${params.dateFrom} to ${params.dateTo}`);
  else if (params.dateFrom) parts.push(`From: ${params.dateFrom}`);
  else if (params.dateTo) parts.push(`To: ${params.dateTo}`);
  return parts.join(" | ") || "Search";
}

/**
 * Check if a saved search already exists for this user with matching params.
 */
async function findExistingSavedSearch(
  userId: number,
  paramsKey: string
): Promise<{ id: number } | null> {
  const pool = getPool();
  if (!pool) return null;
  const client = await pool.connect();
  try {
    // Compare by canonical key stored in search_params JSONB
    const result = await client.query(
      `SELECT id FROM saved_searches
       WHERE user_id = $1 AND search_params->>'_key' = $2 AND is_active = true
       LIMIT 1`,
      [userId, paramsKey]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  } finally {
    client.release();
  }
}

/**
 * Save or update a saved search record for the user.
 */
async function saveSearch(
  userId: number,
  params: Record<string, string | undefined>,
  paramsKey: string,
  resultsCount: number
): Promise<number> {
  const pool = getPool();
  if (!pool) return -1;
  const client = await pool.connect();
  try {
    const existing = await findExistingSavedSearch(userId, paramsKey);
    const paramsWithKey = { ...params, _key: paramsKey };
    const label = buildSearchLabel(params);

    if (existing) {
      await client.query(
        `UPDATE saved_searches
         SET results_count = $1, last_run_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [resultsCount, existing.id]
      );
      return existing.id;
    }

    const result = await client.query(
      `INSERT INTO saved_searches (user_id, search_params, label, results_count, last_run_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id`,
      [userId, JSON.stringify(paramsWithKey), label, resultsCount]
    );
    return result.rows[0].id;
  } finally {
    client.release();
  }
}

/**
 * Persist live-scraped events into court_events table so future searches hit the DB.
 */
async function persistLiveResults(parsed: ParsedCourtEvent[]): Promise<void> {
  const pool = getPool();
  if (!pool || parsed.length === 0) return;

  const client = await pool.connect();
  try {
    for (const event of parsed) {
      // Upsert by case_number + event_date
      if (!event.caseNumber || !event.eventDate) continue;
      const existing = await client.query(
        `SELECT id FROM court_events WHERE case_number = $1 AND event_date = $2 LIMIT 1`,
        [event.caseNumber, event.eventDate]
      );
      if (existing.rows.length > 0) continue; // already in DB

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
    }
  } catch (err) {
    console.error("⚠️ Failed to persist some live results:", err instanceof Error ? err.message : err);
  } finally {
    client.release();
  }
}

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
    courtDate: qp("court_date"),
    dateFrom: qp("date_from"),
    dateTo: qp("date_to"),
    defendantOtn: qp("defendant_otn"),
    citationNumber: qp("citation_number"),
    charges: qp("charges"),
    judgeName: qp("judge_name"),
    attorney: qp("attorney"),
  };

  const hasParams = Object.values(searchParams).some((v) => v !== undefined && v !== "");
  if (!hasParams) {
    res.status(400).json({ error: "At least one search parameter is required" });
    return;
  }

  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const userId = req.user.userId;
  const pKey = searchParamsKey(searchParams);

  try {
    // Check if this search has been run before (has cached results in DB)
    const existingSaved = await findExistingSavedSearch(userId, pKey);

    // If this is a returning search with cached data, use DB results
    if (existingSaved) {
      const dbResults = await searchCourtEvents(searchParams);
      if (dbResults.length > 0) {
        // Update last_run_at
        await saveSearch(userId, searchParams, pKey, dbResults.length);
        res.json({
          results: dbResults,
          resultsCount: dbResults.length,
          searchParams,
          source: "database",
          savedSearchId: existingSaved.id,
          processedAt: new Date().toISOString(),
        });
        return;
      }
    }

    // First-time search or no cached results: always go live
    const liveParams = toLiveSearchParams(searchParams);
    if (!liveParams) {
      // Fields like OTN, citation, charges can't be searched directly on utcourts
      // Fall back to DB search
      const dbResults = await searchCourtEvents(searchParams);
      const savedId = await saveSearch(userId, searchParams, pKey, dbResults.length);
      res.json({
        results: dbResults,
        resultsCount: dbResults.length,
        searchParams,
        source: "database",
        savedSearchId: savedId,
        processedAt: new Date().toISOString(),
      });
      return;
    }

    console.log("🌐 Running live search on utcourts.gov...");
    const html = await liveSearchUtcourts(liveParams);
    const parsed = parseHtmlCalendarResults(html);

    // Persist live results to court_events for future searches
    await persistLiveResults(parsed);

    const allEvents = parsed.map((event) => toCourtEvent(event));
    const filtered = applyAllFilters(allEvents, searchParams);
    const resultSlice = filtered.slice(0, 200);

    // If live returned results, use them
    if (resultSlice.length > 0) {
      const savedId = await saveSearch(userId, searchParams, pKey, resultSlice.length);
      res.json({
        results: resultSlice,
        resultsCount: filtered.length,
        searchParams,
        source: "live",
        savedSearchId: savedId,
        processedAt: new Date().toISOString(),
      });
      return;
    }

    // Live returned 0 — fall back to DB (may have cached results from prior scrapes)
    console.log("📭 Live search returned 0 results, checking database...");
    const dbResults = await searchCourtEvents(searchParams);
    const savedId = await saveSearch(userId, searchParams, pKey, dbResults.length);
    res.json({
      results: dbResults,
      resultsCount: dbResults.length,
      searchParams,
      source: dbResults.length > 0 ? "database" : "live",
      savedSearchId: savedId,
      processedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ Search failed:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

/** Counter for assigning temporary negative IDs to live (non-persisted) results */
let liveIdCounter = 0;

/**
 * Convert a ParsedCourtEvent to a CourtEvent for the API response.
 */
function toCourtEvent(event: ParsedCourtEvent): CourtEvent {
  liveIdCounter -= 1;
  return {
    id: liveIdCounter,
    courtType: "",
    courtName: event.hearingLocation || "",
    courtRoom: event.courtRoom,
    eventDate: event.eventDate || "",
    eventTime: event.eventTime,
    hearingType: event.hearingType,
    caseNumber: event.caseNumber,
    caseType: event.caseType,
    defendantName: event.defendantName,
    defendantOtn: event.defendantOtn,
    defendantDob: event.defendantDob,
    citationNumber: event.citationNumber,
    sheriffNumber: event.sheriffNumber,
    leaNumber: event.leaNumber,
    prosecutingAttorney: event.prosecutingAttorney,
    defenseAttorney: event.defenseAttorney,
    judgeName: event.judgeName,
    hearingLocation: event.hearingLocation,
    isVirtual: event.isVirtual,
    sourcePdfUrl: null,
    sourceUrl: null,
    sourcePageNumber: null,
    contentHash: event.contentHash,
    charges: [],
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Apply all search filters locally against scraped results.
 */
function applyAllFilters(
  results: CourtEvent[],
  params: Record<string, string | undefined>
): CourtEvent[] {
  let filtered = results;

  if (params.defendantName) {
    const name = params.defendantName.toUpperCase();
    filtered = filtered.filter(
      (e) => e.defendantName && e.defendantName.toUpperCase().includes(name)
    );
  }

  if (params.caseNumber) {
    const cn = params.caseNumber.toUpperCase();
    filtered = filtered.filter(
      (e) => e.caseNumber && e.caseNumber.toUpperCase().includes(cn)
    );
  }

  if (params.courtName) {
    const court = params.courtName.toUpperCase();
    filtered = filtered.filter(
      (e) =>
        (e.courtName && e.courtName.toUpperCase().includes(court)) ||
        (e.hearingLocation && e.hearingLocation.toUpperCase().includes(court))
    );
  }

  if (params.judgeName) {
    const judge = params.judgeName.toUpperCase();
    filtered = filtered.filter(
      (e) => e.judgeName && e.judgeName.toUpperCase().includes(judge)
    );
  }

  if (params.attorney) {
    const atty = params.attorney.toUpperCase();
    filtered = filtered.filter(
      (e) =>
        (e.prosecutingAttorney && e.prosecutingAttorney.toUpperCase().includes(atty)) ||
        (e.defenseAttorney && e.defenseAttorney.toUpperCase().includes(atty))
    );
  }

  if (params.defendantOtn) {
    const otn = params.defendantOtn.toUpperCase();
    filtered = filtered.filter(
      (e) => e.defendantOtn && e.defendantOtn.toUpperCase().includes(otn)
    );
  }

  if (params.citationNumber) {
    const cit = params.citationNumber.toUpperCase();
    filtered = filtered.filter(
      (e) => e.citationNumber && e.citationNumber.toUpperCase().includes(cit)
    );
  }

  if (params.charges) {
    const ch = params.charges.toUpperCase();
    filtered = filtered.filter(
      (e) => e.charges && e.charges.some((c) => c.toUpperCase().includes(ch))
    );
  }

  if (params.courtDate) {
    filtered = filtered.filter((e) => e.eventDate === params.courtDate);
  }
  if (params.dateFrom) {
    filtered = filtered.filter((e) => e.eventDate && e.eventDate >= params.dateFrom!);
  }
  if (params.dateTo) {
    filtered = filtered.filter((e) => e.eventDate && e.eventDate <= params.dateTo!);
  }

  return filtered;
}

export default router;
