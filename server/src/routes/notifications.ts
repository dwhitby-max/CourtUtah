import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { getPool } from "../db/pool";

const router = Router();

router.use(authenticateToken);

// GET /api/notifications
router.get("/", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const rawLimit = req.query.limit !== undefined ? String(req.query.limit) : "50";
  const rawOffset = req.query.offset !== undefined ? String(req.query.offset) : "0";
  const limit = Math.min(parseInt(rawLimit, 10), 100);
  const offset = parseInt(rawOffset, 10);

  if (isNaN(limit) || isNaN(offset) || limit < 0 || offset < 0) {
    res.status(400).json({ error: "Invalid limit or offset" });
    return;
  }

  const client = await pool.connect();
  try {
    // Exclude notifications whose saved search was deleted (saved_search_id set
    // but no longer points to an active saved_searches row).
    const result = await client.query(
      `SELECT * FROM notifications n
       WHERE n.user_id = $1
         AND (
           n.saved_search_id IS NULL
           OR EXISTS (SELECT 1 FROM saved_searches ss WHERE ss.id = n.saved_search_id AND ss.is_active = true)
         )
       ORDER BY n.created_at DESC
       LIMIT $2 OFFSET $3`,
      [currentUser.userId, limit, offset]
    );

    const countResult = await client.query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE n.read = false) as unread_count
       FROM notifications n
       WHERE n.user_id = $1
         AND (
           n.saved_search_id IS NULL
           OR EXISTS (SELECT 1 FROM saved_searches ss WHERE ss.id = n.saved_search_id AND ss.is_active = true)
         )`,
      [currentUser.userId]
    );

    res.json({
      notifications: result.rows,
      unreadCount: parseInt(countResult.rows[0].unread_count, 10),
      total: parseInt(countResult.rows[0].total, 10),
    });
  } catch (err) {
    console.error("❌ GET /api/notifications failed:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  } finally {
    client.release();
  }
});

// PATCH /api/notifications/:id/read
router.patch("/:id/read", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, currentUser.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    res.json({ message: "Notification marked as read" });
  } catch (err) {
    console.error("❌ PATCH /api/notifications/:id/read failed:", err);
    res.status(500).json({ error: "Failed to update notification" });
  } finally {
    client.release();
  }
});

// PATCH /api/notifications/read-all
router.patch("/read-all", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE notifications SET read = true WHERE user_id = $1 AND read = false`,
      [currentUser.userId]
    );
    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    console.error("❌ PATCH /api/notifications/read-all failed:", err);
    res.status(500).json({ error: "Failed to mark notifications as read" });
  } finally {
    client.release();
  }
});

// GET /api/notifications/changes-feed — recent changes (new, modified, cancelled) for the user
// Returns unread notifications of actionable types, used by SearchResultsPage to show
// changes prominently on first view. Marking them as read hides them on subsequent views.
router.get("/changes-feed", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    // Fetch unread notifications of types that represent court-side changes.
    // Only include notifications whose saved search still exists (or that
    // pre-date the saved_search_id column and have no FK set).
    const result = await client.query(
      `SELECT n.id, n.type, n.title, n.message, n.metadata, n.created_at
       FROM notifications n
       WHERE n.user_id = $1
         AND n.read = false
         AND n.type IN ('schedule_change', 'new_match', 'event_cancelled')
         AND (
           n.saved_search_id IS NULL
           OR EXISTS (SELECT 1 FROM saved_searches ss WHERE ss.id = n.saved_search_id AND ss.is_active = true)
         )
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [currentUser.userId]
    );

    res.json({ changes: result.rows });
  } catch (err) {
    console.error("❌ GET /api/notifications/changes-feed failed:", err);
    res.status(500).json({ error: "Failed to fetch changes feed" });
  } finally {
    client.release();
  }
});

// PATCH /api/notifications/mark-seen — mark specific notification IDs as read (batch)
router.patch("/mark-seen", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array" });
    return;
  }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE notifications SET read = true WHERE id = ANY($1) AND user_id = $2`,
      [ids, currentUser.userId]
    );
    res.json({ message: `Marked ${ids.length} notifications as read` });
  } catch (err) {
    console.error("❌ PATCH /api/notifications/mark-seen failed:", err);
    res.status(500).json({ error: "Failed to mark notifications" });
  } finally {
    client.release();
  }
});

export default router;
