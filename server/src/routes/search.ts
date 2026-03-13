import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { heavyLimiter } from "../middleware/rateLimiter";
import { searchCourtEvents } from "../services/searchService";

const router = Router();

router.use(authenticateToken);
router.use(heavyLimiter);

// GET /api/search
router.get("/", async (req: Request, res: Response) => {
  const searchParams = {
    defendantName: req.query.defendant_name as string | undefined,
    caseNumber: req.query.case_number as string | undefined,
    courtName: req.query.court_name as string | undefined,
    courtDate: req.query.court_date as string | undefined,
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

export default router;
