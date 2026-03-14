import { Router, Request, Response } from "express";
import { heavyLimiter } from "../middleware/rateLimiter";
import { searchCourtEvents } from "../services/searchService";
import { fetchCourtList, fetchCourtCalendarHtml, CourtInfo } from "../services/courtScraper";
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
 * In-memory court list cache (refreshed every 24h).
 */
let cachedCourts: CourtInfo[] = [];
let courtsCachedAt = 0;
const COURTS_CACHE_TTL = 24 * 60 * 60 * 1000;

async function getCourtList(): Promise<CourtInfo[]> {
  if (cachedCourts.length > 0 && Date.now() - courtsCachedAt < COURTS_CACHE_TTL) {
    return cachedCourts;
  }
  cachedCourts = await fetchCourtList();
  courtsCachedAt = Date.now();
  return cachedCourts;
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

    // Database empty or no matches — do a live scrape from utcourts.gov
    // by browsing courts for the target date(s) and filtering locally.
    console.log("🌐 No DB results, scraping utcourts.gov live...");

    const targetDates = getTargetDates(searchParams);
    const courts = await getCourtList();

    // If a court name filter is provided, narrow down courts to scrape
    const courtsToScrape = searchParams.courtName
      ? courts.filter((c) =>
          c.name.toUpperCase().includes(searchParams.courtName!.toUpperCase())
        )
      : courts;

    // Cap: scrape up to 20 courts × dates to keep response time reasonable
    const MAX_SCRAPE_REQUESTS = 20;
    const scrapeTargets: { court: CourtInfo; date: string }[] = [];
    for (const date of targetDates) {
      for (const court of courtsToScrape) {
        scrapeTargets.push({ court, date });
        if (scrapeTargets.length >= MAX_SCRAPE_REQUESTS) break;
      }
      if (scrapeTargets.length >= MAX_SCRAPE_REQUESTS) break;
    }

    console.log(`🔍 Scraping ${scrapeTargets.length} court×date combinations...`);

    // Scrape in parallel batches of 5
    const allEvents: CourtEvent[] = [];
    const BATCH_SIZE = 5;

    for (let i = 0; i < scrapeTargets.length; i += BATCH_SIZE) {
      const batch = scrapeTargets.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async ({ court, date }) => {
          const html = await fetchCourtCalendarHtml(court.locationCode, date);
          const parsed = parseHtmlCalendarResults(html);
          return parsed.map((event) => toCourtEvent(event, court));
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          allEvents.push(...result.value);
        }
      }
    }

    // Apply all search filters locally
    const filtered = applyAllFilters(allEvents, searchParams);

    res.json({
      results: filtered.slice(0, 200),
      resultsCount: filtered.length,
      searchParams,
      source: "live",
      courtsScraped: scrapeTargets.length,
      processedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ Search failed:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

/**
 * Determine which dates to scrape based on search params.
 * Returns 1-3 dates in YYYY-MM-DD or "today" format.
 */
function getTargetDates(params: Record<string, string | undefined>): string[] {
  if (params.courtDate) return [params.courtDate];
  if (params.dateFrom && params.dateTo) {
    // Scrape up to 3 dates in the range
    const dates: string[] = [];
    const start = new Date(params.dateFrom);
    const end = new Date(params.dateTo);
    const d = new Date(start);
    while (d <= end && dates.length < 3) {
      if (d.getDay() !== 0 && d.getDay() !== 6) {
        dates.push(d.toISOString().split("T")[0]);
      }
      d.setDate(d.getDate() + 1);
    }
    return dates.length > 0 ? dates : ["today"];
  }
  if (params.dateFrom) return [params.dateFrom];

  // No date specified — scrape the next weekday
  const now = new Date();
  const day = now.getDay();
  if (day === 0) now.setDate(now.getDate() + 1); // Sunday → Monday
  else if (day === 6) now.setDate(now.getDate() + 2); // Saturday → Monday
  return [now.toISOString().split("T")[0]];
}

/**
 * Convert a ParsedCourtEvent to a CourtEvent for the API response.
 */
function toCourtEvent(event: ParsedCourtEvent, court: CourtInfo): CourtEvent {
  return {
    id: -Math.floor(Math.random() * 1000000),
    courtType: court.type,
    courtName: court.name,
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
