import { Request, Response, NextFunction } from "express";
import { getPool } from "../db/pool";

/**
 * Middleware that checks if the authenticated user has is_admin = true.
 * Must be used after authenticateToken middleware.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const pool = getPool();
  if (!pool) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT is_admin FROM users WHERE id = $1",
      [req.user.userId]
    );

    if (result.rows.length === 0 || !result.rows[0].is_admin) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    next();
  } catch (err) {
    console.error("❌ Admin auth check failed:", err);
    res.status(500).json({ error: "Authorization check failed" });
  } finally {
    client.release();
  }
}
