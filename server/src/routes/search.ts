import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { heavyLimiter } from "../middleware/rateLimiter";
import { searchCourtEvents } from "../services/searchService";

const router = Router();

router.use(authenticateToken);
router.use(heavyLimiter);

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
    const results = await searchCourtEvents(searchParams);

    res.json({
      results,
      resultsCount: results.length,
      searchParams,
      processedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ Search failed:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

// GET /api/search/coverage — date range and counts of scraped data
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
        earliestDate: row.earliest_date ? String(row.earliest_date).split("T")[0] : null,
        latestDate: row.latest_date ? String(row.latest_date).split("T")[0] : null,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("❌ Coverage query failed:", err);
    res.status(500).json({ error: "Failed to fetch coverage" });
  }
});

export default router;
