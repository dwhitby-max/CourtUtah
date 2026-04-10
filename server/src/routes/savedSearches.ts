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
      `SELECT id, search_type, search_value, label, search_params,
              results_count, last_refreshed_at, is_active, created_at
       FROM saved_searches
       WHERE user_id = $1 AND is_active = true AND source = 'auto_search'
       ORDER BY last_refreshed_at DESC NULLS LAST, created_at DESC`,
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

// DELETE /api/saved-searches/:id — delete a saved search
router.delete("/:id", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const searchId = parseInt(req.params.id, 10);
  if (isNaN(searchId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const client = await pool.connect();
  try {
    await client.query(
      `DELETE FROM saved_searches WHERE id = $1 AND user_id = $2`,
      [searchId, req.user.userId]
    );
    res.json({ message: "Saved search deleted" });
  } catch (err) {
    console.error("❌ DELETE /api/saved-searches/:id failed:", err);
    res.status(500).json({ error: "Failed to delete saved search" });
  } finally {
    client.release();
  }
});

export default router;
