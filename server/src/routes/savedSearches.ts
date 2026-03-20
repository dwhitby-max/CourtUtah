import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { getPool } from "../db/pool";

const router = Router();

router.use(authenticateToken);

// GET /api/saved-searches — list user's saved searches
router.get("/", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, search_params, label, results_count, last_run_at, is_active, created_at, updated_at
       FROM saved_searches
       WHERE user_id = $1 AND is_active = true
       ORDER BY last_run_at DESC`,
      [currentUser.userId]
    );
    res.json({ savedSearches: result.rows });
  } catch (err) {
    console.error("❌ GET /api/saved-searches failed:", err);
    res.status(500).json({ error: "Failed to fetch saved searches" });
  } finally {
    client.release();
  }
});

// PATCH /api/saved-searches/:id — update saved search settings (e.g. autoAddToCalendar)
router.patch("/:id", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const { autoAddToCalendar } = req.body;
  const client = await pool.connect();
  try {
    // Read current search_params, merge the flag, and save back
    const existing = await client.query(
      `SELECT search_params FROM saved_searches WHERE id = $1 AND user_id = $2 AND is_active = true`,
      [req.params.id, currentUser.userId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Saved search not found" });
      return;
    }

    const params = existing.rows[0].search_params || {};
    if (autoAddToCalendar) {
      params._autoAddToCalendar = "true";
    } else {
      delete params._autoAddToCalendar;
    }

    await client.query(
      `UPDATE saved_searches SET search_params = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
      [JSON.stringify(params), req.params.id, currentUser.userId]
    );
    res.json({ message: "Saved search updated", searchParams: params });
  } catch (err) {
    console.error("❌ PATCH /api/saved-searches/:id failed:", err);
    res.status(500).json({ error: "Failed to update saved search" });
  } finally {
    client.release();
  }
});

// DELETE /api/saved-searches/:id — remove a saved search
router.delete("/:id", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE saved_searches SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND is_active = true
       RETURNING id`,
      [req.params.id, currentUser.userId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Saved search not found" });
      return;
    }
    res.json({ message: "Saved search removed" });
  } catch (err) {
    console.error("❌ DELETE /api/saved-searches/:id failed:", err);
    res.status(500).json({ error: "Failed to delete saved search" });
  } finally {
    client.release();
  }
});

export default router;
