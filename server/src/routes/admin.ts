import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { requireAdmin } from "../middleware/adminAuth";
import { heavyLimiter } from "../middleware/rateLimiter";
import { getPool, getPoolStats } from "../db/pool";
import { runScrapeJob } from "../services/schedulerService";
import { fetchCourtList } from "../services/courtScraper";

const router = Router();

router.use(authenticateToken);
router.use(requireAdmin);

// ─── Scrape Jobs ───

// GET /api/admin/scrape-jobs — list recent scrape jobs
router.get("/scrape-jobs", async (_req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, status, courts_processed, events_found, events_changed,
              error_message, started_at, completed_at, created_at
       FROM scrape_jobs ORDER BY created_at DESC LIMIT 50`
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
router.post("/trigger-scrape", heavyLimiter, async (_req: Request, res: Response) => {
  try {
    const jobPromise = runScrapeJob();
    res.json({ message: "Scrape job triggered", status: "running", triggeredAt: new Date().toISOString() });
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

// ─── Pool & Stats ───

router.get("/pool-stats", (_req: Request, res: Response) => {
  const stats = getPoolStats();
  if (!stats) { res.json({ pool: null, message: "Pool not initialized" }); return; }
  res.json({ pool: stats });
});

router.get("/stats", async (_req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

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

// ─── Users ───

// GET /api/admin/users — list all users
router.get("/users", async (_req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, email, phone, email_verified, is_admin, created_at,
              (SELECT COUNT(*) FROM watched_cases wc WHERE wc.user_id = u.id AND wc.is_active = true) as watched_count,
              (SELECT COUNT(*) FROM calendar_connections cc WHERE cc.user_id = u.id AND cc.is_active = true) as calendar_count
       FROM users u ORDER BY created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error("❌ Failed to fetch users:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  } finally {
    client.release();
  }
});

// PATCH /api/admin/users/:id — update user (toggle admin, etc.)
router.patch("/users/:id", async (req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const { isAdmin } = req.body;
  const userId = parseInt(req.params.id, 10);

  const client = await pool.connect();
  try {
    if (isAdmin !== undefined) {
      await client.query("UPDATE users SET is_admin = $1, updated_at = NOW() WHERE id = $2", [isAdmin, userId]);
    }
    res.json({ message: "User updated" });
  } catch (err) {
    console.error("❌ Failed to update user:", err);
    res.status(500).json({ error: "Failed to update user" });
  } finally {
    client.release();
  }
});

// ─── Court Whitelist ───

// GET /api/admin/court-whitelist — get the current whitelist
router.get("/court-whitelist", async (_req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT value FROM app_settings WHERE key = 'court_whitelist'"
    );
    const whitelist = result.rows.length > 0 ? result.rows[0].value : [];
    res.json({ whitelist });
  } catch (err) {
    console.error("❌ Failed to fetch court whitelist:", err);
    res.status(500).json({ error: "Failed to fetch court whitelist" });
  } finally {
    client.release();
  }
});

// PUT /api/admin/court-whitelist — update the whitelist
router.put("/court-whitelist", async (req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const { whitelist } = req.body;
  if (!Array.isArray(whitelist)) {
    res.status(400).json({ error: "whitelist must be an array of location codes" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('court_whitelist', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(whitelist)]
    );
    res.json({ message: "Court whitelist updated", whitelist });
  } catch (err) {
    console.error("❌ Failed to update court whitelist:", err);
    res.status(500).json({ error: "Failed to update court whitelist" });
  } finally {
    client.release();
  }
});

// GET /api/admin/available-courts — fetch all courts from utcourts.gov
router.get("/available-courts", async (_req: Request, res: Response) => {
  try {
    const courts = await fetchCourtList();
    res.json({ courts });
  } catch (err) {
    console.error("❌ Failed to fetch available courts:", err);
    res.status(500).json({ error: "Failed to fetch court list from utcourts.gov" });
  }
});

// ─── App Settings ───

// GET /api/admin/settings — get all app settings
router.get("/settings", async (_req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query("SELECT key, value, updated_at FROM app_settings ORDER BY key");
    const settings: Record<string, unknown> = {};
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }
    res.json({ settings });
  } catch (err) {
    console.error("❌ Failed to fetch settings:", err);
    res.status(500).json({ error: "Failed to fetch settings" });
  } finally {
    client.release();
  }
});

// PUT /api/admin/settings/:key — update a single setting
router.put("/settings/:key", async (req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const { value } = req.body;
  const key = req.params.key;

  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
    res.json({ message: `Setting '${key}' updated` });
  } catch (err) {
    console.error("❌ Failed to update setting:", err);
    res.status(500).json({ error: "Failed to update setting" });
  } finally {
    client.release();
  }
});

export default router;
