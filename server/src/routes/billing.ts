import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { authenticateToken } from "../middleware/auth";
import { heavyLimiter } from "../middleware/rateLimiter";
import { getPool } from "../db/pool";
import { config } from "../config/env";

const router = Router();

function getStripe(): Stripe | null {
  if (!config.stripe.secretKey) return null;
  return new Stripe(config.stripe.secretKey);
}

// POST /api/billing/create-checkout-session — Start Stripe Checkout
router.post("/create-checkout-session", authenticateToken, heavyLimiter, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }

  const stripe = getStripe();
  if (!stripe || !config.stripe.priceId) {
    res.status(503).json({ error: "Stripe not configured" });
    return;
  }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const userResult = await client.query(
      "SELECT email, stripe_customer_id, subscription_status FROM users WHERE id = $1",
      [req.user.userId]
    );
    if (userResult.rows.length === 0) { res.status(404).json({ error: "User not found" }); return; }
    const user = userResult.rows[0];

    // Don't allow if already active
    if (user.subscription_status === "active") {
      res.status(400).json({ error: "You already have an active subscription" });
      return;
    }

    // Create or reuse Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: String(req.user.userId) },
      });
      customerId = customer.id;
      await client.query(
        "UPDATE users SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2",
        [customerId, req.user.userId]
      );
    }

    // Use configured base URL for Stripe return URLs (never trust request headers)
    const baseUrl = config.appBaseUrl;
    if (!baseUrl) {
      res.status(503).json({ error: "APP_BASE_URL not configured — cannot create checkout session" });
      return;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: config.stripe.priceId, quantity: 1 }],
      success_url: `${baseUrl}/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/billing`,
      metadata: { userId: String(req.user.userId) },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Checkout session creation failed:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  } finally {
    client.release();
  }
});

// POST /api/billing/create-portal-session — Stripe Customer Portal
router.post("/create-portal-session", authenticateToken, heavyLimiter, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }

  const stripe = getStripe();
  if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT stripe_customer_id FROM users WHERE id = $1",
      [req.user.userId]
    );
    if (result.rows.length === 0 || !result.rows[0].stripe_customer_id) {
      res.status(400).json({ error: "No billing account found" });
      return;
    }

    // Use configured base URL for Stripe return URLs (never trust request headers)
    const baseUrl = config.appBaseUrl;
    if (!baseUrl) {
      res.status(503).json({ error: "APP_BASE_URL not configured — cannot create portal session" });
      return;
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: result.rows[0].stripe_customer_id,
      return_url: `${baseUrl}/billing`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Portal session creation failed:", err);
    res.status(500).json({ error: "Failed to create portal session" });
  } finally {
    client.release();
  }
});

