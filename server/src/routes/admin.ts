import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { heavyLimiter } from "../middleware/rateLimiter";
import { getPool } from "../db/pool";
import { getPoolStats } from "../db/pool";
import { runScrapeJob } from "../services/schedulerService";

const router = Router();

router.use(authenticateToken);

// GET /api/admin/scrape-jobs — list recent scrape jobs
router.get("/scrape-jobs", async (_req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, status, courts_processed, events_found, events_changed,
              error_message, started_at, completed_at, created_at
       FROM scrape_jobs
       ORDER BY created_at DESC
       LIMIT 50`
    );
    res.json({ jobs: result.rows });
  } catch (err) {
    console.error("❌ Failed to fetch scrape jobs:", err);
    res.status(500).json({ error: "Failed to fetch scrape jobs" });
  } finally {
    client.release();
  }
});

// POST /api/admin/trigger-scrape — manually trigger a scrape job
// Heavy rate limited to prevent abuse
router.post("/trigger-scrape", heavyLimiter, async (_req: Request, res: Response) => {
  try {
    // Run scrape in background — don't await the full job
    const jobPromise = runScrapeJob();

    // Return immediately with acknowledgment
    res.json({
      message: "Scrape job triggered",
      status: "running",
      triggeredAt: new Date().toISOString(),
    });

    // Let the job complete in background
    jobPromise.then((result) => {
      console.log(`✅ Manual scrape complete: ${result.courtsProcessed} courts, ${result.eventsFound} events, ${result.eventsChanged} changes`);
    }).catch((err) => {
      console.error("❌ Manual scrape failed:", err);
    });
  } catch (err) {
    console.error("❌ Failed to trigger scrape:", err);
    res.status(500).json({ error: "Failed to trigger scrape job" });
  }
});

// GET /api/admin/pool-stats — current connection pool stats
router.get("/pool-stats", (_req: Request, res: Response) => {
  const stats = getPoolStats();
  if (!stats) {
    res.json({ pool: null, message: "Pool not initialized" });
    return;
  }
  res.json({ pool: stats });
});

// GET /api/admin/stats — aggregate event stats
router.get("/stats", async (_req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const client = await pool.connect();
  try {
    const [eventsResult, usersResult, watchedResult, connectionsResult] = await Promise.all([
      client.query(`SELECT COUNT(*) as total, COUNT(DISTINCT court_name) as courts FROM court_events`),
      client.query(`SELECT COUNT(*) as total FROM users`),
      client.query(`SELECT COUNT(*) as total FROM watched_cases WHERE is_active = true`),
      client.query(`SELECT COUNT(*) as total FROM calendar_connections WHERE is_active = true`),
    ]);

    res.json({
      events: {
        total: parseInt(eventsResult.rows[0].total, 10),
        courts: parseInt(eventsResult.rows[0].courts, 10),
      },
      users: parseInt(usersResult.rows[0].total, 10),
      watchedCases: parseInt(watchedResult.rows[0].total, 10),
      calendarConnections: parseInt(connectionsResult.rows[0].total, 10),
    });
  } catch (err) {
    console.error("❌ Failed to fetch stats:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  } finally {
    client.release();
  }
});

export default router;
