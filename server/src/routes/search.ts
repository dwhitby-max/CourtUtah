import { Router, Request, Response } from "express";
import { heavyLimiter } from "../middleware/rateLimiter";
import { searchCourtEvents } from "../services/searchService";
import { liveSearchUtcourts, LiveSearchParams } from "../services/courtScraper";
import { parseHtmlCalendarResults, ParsedCourtEvent } from "../services/courtEventParser";
import { CourtEvent } from "../../../shared/types";

const router = Router();

// GET /api/search/coverage — date range and counts of scraped data (public)
router.get("/coverage", async (_req: Request, res: Response) => {
  try {
    const { getPool } = await import("../db/pool");
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

// GET /api/search — supports: defendant_name, case_number, court_name, court_date,
// date_from, date_to, defendant_otn, citation_number, charges, judge_name, attorney
router.get("/", async (req: Request, res: Response) => {
  console.log("🔍 Search params:", req.query);
  const searchParams = {
    defendantName: req.query.defendant_name as string | undefined,
    caseNumber: req.query.case_number as string | undefined,
    courtName: req.query.court_name as string | undefined,
    courtDate: req.query.court_date as string | undefined,
    dateFrom: req.query.date_from as string | undefined,
    dateTo: req.query.date_to as string | undefined,
    defendantOtn: req.query.defendant_otn as string | undefined,
    citationNumber: req.query.citation_number as string | undefined,
    charges: req.query.charges as string | undefined,
    judgeName: req.query.judge_name as string | undefined,
    attorney: req.query.attorney as string | undefined,
  };

  const hasParams = Object.values(searchParams).some((v) => v !== undefined && v !== "");
  if (!hasParams) {
    res.status(400).json({ error: "At least one search parameter is required" });
    return;
  }

  try {
    // First try the local database
    const dbResults = await searchCourtEvents(searchParams);

    if (dbResults.length > 0) {
      res.json({
        results: dbResults,
        resultsCount: dbResults.length,
        searchParams,
        source: "database",
        processedAt: new Date().toISOString(),
      });
      return;
    }

    // Database empty or no matches — do a targeted live search via utcourts.gov
    const liveParams = toLiveSearchParams(searchParams);
    if (!liveParams) {
      // Fields like OTN, citation, charges can't be searched directly on utcourts
      res.json({
        results: [],
        resultsCount: 0,
        searchParams,
        source: "database",
        processedAt: new Date().toISOString(),
      });
      return;
    }

    console.log("🌐 No DB results, searching utcourts.gov live...");
    const html = await liveSearchUtcourts(liveParams);
    const parsed = parseHtmlCalendarResults(html);
    const allEvents = parsed.map((event) => toCourtEvent(event));

    // Apply additional filters locally (court name, date range, OTN, etc.)
    const filtered = applyAllFilters(allEvents, searchParams);

    res.json({
      results: filtered.slice(0, 200),
      resultsCount: filtered.length,
      searchParams,
      source: "live",
      processedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ Search failed:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

/**
 * Convert a ParsedCourtEvent to a CourtEvent for the API response.
 */
function toCourtEvent(event: ParsedCourtEvent): CourtEvent {
  return {
    id: -Math.floor(Math.random() * 1000000),
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
