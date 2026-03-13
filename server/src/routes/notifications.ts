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

  const limit = Math.min(parseInt(String(req.query.limit) || "50", 10), 100);
  const offset = parseInt(String(req.query.offset) || "0", 10);

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [currentUser.userId, limit, offset]
    );

    const countResult = await client.query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE read = false) as unread_count
       FROM notifications WHERE user_id = $1`,
      [currentUser.userId]
    );

    res.json({
      notifications: result.rows,
      unreadCount: parseInt(countResult.rows[0].unread_count, 10),
      total: parseInt(countResult.rows[0].total, 10),
    });
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
  } finally {
    client.release();
  }
});

export default router;
