import { Router, Request, Response } from "express";
import crypto from "crypto";
import { getPool } from "../db/pool";
import { generateToken, authenticateToken } from "../middleware/auth";
import { heavyLimiter } from "../middleware/rateLimiter";
import { config } from "../config/env";
import { encrypt } from "../services/encryptionService";
import { sendNewSignupNotification } from "../services/emailService";
import authProfileRouter from "./authProfile";

const router = Router();

// In-memory state store for CSRF protection on OAuth flow
const oauthStates = new Map<string, { createdAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// In-memory store for one-time auth codes (replaces JWT-in-URL)
const authCodes = new Map<string, { jwt: string; createdAt: number }>();
const AUTH_CODE_TTL_MS = 60 * 1000; // 1 minute — codes are exchanged immediately

// Periodic cleanup of expired states and auth codes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of oauthStates) {
    if (now - val.createdAt > STATE_TTL_MS) oauthStates.delete(key);
  }
  for (const [key, val] of authCodes) {
    if (now - val.createdAt > AUTH_CODE_TTL_MS) authCodes.delete(key);
  }
}, 60 * 1000).unref();

function resolveRedirectUri(req: Request, path: string = "/api/auth/google/callback"): string {
  // In production, always use configured redirect URIs — never trust request headers
  if (config.nodeEnv === "production") {
    if (path === "/api/auth/microsoft/callback") {
      return config.microsoft.authRedirectUri;
    }
    return config.google.redirectUri;
  }

  // Development only: derive from forwarded headers for local/preview convenience
  const forwardedHost = req.get("x-forwarded-host") || req.get("host") || "";
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  if (forwardedHost && forwardedHost !== "localhost" && !forwardedHost.startsWith("localhost:")) {
    return `${proto}://${forwardedHost}${path}`;
  }
  if (path === "/api/auth/microsoft/callback") {
    return config.microsoft.authRedirectUri;
  }
  return config.google.redirectUri;
}

