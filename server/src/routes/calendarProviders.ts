import { Router, Request, Response } from "express";
import crypto from "crypto";
import { authenticateToken } from "../middleware/auth";
import { getPool } from "../db/pool";
import { config } from "../config/env";
import { encrypt } from "../services/encryptionService";
import { heavyLimiter } from "../middleware/rateLimiter";

const router = Router();

// In-memory state store for Microsoft calendar OAuth CSRF protection
const msCalOAuthStates = new Map<string, { userId: number; createdAt: number }>();
const MS_CAL_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Periodic cleanup of expired states
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of msCalOAuthStates) {
    if (now - val.createdAt > MS_CAL_STATE_TTL_MS) msCalOAuthStates.delete(key);
  }
}, 60 * 1000).unref();

// GET /api/calendar/microsoft/auth - Start Microsoft OAuth flow
router.get("/microsoft/auth", authenticateToken, heavyLimiter, (req: Request, res: Response) => {
  if (!config.microsoft.clientId || !config.microsoft.clientSecret) {
    res.status(503).json({ error: "Microsoft Calendar not configured — add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET" });
    return;
  }

  const scopes = [
    "Calendars.ReadWrite",
    "offline_access",
  ];

  const state = crypto.randomBytes(32).toString("hex");
  msCalOAuthStates.set(state, { userId: req.user!.userId, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: config.microsoft.clientId,
    redirect_uri: config.microsoft.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    state,
  });

  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  res.json({ authUrl });
});

// GET /api/calendar/microsoft/callback - Microsoft OAuth callback
router.get("/microsoft/callback", async (req: Request, res: Response) => {
  const { code, state } = req.query;

  if (!code || !state || typeof state !== "string") {
    res.redirect("/calendar-settings?error=missing_params");
    return;
  }

  // Validate state token (CSRF protection)
  const stateEntry = msCalOAuthStates.get(state);
  if (!stateEntry || Date.now() - stateEntry.createdAt > MS_CAL_STATE_TTL_MS) {
    msCalOAuthStates.delete(state);
    res.redirect("/calendar-settings?error=invalid_state");
    return;
  }
  const userId = stateEntry.userId;
  msCalOAuthStates.delete(state); // One-time use

  try {
    const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(code),
        client_id: config.microsoft.clientId,
        client_secret: config.microsoft.clientSecret,
        redirect_uri: config.microsoft.redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      res.status(400).json({ error: `Microsoft OAuth error: ${tokens.error_description || tokens.error}` });
      return;
    }

    const pool = getPool();
    if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

    const client = await pool.connect();
    try {
      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null;

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
    } finally {
      client.release();
    }

    res.redirect("/calendar-settings?connected=microsoft");
  } catch (err) {
    console.error("❌ Microsoft OAuth callback failed:", err);
    res.redirect("/calendar-settings?error=microsoft_failed");
  }
});

// POST /api/calendar/apple - Connect Apple iCloud (CalDAV with app-specific password)
router.post("/apple", authenticateToken, heavyLimiter, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;

  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Apple ID (email) and app-specific password are required" });
    return;
  }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO calendar_connections
       (user_id, provider, access_token_encrypted, refresh_token_encrypted, caldav_url)
       VALUES ($1, 'apple', $2, $3, $4)`,
      [
        currentUser.userId,
        encrypt(username),
        encrypt(password),
        "https://caldav.icloud.com",
      ]
    );

    res.status(201).json({ message: "Apple iCloud calendar connected" });
  } catch (err) {
    console.error("❌ POST /api/calendar/apple failed:", err);
    res.status(500).json({ error: "Failed to connect Apple calendar" });
  } finally {
    client.release();
  }
});

// POST /api/calendar/caldav - Connect generic CalDAV
router.post("/caldav", authenticateToken, heavyLimiter, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;

  const { caldavUrl, username, password } = req.body;
  if (!caldavUrl || !username || !password) {
    res.status(400).json({ error: "CalDAV URL, username, and password are required" });
    return;
  }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO calendar_connections
       (user_id, provider, access_token_encrypted, refresh_token_encrypted, caldav_url)
       VALUES ($1, 'caldav', $2, $3, $4)`,
      [
        currentUser.userId,
        encrypt(username),
        encrypt(password),
        caldavUrl,
      ]
    );

    res.status(201).json({ message: "CalDAV calendar connected" });
  } catch (err) {
    console.error("❌ POST /api/calendar/caldav failed:", err);
    res.status(500).json({ error: "Failed to connect CalDAV calendar" });
  } finally {
    client.release();
  }
});

export default router;
