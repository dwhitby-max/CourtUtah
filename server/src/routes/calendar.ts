import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { getPool } from "../db/pool";
import { config } from "../config/env";
import { encrypt } from "../services/encryptionService";
import { heavyLimiter } from "../middleware/rateLimiter";
import { syncCalendarEntry, deleteCalendarEntry } from "../services/calendarSync";

const router = Router();

// Resolve the Google Calendar redirect URI:
// Use GOOGLE_CALENDAR_REDIRECT_URI if set, otherwise fall back to GOOGLE_REDIRECT_URI
function getGoogleCalendarRedirectUri(): string {
  return config.google.calendarRedirectUri || config.google.redirectUri;
}

// GET /api/calendar/google/auth - Start Google OAuth flow for calendar connection
router.get("/google/auth", authenticateToken, heavyLimiter, (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }

  if (!config.google.clientId || !config.google.clientSecret) {
    res.status(503).json({ error: "Google Calendar not configured — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET" });
    return;
  }

  const redirectUri = getGoogleCalendarRedirectUri();
  if (!redirectUri) {
    res.status(503).json({ error: "Google redirect URI not configured — add GOOGLE_CALENDAR_REDIRECT_URI or GOOGLE_REDIRECT_URI" });
    return;
  }

  const scopes = [
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
    state: String(req.user.userId),
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({ authUrl });
});

// GET /api/calendar/google/callback - Google OAuth callback for calendar connection
router.get("/google/callback", async (req: Request, res: Response) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    res.redirect("/calendar-settings?error=google_denied");
    return;
  }

  const userId = state ? parseInt(String(state), 10) : null;
  if (!code || !userId || isNaN(userId)) {
    res.redirect("/calendar-settings?error=missing_params");
    return;
  }

  const redirectUri = getGoogleCalendarRedirectUri();

  try {
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
      res.redirect(`/calendar-settings?error=${encodeURIComponent(tokens.error_description || tokens.error)}`);
      return;
    }

    const pool = getPool();
    if (!pool) { res.redirect("/calendar-settings?error=db_unavailable"); return; }

    const client = await pool.connect();
    try {
      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null;

      // Upsert: update existing Google connection or create new
      const existing = await client.query(
        "SELECT id FROM calendar_connections WHERE user_id = $1 AND provider = 'google'",
        [userId]
      );

      if (existing.rows.length > 0) {
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
    } finally {
      client.release();
    }

    res.redirect("/dashboard?connected=google");
  } catch (err) {
    console.error("❌ Google Calendar OAuth callback failed:", err);
    res.redirect("/calendar-settings?error=google_failed");
  }
});

// GET /api/calendar/connections
router.get("/connections", authenticateToken, heavyLimiter, async (req: Request, res: Response) => {
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
  } catch (err) {
    console.error("❌ GET /api/calendar/connections failed:", err);
    res.status(500).json({ error: "Failed to fetch calendar connections" });
  } finally {
    client.release();
  }
});