// GET /api/auth/google — Initiate Google OAuth (public, no JWT required)
router.get("/google", heavyLimiter, (req: Request, res: Response) => {
  if (!config.google.clientId || !config.google.clientSecret) {
    res.status(503).json({ error: "Google OAuth not configured — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET" });
    return;
  }

  const state = crypto.randomBytes(32).toString("hex");
  oauthStates.set(state, { createdAt: Date.now() });

  const redirectUri = resolveRedirectUri(req);
  console.log(`🔑 Google OAuth initiated, redirect_uri=${redirectUri}`);

  const scopes = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
  ];

  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
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
    console.error(`❌ Google OAuth callback missing params: code=${!!code}, state=${!!state}, query=${JSON.stringify(req.query)}, url=${req.originalUrl}`);
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
    const redirectUri = resolveRedirectUri(req);
    console.log(`🔑 Google OAuth callback, redirect_uri=${redirectUri}`);

    // Exchange authorization code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(code),
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      console.error("❌ Google token exchange failed:", tokens.error_description || tokens.error);
      res.redirect("/login?error=google_failed");
      return;
    }

    console.log(`✅ Google OAuth tokens received: access_token=${!!tokens.access_token}, refresh_token=${!!tokens.refresh_token}, expires_in=${tokens.expires_in}`);

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

      // Grandfathered account lists (shared across login paths)
      const grandfatheredEmails = ["dwhitby@gmail.com", "kittrellcourt@gmail.com", "yvetulia@gmail.com", "1564ventures@gmail.com"];
      const agencyEmails = ["yvetulia@gmail.com", "1564ventures@gmail.com"];
      const isGrandfathered = grandfatheredEmails.includes(userinfo.email.toLowerCase());

      if (byGoogleId.rows.length > 0) {
        // Existing Google user — update email if changed + ensure grandfathered status
        userId = byGoogleId.rows[0].id;
        if (isGrandfathered) {
          const grandfatheredAccountType = agencyEmails.includes(userinfo.email.toLowerCase()) ? "agency" : "individual_attorney";
          await client.query(
            `UPDATE users SET email = $1, email_verified = true,
             subscription_plan = 'pro', subscription_status = 'grandfathered',
             account_type = $3,
             updated_at = NOW() WHERE id = $2`,
            [userinfo.email.toLowerCase(), userId, grandfatheredAccountType]
          );
        } else {
          await client.query(
            `UPDATE users SET email = $1, email_verified = true, updated_at = NOW() WHERE id = $2`,
            [userinfo.email.toLowerCase(), userId]
          );
        }
      } else {
        // Check if email already exists (link accounts)
        const byEmail = await client.query(
          "SELECT id FROM users WHERE email = $1",
          [userinfo.email.toLowerCase()]
        );

        if (byEmail.rows.length > 0) {
          userId = byEmail.rows[0].id;
          if (isGrandfathered) {
            const grandfatheredAccountType = agencyEmails.includes(userinfo.email.toLowerCase()) ? "agency" : "individual_attorney";
            await client.query(
              `UPDATE users SET google_id = $1, email_verified = true,
               subscription_plan = 'pro', subscription_status = 'grandfathered',
               account_type = $3,
               updated_at = NOW() WHERE id = $2`,
              [userinfo.id, userId, grandfatheredAccountType]
            );
          } else {
            await client.query(
              `UPDATE users SET google_id = $1, email_verified = true, updated_at = NOW() WHERE id = $2`,
              [userinfo.id, userId]
            );
          }
        } else {
          // Create new user — auto-approved, admin notified
          const signupIp = req.ip || req.headers["x-forwarded-for"] || null;
          const grandfatheredAccountType = agencyEmails.includes(userinfo.email.toLowerCase()) ? "agency" : "individual_attorney";

          const newUser = await client.query(
            `INSERT INTO users (email, google_id, email_verified, signup_ip, is_approved, notification_preferences, subscription_plan, subscription_status, account_type)
             VALUES ($1, $2, true, $3, true, '{"emailEnabled": true, "smsEnabled": false, "inAppEnabled": true, "frequency": "immediate"}', $4, $5, $6)
             RETURNING id`,
            [userinfo.email.toLowerCase(), userinfo.id, signupIp, isGrandfathered ? "pro" : "free", isGrandfathered ? "grandfathered" : "none", isGrandfathered ? grandfatheredAccountType : null]
          );
          userId = newUser.rows[0].id;

          // Notify admin of new signup
          if (config.adminEmail) {
            sendNewSignupNotification(config.adminEmail, userinfo.email, String(signupIp || "")).catch((err) => {
              console.error("❌ Failed to send admin signup notification:", err);
            });
          } else {
            console.warn("⚠️ ADMIN_EMAIL not configured — skipping new signup notification");
          }
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

      // Verify refresh token exists — if Google didn't send one AND the DB doesn't have one,
      // calendar operations will fail after the access token expires (~1 hour)
      const connCheck = await client.query(
        "SELECT refresh_token_encrypted FROM calendar_connections WHERE user_id = $1 AND provider = 'google'",
        [userId]
      );
      if (connCheck.rows.length > 0 && !connCheck.rows[0].refresh_token_encrypted) {
        console.warn(`⚠️ Google OAuth for userId=${userId}: NO refresh token stored. Calendar will stop working after access token expires (~1 hour). User should revoke app access at https://myaccount.google.com/permissions and re-authorize.`);
      }

      await client.query("COMMIT");
      console.log(`✅ Google OAuth complete: userId=${userId}, email=${userinfo.email}, google_id=${userinfo.id}, refresh_token_received=${!!tokens.refresh_token}`);

      // Generate JWT and issue a one-time auth code (never expose JWT in URL)
      const jwtToken = generateToken({ userId, email: userinfo.email.toLowerCase() });
      const code = crypto.randomBytes(32).toString("hex");
      authCodes.set(code, { jwt: jwtToken, createdAt: Date.now() });
      res.redirect(`/login/callback?code=${encodeURIComponent(code)}`);
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

// GET /api/auth/microsoft — Initiate Microsoft OAuth (public, no JWT required)
router.get("/microsoft", heavyLimiter, (req: Request, res: Response) => {
  if (!config.microsoft.clientId || !config.microsoft.clientSecret) {
    res.status(503).json({ error: "Microsoft OAuth not configured — add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET" });
    return;
  }

  const state = crypto.randomBytes(32).toString("hex");
  oauthStates.set(state, { createdAt: Date.now() });

  const redirectUri = resolveRedirectUri(req, "/api/auth/microsoft/callback");
  console.log(`🔑 Microsoft OAuth initiated, redirect_uri=${redirectUri}`);

  const scopes = [
    "openid",
    "email",
    "profile",
    "User.Read",
    "Calendars.ReadWrite",
    "offline_access",
  ];

  const params = new URLSearchParams({
    client_id: config.microsoft.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    state,
  });

  res.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`);
});

// GET /api/auth/microsoft/callback — Handle Microsoft OAuth callback (public)
router.get("/microsoft/callback", async (req: Request, res: Response) => {
  const { code, state, error: oauthError, error_description } = req.query;

  if (oauthError) {
    console.error("❌ Microsoft OAuth error:", error_description || oauthError);
    res.redirect("/login?error=microsoft_denied");
    return;
  }

  if (!code || !state || typeof state !== "string") {
    console.error(`❌ Microsoft OAuth callback missing params: code=${!!code}, state=${!!state}`);
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
    const redirectUri = resolveRedirectUri(req, "/api/auth/microsoft/callback");
    console.log(`🔑 Microsoft OAuth callback, redirect_uri=${redirectUri}`);

    // Exchange authorization code for tokens
    const tokenBody = new URLSearchParams({
      code: String(code),
      client_id: config.microsoft.clientId,
      client_secret: config.microsoft.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    console.log(`🔑 Microsoft token exchange: redirect_uri=${redirectUri}, client_id=${config.microsoft.clientId ? config.microsoft.clientId.substring(0, 8) + '...' : 'MISSING'}`);

    const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      console.error("❌ Microsoft token exchange failed:", tokens.error, tokens.error_description);
      res.redirect("/login?error=microsoft_failed");
      return;
    }

    console.log(`✅ Microsoft OAuth tokens received: access_token=${!!tokens.access_token}, refresh_token=${!!tokens.refresh_token}, expires_in=${tokens.expires_in}`);

    // Fetch user info from Microsoft Graph
    const userinfoResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const userinfo = await userinfoResponse.json();

    if (!userinfo.id) {
      console.error("❌ Microsoft userinfo missing id, response:", JSON.stringify(userinfo));
      res.redirect("/login?error=microsoft_failed");
      return;
    }

    // Microsoft Graph returns mail or userPrincipalName for the email
    const email = (userinfo.mail || userinfo.userPrincipalName || "").toLowerCase();
    if (!email) {
      console.error("❌ Microsoft userinfo missing email (mail and userPrincipalName both empty)");
      res.redirect("/login?error=microsoft_failed");
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

      // Find user by microsoft_id, or by email, or create new
      let userId: number;

      const byMicrosoftId = await client.query(
        "SELECT id, email FROM users WHERE microsoft_id = $1",
        [userinfo.id]
      );

      // Grandfathered account lists (shared across login paths)
      const grandfatheredEmails = ["dwhitby@gmail.com", "kittrellcourt@gmail.com", "yvetulia@gmail.com", "1564ventures@gmail.com"];
      const agencyEmails = ["yvetulia@gmail.com", "1564ventures@gmail.com"];
      const isGrandfathered = grandfatheredEmails.includes(email);

      if (byMicrosoftId.rows.length > 0) {
        // Existing Microsoft user — update email if changed
        userId = byMicrosoftId.rows[0].id;
        if (isGrandfathered) {
          const grandfatheredAccountType = agencyEmails.includes(email) ? "agency" : "individual_attorney";
          await client.query(
            `UPDATE users SET email = $1, email_verified = true,
             subscription_plan = 'pro', subscription_status = 'grandfathered',
             account_type = $3,
             updated_at = NOW() WHERE id = $2`,
            [email, userId, grandfatheredAccountType]
          );
        } else {
          await client.query(
            `UPDATE users SET email = $1, email_verified = true, updated_at = NOW() WHERE id = $2`,
            [email, userId]
          );
        }
      } else {
        // Check if email already exists (link accounts)
        const byEmail = await client.query(
          "SELECT id FROM users WHERE email = $1",
          [email]
        );

        if (byEmail.rows.length > 0) {
          userId = byEmail.rows[0].id;
          if (isGrandfathered) {
            const grandfatheredAccountType = agencyEmails.includes(email) ? "agency" : "individual_attorney";
            await client.query(
              `UPDATE users SET microsoft_id = $1, email_verified = true,
               subscription_plan = 'pro', subscription_status = 'grandfathered',
               account_type = $3,
               updated_at = NOW() WHERE id = $2`,
              [userinfo.id, userId, grandfatheredAccountType]
            );
          } else {
            await client.query(
              `UPDATE users SET microsoft_id = $1, email_verified = true, updated_at = NOW() WHERE id = $2`,
              [userinfo.id, userId]
            );
          }
        } else {
          // Create new user — auto-approved, admin notified
          const signupIp = req.ip || req.headers["x-forwarded-for"] || null;
          const grandfatheredAccountType = agencyEmails.includes(email) ? "agency" : "individual_attorney";

          const newUser = await client.query(
            `INSERT INTO users (email, microsoft_id, email_verified, signup_ip, is_approved, notification_preferences, subscription_plan, subscription_status, account_type)
             VALUES ($1, $2, true, $3, true, '{"emailEnabled": true, "smsEnabled": false, "inAppEnabled": true, "frequency": "immediate"}', $4, $5, $6)
             RETURNING id`,
            [email, userinfo.id, signupIp, isGrandfathered ? "pro" : "free", isGrandfathered ? "grandfathered" : "none", isGrandfathered ? grandfatheredAccountType : null]
          );
          userId = newUser.rows[0].id;

          // Notify admin of new signup
          if (config.adminEmail) {
            sendNewSignupNotification(config.adminEmail, email, String(signupIp || "")).catch((err) => {
              console.error("❌ Failed to send admin signup notification:", err);
            });
          } else {
            console.warn("⚠️ ADMIN_EMAIL not configured — skipping new signup notification");
          }
        }
      }

      // Upsert calendar connection
      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null;

      const existingConn = await client.query(
        "SELECT id FROM calendar_connections WHERE user_id = $1 AND provider = 'microsoft'",
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
           WHERE user_id = $4 AND provider = 'microsoft'`,
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
           (user_id, provider, access_token_encrypted, refresh_token_encrypted, token_expires_at)
           VALUES ($1, 'microsoft', $2, $3, $4)`,
          [
            userId,
            encrypt(tokens.access_token),
            tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
            expiresAt,
          ]
        );
      }

      await client.query("COMMIT");
      console.log(`✅ Microsoft OAuth complete: userId=${userId}, email=${email}, microsoft_id=${userinfo.id}, refresh_token_received=${!!tokens.refresh_token}`);

      // Generate JWT and issue a one-time auth code (never expose JWT in URL)
      const jwtToken = generateToken({ userId, email });
      const code = crypto.randomBytes(32).toString("hex");
      authCodes.set(code, { jwt: jwtToken, createdAt: Date.now() });
      res.redirect(`/login/callback?code=${encodeURIComponent(code)}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("❌ Microsoft OAuth callback failed:", err);
    res.redirect("/login?error=microsoft_failed");
  }
});

// POST /api/auth/exchange-code — Exchange a one-time auth code for a JWT
router.post("/exchange-code", heavyLimiter, (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "Missing auth code" });
    return;
  }

  const entry = authCodes.get(code);
  if (!entry || Date.now() - entry.createdAt > AUTH_CODE_TTL_MS) {
    authCodes.delete(code);
    res.status(401).json({ error: "Invalid or expired auth code" });
    return;
  }

  authCodes.delete(code); // One-time use
  res.json({ token: entry.jwt });
});

// Mount profile-related routes (GET /me, POST /accept-terms, PATCH /profile)
router.use("/", authProfileRouter);

export default router;