// GET /api/billing/subscription — Current subscription status
router.get("/subscription", authenticateToken, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT subscription_plan, subscription_status, subscription_current_period_end
       FROM users WHERE id = $1`,
      [req.user.userId]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: "User not found" }); return; }

    const row = result.rows[0];
    res.json({
      plan: row.subscription_plan || "free",
      status: row.subscription_status || "none",
      currentPeriodEnd: row.subscription_current_period_end || null,
    });
  } finally {
    client.release();
  }
});

// POST /api/billing/activate — Verify checkout session and activate subscription immediately
router.post("/activate", authenticateToken, heavyLimiter, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }

  const stripe = getStripe();
  if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

  const { sessionId } = req.body;
  if (!sessionId || typeof sessionId !== "string") {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    // Retrieve the checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid" || session.mode !== "subscription") {
      res.status(400).json({ error: "Payment not completed" });
      return;
    }

    // Verify this session belongs to the requesting user
    const userResult = await client.query(
      "SELECT stripe_customer_id FROM users WHERE id = $1",
      [req.user.userId]
    );
    const userCustomerId = userResult.rows[0]?.stripe_customer_id;
    if (!userCustomerId || session.customer !== userCustomerId) {
      res.status(403).json({ error: "Session does not belong to this account" });
      return;
    }

    // Retrieve the subscription for period end info
    const sub = await stripe.subscriptions.retrieve(session.subscription as string);
    const periodEnd = sub.items.data[0]?.current_period_end ?? null;

    await client.query(
      `UPDATE users SET
        subscription_plan = 'pro',
        subscription_status = 'active',
        subscription_id = $1,
        subscription_current_period_end = ${periodEnd ? 'to_timestamp($2)' : 'NULL'},
        stripe_customer_id = COALESCE(stripe_customer_id, $3),
        updated_at = NOW()
      WHERE id = $4`,
      [sub.id, periodEnd, session.customer, req.user.userId]
    );

    console.log(`✅ Subscription activated via /activate for userId=${req.user.userId}`);

    res.json({
      plan: "pro",
      status: "active",
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    });
  } catch (err) {
    console.error("❌ Activate subscription failed:", err);
    res.status(500).json({ error: "Failed to activate subscription" });
  } finally {
    client.release();
  }
});

// POST /api/billing/cancel — Cancel subscription at end of current period
router.post("/cancel", authenticateToken, heavyLimiter, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }

  const stripe = getStripe();
  if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT subscription_id, stripe_customer_id FROM users WHERE id = $1",
      [req.user.userId]
    );
    if (result.rows.length === 0 || !result.rows[0].subscription_id) {
      res.status(400).json({ error: "No active subscription found" });
      return;
    }

    // Cancel at period end — subscription stays active until the renewal date
    const sub = await stripe.subscriptions.update(result.rows[0].subscription_id, {
      cancel_at_period_end: true,
    }) as unknown as { id: string; current_period_end: number | null };

    const periodEnd = sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null;

    console.log(`🚫 Subscription ${sub.id} set to cancel at period end (${periodEnd})`);

    res.json({
      status: "canceling",
      cancelAt: periodEnd,
      message: `Your subscription will remain active until ${periodEnd ? new Date(periodEnd).toLocaleDateString() : "your renewal date"}. You will not be charged again.`,
    });
  } catch (err) {
    console.error("❌ Cancel subscription failed:", err);
    const message = err instanceof Error ? err.message : "Failed to cancel subscription";
    res.status(500).json({ error: message });
  } finally {
    client.release();
  }
});

// POST /api/billing/webhook — Stripe webhook events
router.post("/webhook", async (req: Request, res: Response) => {
  const stripe = getStripe();
  if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) { res.status(400).json({ error: "Missing stripe-signature header" }); return; }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
  } catch (err) {
    console.error("❌ Stripe webhook signature verification failed:", err instanceof Error ? err.message : err);
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.customer && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          const periodEnd = sub.items.data[0]?.current_period_end ?? null;
          await client.query(
            `UPDATE users SET
              subscription_plan = 'pro',
              subscription_status = 'active',
              subscription_id = $1,
              subscription_current_period_end = ${periodEnd ? 'to_timestamp($2)' : 'NULL'},
              stripe_customer_id = COALESCE(stripe_customer_id, $3),
              updated_at = NOW()
            WHERE stripe_customer_id = $3`,
            [sub.id, periodEnd, session.customer]
          );
          console.log(`✅ Subscription activated for customer ${session.customer}`);
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const status = sub.status; // active, past_due, canceled, etc.
        const plan = status === "active" || status === "trialing" ? "pro" : "free";
        const periodEnd = sub.items?.data?.[0]?.current_period_end ?? null;
        await client.query(
          `UPDATE users SET
            subscription_plan = $1,
            subscription_status = $2,
            subscription_current_period_end = ${periodEnd ? 'to_timestamp($3)' : 'NULL'},
            updated_at = NOW()
          WHERE stripe_customer_id = $4`,
          [plan, status, periodEnd, sub.customer]
        );
        console.log(`📋 Subscription updated for customer ${sub.customer}: ${status}`);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await client.query(
          `UPDATE users SET
            subscription_plan = 'free',
            subscription_status = 'canceled',
            subscription_id = NULL,
            updated_at = NOW()
          WHERE stripe_customer_id = $1`,
          [sub.customer]
        );
        console.log(`🚫 Subscription canceled for customer ${sub.customer}`);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.customer) {
          await client.query(
            `UPDATE users SET subscription_status = 'past_due', updated_at = NOW()
             WHERE stripe_customer_id = $1`,
            [invoice.customer]
          );
          console.log(`⚠️ Payment failed for customer ${invoice.customer}`);
        }
        break;
      }

      default:
        // Unhandled event type — that's fine
        break;
    }

    res.json({ received: true });
  } finally {
    client.release();
  }
});

export default router;
