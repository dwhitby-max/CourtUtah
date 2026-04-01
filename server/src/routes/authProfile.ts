import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { getPool } from "../db/pool";

const router = Router();

// GET /api/auth/me — Get current user profile (requires JWT)
router.get("/me", authenticateToken, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, email, phone, email_verified, google_id, microsoft_id, is_admin, is_approved,
              notification_preferences, calendar_preferences, search_preferences, tos_agreed_at, created_at,
              subscription_plan, subscription_status, subscription_current_period_end
       FROM users WHERE id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const user = result.rows[0];
    res.json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        emailVerified: user.email_verified,
        googleConnected: !!user.google_id,
        microsoftConnected: !!user.microsoft_id,
        isAdmin: user.is_admin || false,
        isApproved: user.is_approved !== false,
        notificationPreferences: user.notification_preferences,
        calendarPreferences: user.calendar_preferences || {},
        searchPreferences: user.search_preferences || { defaultCourts: [] },
        tosAgreedAt: user.tos_agreed_at || null,
        createdAt: user.created_at,
        subscriptionPlan: user.subscription_plan || "free",
        subscriptionStatus: user.subscription_status || "none",
        subscriptionCurrentPeriodEnd: user.subscription_current_period_end || null,
      },
    });
  } catch (err) {
    console.error("❌ GET /api/auth/me failed:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  } finally {
    client.release();
  }
});

// POST /api/auth/accept-terms — Record terms acceptance (requires JWT)
router.post("/accept-terms", authenticateToken, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const tosIp = req.ip || req.headers["x-forwarded-for"] || null;
    await client.query(
      `UPDATE users SET tos_agreed_at = NOW(), tos_agreed_ip = $1, updated_at = NOW() WHERE id = $2`,
      [tosIp, req.user.userId]
    );

    const result = await client.query(
      `SELECT id, email, phone, email_verified, google_id, microsoft_id, is_admin, is_approved,
              notification_preferences, calendar_preferences, search_preferences, tos_agreed_at, created_at,
              subscription_plan, subscription_status, subscription_current_period_end
       FROM users WHERE id = $1`,
      [req.user.userId]
    );

    const user = result.rows[0];
    res.json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        emailVerified: user.email_verified,
        googleConnected: !!user.google_id,
        microsoftConnected: !!user.microsoft_id,
        isAdmin: user.is_admin || false,
        isApproved: user.is_approved !== false,
        notificationPreferences: user.notification_preferences,
        calendarPreferences: user.calendar_preferences || {},
        searchPreferences: user.search_preferences || { defaultCourts: [] },
        tosAgreedAt: user.tos_agreed_at,
        createdAt: user.created_at,
        subscriptionPlan: user.subscription_plan || "free",
        subscriptionStatus: user.subscription_status || "none",
        subscriptionCurrentPeriodEnd: user.subscription_current_period_end || null,
      },
    });
  } catch (err) {
    console.error("❌ POST /api/auth/accept-terms failed:", err);
    res.status(500).json({ error: "Failed to record terms acceptance" });
  } finally {
    client.release();
  }
});

// PATCH /api/auth/profile — Update profile (requires JWT)
router.patch("/profile", authenticateToken, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const { phone, notificationPreferences, calendarPreferences, searchPreferences } = req.body;

  const client = await pool.connect();
  try {
    // Only update fields that are present in the request
    const setClauses: string[] = ["updated_at = NOW()"];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (phone !== undefined) {
      setClauses.push(`phone = $${paramIdx++}`);
      values.push(phone || null);
    }
    if (notificationPreferences !== undefined) {
      setClauses.push(`notification_preferences = $${paramIdx++}`);
      values.push(JSON.stringify(notificationPreferences));
    }
    if (calendarPreferences !== undefined) {
      setClauses.push(`calendar_preferences = $${paramIdx++}`);
      values.push(JSON.stringify(calendarPreferences));
    }
    if (searchPreferences !== undefined) {
      setClauses.push(`search_preferences = $${paramIdx++}`);
      values.push(JSON.stringify(searchPreferences));
    }

    values.push(req.user.userId);
    await client.query(
      `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${paramIdx}`,
      values
    );

    const result = await client.query(
      `SELECT id, email, phone, email_verified, google_id, microsoft_id, is_admin, is_approved,
              notification_preferences, calendar_preferences, search_preferences, tos_agreed_at, created_at,
              subscription_plan, subscription_status, subscription_current_period_end
       FROM users WHERE id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const user = result.rows[0];
    res.json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        emailVerified: user.email_verified,
        googleConnected: !!user.google_id,
        microsoftConnected: !!user.microsoft_id,
        isAdmin: user.is_admin || false,
        isApproved: user.is_approved !== false,
        notificationPreferences: user.notification_preferences,
        calendarPreferences: user.calendar_preferences || {},
        searchPreferences: user.search_preferences || { defaultCourts: [] },
        tosAgreedAt: user.tos_agreed_at || null,
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    console.error("❌ PATCH /api/auth/profile failed:", err);
    res.status(500).json({ error: "Failed to update profile" });
  } finally {
    client.release();
  }
});

export default router;
