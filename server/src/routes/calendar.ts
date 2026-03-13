import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { getPool } from "../db/pool";
import { config } from "../config/env";
import { encrypt } from "../services/encryptionService";
import { heavyLimiter } from "../middleware/rateLimiter";

const router = Router();

router.use(authenticateToken);
router.use(heavyLimiter);

// GET /api/calendar/connections
router.get("/connections", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, user_id, provider, calendar_id, caldav_url, is_active,
              token_expires_at, created_at, updated_at
       FROM calendar_connections
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [currentUser.userId]
    );
    res.json({ connections: result.rows });
  } finally {
    client.release();
  }
});

// GET /api/calendar/google/auth - Start Google OAuth flow
router.get("/google/auth", (req: Request, res: Response) => {
  if (!config.google.clientId || !config.google.clientSecret) {
    res.status(503).json({ error: "Google Calendar not configured — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET" });
    return;
  }

  const scopes = [
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
    state: String(req.user?.userId || ""),
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({ authUrl });
});

// GET /api/calendar/google/callback - Google OAuth callback
router.get("/google/callback", async (req: Request, res: Response) => {
  const { code, state } = req.query;
  const userId = state ? parseInt(String(state), 10) : null;

  if (!code || !userId) {
    res.status(400).json({ error: "Missing authorization code or state" });
    return;
  }

  try {
    // Exchange code for tokens
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
      res.status(400).json({ error: `Google OAuth error: ${tokens.error_description || tokens.error}` });
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
         (user_id, provider, access_token_encrypted, refresh_token_encrypted, token_expires_at, calendar_id)
         VALUES ($1, 'google', $2, $3, $4, 'primary')`,
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

    // Redirect back to the app's calendar settings page
    res.redirect("/calendar-settings?connected=google");
  } catch (err) {
    console.error("❌ Google OAuth callback failed:", err);
    res.redirect("/calendar-settings?error=google_failed");
  }
});

// GET /api/calendar/microsoft/auth - Start Microsoft OAuth flow
router.get("/microsoft/auth", (req: Request, res: Response) => {
  if (!config.microsoft.clientId || !config.microsoft.clientSecret) {
    res.status(503).json({ error: "Microsoft Calendar not configured — add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET" });
    return;
  }

  const scopes = [
    "Calendars.ReadWrite",
    "offline_access",
  ];

  const params = new URLSearchParams({
    client_id: config.microsoft.clientId,
    redirect_uri: config.microsoft.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    state: String(req.user?.userId || ""),
  });

  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  res.json({ authUrl });
});

// GET /api/calendar/microsoft/callback - Microsoft OAuth callback
router.get("/microsoft/callback", async (req: Request, res: Response) => {
  const { code, state } = req.query;
  const userId = state ? parseInt(String(state), 10) : null;

  if (!code || !userId) {
    res.status(400).json({ error: "Missing authorization code or state" });
    return;
  }

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
router.post("/apple", async (req: Request, res: Response) => {
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
  } finally {
    client.release();
  }
});

// POST /api/calendar/caldav - Connect generic CalDAV
router.post("/caldav", async (req: Request, res: Response) => {
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
  } finally {
    client.release();
  }
});

// DELETE /api/calendar/connections/:id
router.delete("/connections/:id", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `DELETE FROM calendar_connections WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, currentUser.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }

    res.json({ message: "Calendar connection removed" });
  } finally {
    client.release();
  }
});

export default router;