// POST /api/calendar/events - Add a court event to the user's connected calendar
router.post("/events", authenticateToken, heavyLimiter, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;

  const { courtEventId } = req.body;
  if (!courtEventId) {
    res.status(400).json({ error: "courtEventId is required" });
    return;
  }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    // Verify the court event exists
    const eventResult = await client.query(
      "SELECT id FROM court_events WHERE id = $1",
      [courtEventId]
    );
    if (eventResult.rows.length === 0) {
      res.status(404).json({ error: "Court event not found" });
      return;
    }

    let connResult = await client.query(
      `SELECT id FROM calendar_connections
       WHERE user_id = $1 AND is_active = true
       ORDER BY created_at ASC LIMIT 1`,
      [currentUser.userId]
    );

    if (connResult.rows.length === 0) {
      const inactiveConn = await client.query(
        `SELECT id, refresh_token_encrypted FROM calendar_connections
         WHERE user_id = $1
         ORDER BY updated_at DESC LIMIT 1`,
        [currentUser.userId]
      );

      if (inactiveConn.rows.length > 0 && inactiveConn.rows[0].refresh_token_encrypted) {
        await client.query(
          `UPDATE calendar_connections SET is_active = true, updated_at = NOW() WHERE id = $1`,
          [inactiveConn.rows[0].id]
        );
        connResult = { rows: [{ id: inactiveConn.rows[0].id }] } as typeof connResult;
      } else {
        console.warn(`⚠️  No calendar connection found for user ${currentUser.userId}`);
        res.status(400).json({ error: "No calendar connected. Please log out and log back in with Google to connect your calendar." });
        return;
      }
    }

    const connectionId = connResult.rows[0].id;

    // Check if this event is already synced for this user
    const existingEntry = await client.query(
      `SELECT id, sync_status FROM calendar_entries
       WHERE user_id = $1 AND court_event_id = $2 AND calendar_connection_id = $3`,
      [currentUser.userId, courtEventId, connectionId]
    );

    let entryId: number;
    let isUpdate = false;

    if (existingEntry.rows.length > 0) {
      // Re-sync existing entry
      entryId = existingEntry.rows[0].id;
      isUpdate = true;
      await client.query(
        `UPDATE calendar_entries SET sync_status = 'pending', last_synced_content_hash = NULL, updated_at = NOW() WHERE id = $1`,
        [entryId]
      );
    } else {
      // Create new calendar entry
      const insertResult = await client.query(
        `INSERT INTO calendar_entries
         (user_id, court_event_id, calendar_connection_id, sync_status)
         VALUES ($1, $2, $3, 'pending')
         RETURNING id`,
        [currentUser.userId, courtEventId, connectionId]
      );
      entryId = insertResult.rows[0].id;
    }

    // Sync to the calendar provider
    const success = await syncCalendarEntry(entryId);

    if (success) {
      res.json({
        message: isUpdate ? "Calendar event updated" : "Event added to calendar",
        calendarEntryId: entryId,
        synced: true,
      });
    } else {
      res.status(500).json({
        error: "Event saved but calendar sync failed. It will retry automatically.",
        calendarEntryId: entryId,
        synced: false,
      });
    }
  } catch (err) {
    console.error("❌ POST /api/calendar/events failed:", err);
    res.status(500).json({ error: "Failed to add event to calendar" });
  } finally {
    client.release();
  }
});

