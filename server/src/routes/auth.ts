import { Router, Request, Response } from "express";
import crypto from "crypto";
import { getPool } from "../db/pool";
import { generateToken, authenticateToken } from "../middleware/auth";
import { heavyLimiter } from "../middleware/rateLimiter";
import { config } from "../config/env";
import { encrypt } from "../services/encryptionService";

const router = Router();

// In-memory state store for CSRF protection on OAuth flow
const oauthStates = new Map<string, { createdAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Periodic cleanup of expired states
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of oauthStates) {
    if (now - val.createdAt > STATE_TTL_MS) oauthStates.delete(key);
  }
}, 60 * 1000).unref();

// GET /api/auth/google — Initiate Google OAuth (public, no JWT required)
router.get("/google", heavyLimiter, (_req: Request, res: Response) => {
  if (!config.google.clientId || !config.google.clientSecret) {
    res.status(503).json({ error: "Google OAuth not configured — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET" });
    return;
  }

  const state = crypto.randomBytes(32).toString("hex");
  oauthStates.set(state, { createdAt: Date.now() });

  const scopes = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
  ];

  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// GET /api/auth/google/callback — Handle Google OAuth callback (public)
router.get("/google/callback", async (req: Request, res: Response) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    console.error("❌ Google OAuth error:", oauthError);
    res.redirect("/login?error=google_denied");
    return;
  }

  if (!code || !state || typeof state !== "string") {
    res.redirect("/login?error=missing_params");
    return;
  }

  // Validate state token (CSRF protection)
  const stateEntry = oauthStates.get(state);
  if (!stateEntry || Date.now() - stateEntry.createdAt > STATE_TTL_MS) {
    oauthStates.delete(state);
    res.redirect("/login?error=invalid_state");
    return;
  }
  oauthStates.delete(state); // One-time use

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(code),
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: config.google.redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      console.error("❌ Google token exchange failed:", tokens.error_description || tokens.error);
      res.redirect("/login?error=google_failed");
      return;
    }

    // Fetch user info from Google
    const userinfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const userinfo = await userinfoResponse.json();

    if (!userinfo.id || !userinfo.email) {
      console.error("❌ Google userinfo missing id or email");
      res.redirect("/login?error=google_failed");
      return;
    }

    const pool = getPool();
    if (!pool) {
      res.redirect("/login?error=db_unavailable");
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Find user by google_id, or by email, or create new
      let userId: number;

      const byGoogleId = await client.query(
        "SELECT id, email FROM users WHERE google_id = $1",
        [userinfo.id]
      );

      if (byGoogleId.rows.length > 0) {
        // Existing Google user — update email if changed
        userId = byGoogleId.rows[0].id;
        await client.query(
          `UPDATE users SET email = $1, email_verified = true, updated_at = NOW() WHERE id = $2`,
          [userinfo.email.toLowerCase(), userId]
        );
      } else {
        // Check if email already exists (link accounts)
        const byEmail = await client.query(
          "SELECT id FROM users WHERE email = $1",
          [userinfo.email.toLowerCase()]
        );

        if (byEmail.rows.length > 0) {
          userId = byEmail.rows[0].id;
          await client.query(
            `UPDATE users SET google_id = $1, email_verified = true, updated_at = NOW() WHERE id = $2`,
            [userinfo.id, userId]
          );
        } else {
          // Create new user
          const newUser = await client.query(
            `INSERT INTO users (email, google_id, email_verified, notification_preferences)
             VALUES ($1, $2, true, '{"emailEnabled": true, "smsEnabled": false, "inAppEnabled": true, "frequency": "immediate"}')
             RETURNING id`,
            [userinfo.email.toLowerCase(), userinfo.id]
          );
          userId = newUser.rows[0].id;
        }
      }

      // Upsert calendar connection
      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null;

      const existingConn = await client.query(
        "SELECT id FROM calendar_connections WHERE user_id = $1 AND provider = 'google'",
        [userId]
      );

      if (existingConn.rows.length > 0) {
        await client.query(
          `UPDATE calendar_connections
           SET access_token_encrypted = $1,
               refresh_token_encrypted = COALESCE($2, refresh_token_encrypted),
               token_expires_at = $3,
               is_active = true,
               updated_at = NOW()
           WHERE user_id = $4 AND provider = 'google'`,
          [
            encrypt(tokens.access_token),
            tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
            expiresAt,
            userId,
          ]
        );
      } else {
        await client.query(
          `INSERT INTO calendar_connections
           (user_id, provider, access_token_encrypted, refresh_token_encrypted, token_expires_at, calendar_id)
           VALUES ($1, 'google', $2, $3, $4, 'primary')`,
          [
            userId,
            encrypt(tokens.access_token),
            tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
            expiresAt,
          ]
        );
      }

      await client.query("COMMIT");

      // Generate JWT and redirect to client callback
      const jwt = generateToken({ userId, email: userinfo.email.toLowerCase() });
      res.redirect(`/login/callback?token=${encodeURIComponent(jwt)}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("❌ Google OAuth callback failed:", err);
    res.redirect("/login?error=google_failed");
  }
});

// GET /api/auth/me — Get current user profile (requires JWT)
router.get("/me", authenticateToken, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, email, phone, email_verified, google_id, is_admin, notification_preferences, calendar_preferences, created_at
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
        isAdmin: user.is_admin || false,
        notificationPreferences: user.notification_preferences,
        calendarPreferences: user.calendar_preferences || {},
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    console.error("❌ GET /api/auth/me failed:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  } finally {
    client.release();
  }
});

// PATCH /api/auth/profile — Update profile (requires JWT)
router.patch("/profile", authenticateToken, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const { phone, notificationPreferences, calendarPreferences } = req.body;

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

    values.push(req.user.userId);
    await client.query(
      `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${paramIdx}`,
      values
    );

    const result = await client.query(
      `SELECT id, email, phone, email_verified, google_id, is_admin, notification_preferences, calendar_preferences, created_at FROM users WHERE id = $1`,
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
        isAdmin: user.is_admin || false,
        notificationPreferences: user.notification_preferences,
        calendarPreferences: user.calendar_preferences || {},
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
