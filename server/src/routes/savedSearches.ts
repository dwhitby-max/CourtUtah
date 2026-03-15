import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { getPool } from "../db/pool";

const router = Router();

router.use(authenticateToken);

// GET /api/saved-searches — list user's saved searches
router.get("/", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, search_params, label, results_count, last_run_at, is_active, created_at, updated_at
       FROM saved_searches
       WHERE user_id = $1 AND is_active = true
       ORDER BY last_run_at DESC`,
      [req.user.userId]
    );
    res.json({ savedSearches: result.rows });
  } catch (err) {
    console.error("❌ GET /api/saved-searches failed:", err);
    res.status(500).json({ error: "Failed to fetch saved searches" });
  } finally {
    client.release();
  }
});

// DELETE /api/saved-searches/:id — remove a saved search
router.delete("/:id", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE saved_searches SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND is_active = true
       RETURNING id`,
      [req.params.id, req.user.userId]
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