// POST /api/calendar/events/batch - Add multiple court events to calendar at once
router.post("/events/batch", authenticateToken, heavyLimiter, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;

  const { courtEventIds } = req.body;
  if (!Array.isArray(courtEventIds) || courtEventIds.length === 0) {
    res.status(400).json({ error: "courtEventIds must be a non-empty array" });
    return;
  }

  if (courtEventIds.length > 200) {
    res.status(400).json({ error: "Cannot add more than 200 events at once" });
    return;
  }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    // Verify user has an active calendar connection
    const connResult = await client.query(
      `SELECT id FROM calendar_connections
       WHERE user_id = $1 AND is_active = true
       ORDER BY created_at ASC LIMIT 1`,
      [currentUser.userId]
    );

    let connectionId: number;

    if (connResult.rows.length > 0) {
      connectionId = connResult.rows[0].id;
    } else {
      const inactiveConn = await client.query(
        `SELECT id, refresh_token_encrypted FROM calendar_connections
         WHERE user_id = $1
         ORDER BY updated_at DESC LIMIT 1`,
        [currentUser.userId]
      );

      if (inactiveConn.rows.length > 0 && inactiveConn.rows[0].refresh_token_encrypted) {
        await client.query(
          `UPDATE calendar_connections SET is_active = true, updated_at = NOW() WHERE id = $1`,
          [inactiveConn.rows[0].id]
        );
        connectionId = inactiveConn.rows[0].id;
      } else {
        res.status(400).json({ error: "No calendar connected. Please log out and log back in with Google to connect your calendar." });
        return;
      }
    }
    const results: Array<{ courtEventId: number; calendarEntryId: number; synced: boolean; error?: string }> = [];

    for (const courtEventId of courtEventIds) {
      try {
        // Check if event exists
        const eventResult = await client.query(
          "SELECT id FROM court_events WHERE id = $1",
          [courtEventId]
        );
        if (eventResult.rows.length === 0) {
          results.push({ courtEventId, calendarEntryId: 0, synced: false, error: "Event not found" });
          continue;
        }

        // Check for existing entry
        const existingEntry = await client.query(
          `SELECT id FROM calendar_entries
           WHERE user_id = $1 AND court_event_id = $2 AND calendar_connection_id = $3`,
          [currentUser.userId, courtEventId, connectionId]
        );

        let entryId: number;
        if (existingEntry.rows.length > 0) {
          entryId = existingEntry.rows[0].id;
          await client.query(
            `UPDATE calendar_entries SET sync_status = 'pending', last_synced_content_hash = NULL, updated_at = NOW() WHERE id = $1`,
            [entryId]
          );
        } else {
          const insertResult = await client.query(
            `INSERT INTO calendar_entries
             (user_id, court_event_id, calendar_connection_id, sync_status)
             VALUES ($1, $2, $3, 'pending')
             RETURNING id`,
            [currentUser.userId, courtEventId, connectionId]
          );
          entryId = insertResult.rows[0].id;
        }

        const success = await syncCalendarEntry(entryId);
        results.push({ courtEventId, calendarEntryId: entryId, synced: success });
      } catch (err) {
        results.push({ courtEventId, calendarEntryId: 0, synced: false, error: err instanceof Error ? err.message : "Sync failed" });
      }
    }

    const syncedCount = results.filter(r => r.synced).length;
    res.json({
      message: `Added ${syncedCount} of ${courtEventIds.length} events to calendar`,
      results,
    });
  } catch (err) {
    console.error("❌ POST /api/calendar/events/batch failed:", err);
    res.status(500).json({ error: "Failed to add events to calendar" });
  } finally {
    client.release();
  }
});

// GET /api/calendar/events/synced - Get court_event_ids the user has synced
router.get("/events/synced", authenticateToken, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT ce.id AS calendar_entry_id, ce.court_event_id, ce.sync_status
       FROM calendar_entries ce
       WHERE ce.user_id = $1 AND ce.sync_status = 'synced'`,
      [currentUser.userId]
    );
    // Map: courtEventId -> calendarEntryId
    const synced: Record<number, number> = {};
    for (const row of result.rows) {
      synced[row.court_event_id] = row.calendar_entry_id;
    }
    res.json({ synced });
  } catch (err) {
    console.error("❌ GET /api/calendar/events/synced failed:", err);
    res.status(500).json({ error: "Failed to fetch synced events" });
  } finally {
    client.release();
  }
});

// DELETE /api/calendar/events/:id - Remove a calendar entry from provider and DB
router.delete("/events/:id", authenticateToken, heavyLimiter, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const entryId = parseInt(req.params.id, 10);
  if (isNaN(entryId)) { res.status(400).json({ error: "Invalid entry ID" }); return; }

  try {
    const success = await deleteCalendarEntry(entryId, currentUser.userId);
    if (success) {
      res.json({ message: "Calendar event removed" });
    } else {
      res.status(404).json({ error: "Calendar entry not found" });
    }
  } catch (err) {
    console.error("❌ DELETE /api/calendar/events/:id failed:", err);
    res.status(500).json({ error: "Failed to remove calendar event" });
  }
});

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

// DELETE /api/calendar/connections/:id
router.delete("/connections/:id", authenticateToken, heavyLimiter, async (req: Request, res: Response) => {
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
  } catch (err) {
    console.error("❌ DELETE /api/calendar/connections/:id failed:", err);
    res.status(500).json({ error: "Failed to remove calendar connection" });
  } finally {
    client.release();
  }
});

export default router;
