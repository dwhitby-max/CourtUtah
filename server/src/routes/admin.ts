import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { authenticateToken } from "../middleware/auth";
import { requireAdmin } from "../middleware/adminAuth";
import { heavyLimiter } from "../middleware/rateLimiter";
import { getPool, getPoolStats } from "../db/pool";
import { refreshAllWatchedCases } from "../services/schedulerService";
import { sendAccountApprovedEmail } from "../services/emailService";
import { config } from "../config/env";

function getStripe(): Stripe | null {
  if (!config.stripe.secretKey) return null;
  return new Stripe(config.stripe.secretKey);
}

const router = Router();

router.use(authenticateToken);
router.use(requireAdmin);

// ─── Watched Case Refresh ───

// POST /api/admin/trigger-refresh — manually refresh all watched cases
router.post("/trigger-refresh", heavyLimiter, async (_req: Request, res: Response) => {
  try {
    const jobPromise = refreshAllWatchedCases();
    res.json({ message: "Watched-case refresh triggered", status: "running", triggeredAt: new Date().toISOString() });
    jobPromise.then((result) => {
      console.log(`✅ Manual refresh complete: ${result.casesChecked} cases, ${result.totalEvents} events, ${result.totalNewEntries} new entries`);
    }).catch((err) => {
      console.error("❌ Manual refresh failed:", err);
    });
  } catch (err) {
    console.error("❌ Failed to trigger refresh:", err);
    res.status(500).json({ error: "Failed to trigger refresh" });
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
      `SELECT id, email, phone, email_verified, is_admin, is_approved, created_at,
              subscription_plan, subscription_status, subscription_id, subscription_current_period_end, stripe_customer_id,
              (SELECT COUNT(*) FROM watched_cases wc WHERE wc.user_id = u.id AND wc.is_active = true) as watched_count,
              (SELECT COUNT(*) FROM watched_cases wc2 WHERE wc2.user_id = u.id AND wc2.source = 'auto_search' AND wc2.is_active = true) as search_count,
              (SELECT MAX(wc3.last_refreshed_at) FROM watched_cases wc3 WHERE wc3.user_id = u.id AND wc3.source = 'auto_search') as last_search_at,
              (SELECT COUNT(*) FROM calendar_connections cc WHERE cc.user_id = u.id AND cc.is_active = true) as calendar_count,
              (SELECT MAX(ce.updated_at) FROM calendar_entries ce WHERE ce.user_id = u.id AND ce.sync_status = 'synced') as last_sync_at
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

// PATCH /api/admin/users/:id — update user (toggle admin, approve/reject, etc.)
router.patch("/users/:id", async (req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const { isAdmin, isApproved } = req.body;
  const userId = parseInt(req.params.id, 10);

  const client = await pool.connect();
  try {
    if (isAdmin !== undefined) {
      await client.query("UPDATE users SET is_admin = $1, updated_at = NOW() WHERE id = $2", [isAdmin, userId]);
    }
    if (isApproved !== undefined) {
      await client.query("UPDATE users SET is_approved = $1, updated_at = NOW() WHERE id = $2", [isApproved, userId]);

      // Send approval email to the user
      if (isApproved) {
        const userResult = await client.query("SELECT email FROM users WHERE id = $1", [userId]);
        if (userResult.rows.length > 0) {
          const forwardedHost = req.get("x-forwarded-host") || req.get("host") || "";
          const proto = req.get("x-forwarded-proto") || req.protocol || "https";
          const appUrl = forwardedHost ? `${proto}://${forwardedHost}` : "";
          sendAccountApprovedEmail(userResult.rows[0].email, appUrl).catch((err) => {
            console.error("❌ Failed to send account approved email:", err);
          });
        }
      }
    }
    res.json({ message: "User updated" });
  } catch (err) {
    console.error("❌ Failed to update user:", err);
    res.status(500).json({ error: "Failed to update user" });
  } finally {
    client.release();
  }
});

// ─── Billing Management ───

// POST /api/admin/users/:id/cancel-subscription — Cancel a user's Stripe subscription (expires at period end)
router.post("/users/:id/cancel-subscription", heavyLimiter, async (req: Request, res: Response) => {
  const stripe = getStripe();
  if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const userId = parseInt(req.params.id, 10);
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT subscription_id, subscription_status FROM users WHERE id = $1",
      [userId]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: "User not found" }); return; }

    const { subscription_id, subscription_status } = result.rows[0];

    if (!subscription_id) {
      // No Stripe subscription — just reset to free directly (handles grandfathered users)
      await client.query(
        `UPDATE users SET subscription_plan = 'free', subscription_status = 'canceled',
         subscription_id = NULL, subscription_current_period_end = NULL, updated_at = NOW()
         WHERE id = $1`,
        [userId]
      );
      res.json({ message: "User plan reset to free" });
      return;
    }

    if (subscription_status === "canceled") {
      res.status(400).json({ error: "Subscription is already canceled" });
      return;
    }

    // Cancel at period end so user keeps access until their paid time expires
    const sub = await stripe.subscriptions.update(subscription_id, {
      cancel_at_period_end: true,
    });

    await client.query(
      `UPDATE users SET subscription_status = 'canceled',
       subscription_current_period_end = to_timestamp($1),
       updated_at = NOW()
       WHERE id = $2`,
      [sub.items.data[0]?.current_period_end ?? null, userId]
    );

    console.log(`🚫 Admin canceled subscription for userId=${userId}, expires at period end`);
    res.json({ message: "Subscription canceled — access continues until period end" });
  } catch (err) {
    console.error("❌ Failed to cancel subscription:", err);
    res.status(500).json({ error: "Failed to cancel subscription" });
  } finally {
    client.release();
  }
});

// GET /api/admin/users/:id/payment-history — Fetch payment history from Stripe
router.get("/users/:id/payment-history", async (req: Request, res: Response) => {
  const stripe = getStripe();
  if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const userId = parseInt(req.params.id, 10);
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT stripe_customer_id FROM users WHERE id = $1",
      [userId]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: "User not found" }); return; }

    const { stripe_customer_id } = result.rows[0];
    if (!stripe_customer_id) {
      res.json({ payments: [] });
      return;
    }

    // Fetch all invoices for this customer
    const invoices = await stripe.invoices.list({
      customer: stripe_customer_id,
      limit: 100,
    });

    const payments = invoices.data.map((inv) => ({
      id: inv.id,
      date: inv.created ? new Date(inv.created * 1000).toISOString() : null,
      amount: inv.amount_paid / 100,
      currency: inv.currency.toUpperCase(),
      status: inv.status,
      invoiceUrl: inv.hosted_invoice_url,
      periodStart: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
      periodEnd: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
    }));

    res.json({ payments });
  } catch (err) {
    console.error("❌ Failed to fetch payment history:", err);
    res.status(500).json({ error: "Failed to fetch payment history" });
  } finally {
    client.release();
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
