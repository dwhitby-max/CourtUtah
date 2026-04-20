import { Router, Request, Response } from "express";
import crypto from "crypto";
import { authenticateToken } from "../middleware/auth";
import { getPool } from "../db/pool";
import { config } from "../config/env";
import { encrypt } from "../services/encryptionService";
import { heavyLimiter } from "../middleware/rateLimiter";
import { syncCalendarEntry, deleteCalendarEntry, deleteAllEntriesForConnection } from "../services/calendarSync";
import calendarProvidersRouter from "./calendarProviders";

const router = Router();

// In-memory state store for calendar OAuth CSRF protection
const calendarOAuthStates = new Map<string, { userId: number; createdAt: number }>();
const CAL_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Periodic cleanup of expired states
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of calendarOAuthStates) {
    if (now - val.createdAt > CAL_STATE_TTL_MS) calendarOAuthStates.delete(key);
  }
}, 60 * 1000).unref();

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

  const state = crypto.randomBytes(32).toString("hex");
  calendarOAuthStates.set(state, { userId: req.user.userId, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
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

  if (!code || !state || typeof state !== "string") {
    res.redirect("/calendar-settings?error=missing_params");
    return;
  }

  // Validate state token (CSRF protection)
  const stateEntry = calendarOAuthStates.get(state);
  if (!stateEntry || Date.now() - stateEntry.createdAt > CAL_STATE_TTL_MS) {
    calendarOAuthStates.delete(state);
    res.redirect("/calendar-settings?error=invalid_state");
    return;
  }
  const userId = stateEntry.userId;
  calendarOAuthStates.delete(state); // One-time use

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
              token_expires_at, created_at, updated_at,
              (refresh_token_encrypted IS NOT NULL) AS has_refresh_token
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

  const { courtEventId, savedSearchId } = req.body;
  if (!courtEventId || typeof courtEventId !== "number" || courtEventId <= 0) {
    res.status(400).json({ error: "A valid courtEventId is required" });
    return;
  }
  if (savedSearchId !== undefined && savedSearchId !== null) {
    if (typeof savedSearchId !== "number" || savedSearchId <= 0) {
      res.status(400).json({ error: "If provided, savedSearchId must be a positive number" });
      return;
    }
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

    // If a savedSearchId was passed, verify it belongs to the caller — prevents
    // a user from linking their calendar entry to someone else's saved search.
    // We silently drop an invalid/foreign id rather than 403, because the add
    // itself is still valid; only the association context is missing.
    let resolvedSavedSearchId: number | null = null;
    if (typeof savedSearchId === "number") {
      const ownership = await client.query(
        `SELECT id FROM saved_searches WHERE id = $1 AND user_id = $2`,
        [savedSearchId, currentUser.userId]
      );
      if (ownership.rows.length > 0) {
        resolvedSavedSearchId = savedSearchId;
      } else {
        console.warn(`⚠️ savedSearchId ${savedSearchId} not owned by user ${currentUser.userId} — storing calendar entry without search linkage`);
      }
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

    // Free tier limit: max 5 calendar entries
    const userPlan = await client.query(
      "SELECT subscription_plan FROM users WHERE id = $1",
      [currentUser.userId]
    );
    const plan = userPlan.rows[0]?.subscription_plan || "free";
    if (plan === "free") {
      const entryCount = await client.query(
        "SELECT COUNT(*) as cnt FROM calendar_entries WHERE user_id = $1 AND sync_status != 'removed'",
        [currentUser.userId]
      );
      if (parseInt(entryCount.rows[0].cnt, 10) >= 5) {
        res.status(403).json({
          error: "Free plan limited to 5 calendar syncs. Upgrade to Pro for unlimited access.",
          upgradeRequired: true,
        });
        return;
      }
    }

    // Check if this event is already synced for this user
    const existingEntry = await client.query(
      `SELECT id, sync_status FROM calendar_entries
       WHERE user_id = $1 AND court_event_id = $2 AND calendar_connection_id = $3`,
      [currentUser.userId, courtEventId, connectionId]
    );

    let entryId: number;
    let isUpdate = false;

    if (existingEntry.rows.length > 0) {
      // Re-sync existing entry. If the caller provided a savedSearchId and the
      // existing row has none, backfill it — the entry was originally added
      // outside a saved-search context (or before this field was populated).
      entryId = existingEntry.rows[0].id;
      isUpdate = true;
      await client.query(
        `UPDATE calendar_entries
         SET sync_status = 'pending',
             last_synced_content_hash = NULL,
             saved_search_id = COALESCE(saved_search_id, $2),
             updated_at = NOW()
         WHERE id = $1`,
        [entryId, resolvedSavedSearchId]
      );
    } else {
      // Create new calendar entry, linking to the saved search when known so
      // that stale-event cleanup (searchHelpers.persistLiveResults) and
      // schedule-change fan-out (changeDetector.processChanges) can scope
      // notifications and cleanup to the saved search that surfaced the event.
      const insertResult = await client.query(
        `INSERT INTO calendar_entries
         (user_id, court_event_id, calendar_connection_id, saved_search_id, sync_status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING id`,
        [currentUser.userId, courtEventId, connectionId, resolvedSavedSearchId]
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

  const { courtEventIds, savedSearchId } = req.body;
  if (!Array.isArray(courtEventIds) || courtEventIds.length === 0) {
    res.status(400).json({ error: "courtEventIds must be a non-empty array" });
    return;
  }

  if (courtEventIds.length > 200) {
    res.status(400).json({ error: "Cannot add more than 200 events at once" });
    return;
  }

  if (savedSearchId !== undefined && savedSearchId !== null) {
    if (typeof savedSearchId !== "number" || savedSearchId <= 0) {
      res.status(400).json({ error: "If provided, savedSearchId must be a positive number" });
      return;
    }
  }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    // Validate savedSearchId ownership once upfront (same as /events) — reuse
    // the resolved value for every insert in this batch.
    let resolvedSavedSearchId: number | null = null;
    if (typeof savedSearchId === "number") {
      const ownership = await client.query(
        `SELECT id FROM saved_searches WHERE id = $1 AND user_id = $2`,
        [savedSearchId, currentUser.userId]
      );
      if (ownership.rows.length > 0) {
        resolvedSavedSearchId = savedSearchId;
      } else {
        console.warn(`⚠️ Batch add: savedSearchId ${savedSearchId} not owned by user ${currentUser.userId} — storing without search linkage`);
      }
    }

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
    // Free tier limit: max 5 calendar entries
    const userPlan = await client.query(
      "SELECT subscription_plan FROM users WHERE id = $1",
      [currentUser.userId]
    );
    const plan = userPlan.rows[0]?.subscription_plan || "free";
    let remainingSlots = Infinity;
    if (plan === "free") {
      const entryCount = await client.query(
        "SELECT COUNT(*) as cnt FROM calendar_entries WHERE user_id = $1 AND sync_status != 'removed'",
        [currentUser.userId]
      );
      const currentCount = parseInt(entryCount.rows[0].cnt, 10);
      remainingSlots = Math.max(0, 5 - currentCount);
      if (remainingSlots === 0) {
        res.status(403).json({
          error: "Free plan limited to 5 calendar syncs. Upgrade to Pro for unlimited access.",
          upgradeRequired: true,
        });
        return;
      }
    }

    const results: Array<{ courtEventId: number; calendarEntryId: number; synced: boolean; error?: string }> = [];
    let entriesUsed = 0;

    for (const courtEventId of courtEventIds) {
      // Skip invalid IDs (negative IDs are live results not yet persisted)
      if (typeof courtEventId !== "number" || courtEventId <= 0) {
        results.push({ courtEventId, calendarEntryId: 0, synced: false, error: "Invalid event ID" });
        continue;
      }
      // Stop if free user hit limit (count inserts, not just successful syncs)
      if (plan === "free" && entriesUsed >= remainingSlots) {
        results.push({ courtEventId, calendarEntryId: 0, synced: false, error: "Free plan limit reached" });
        continue;
      }
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
          `SELECT id, sync_status FROM calendar_entries
           WHERE user_id = $1 AND court_event_id = $2 AND calendar_connection_id = $3`,
          [currentUser.userId, courtEventId, connectionId]
        );

        let entryId: number;
        let isNewEntry = false;
        if (existingEntry.rows.length > 0) {
          entryId = existingEntry.rows[0].id;
          await client.query(
            `UPDATE calendar_entries
             SET sync_status = 'pending',
                 last_synced_content_hash = NULL,
                 saved_search_id = COALESCE(saved_search_id, $2),
                 updated_at = NOW()
             WHERE id = $1`,
            [entryId, resolvedSavedSearchId]
          );
          // Re-activating a removed entry counts against the limit
          if (existingEntry.rows[0].sync_status === "removed") isNewEntry = true;
        } else {
          const insertResult = await client.query(
            `INSERT INTO calendar_entries
             (user_id, court_event_id, calendar_connection_id, saved_search_id, sync_status)
             VALUES ($1, $2, $3, $4, 'pending')
             RETURNING id`,
            [currentUser.userId, courtEventId, connectionId, resolvedSavedSearchId]
          );
          entryId = insertResult.rows[0].id;
          isNewEntry = true;
        }

        if (isNewEntry) entriesUsed++;

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

// Mount Microsoft OAuth, Apple iCloud, and CalDAV provider routes
router.use("/", calendarProvidersRouter);

// DELETE /api/calendar/connections/:id - Remove a single connection and its synced events
router.delete("/connections/:id", authenticateToken, heavyLimiter, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const connectionId = parseInt(req.params.id, 10);
  if (isNaN(connectionId)) { res.status(400).json({ error: "Invalid connection ID" }); return; }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    // Verify the connection belongs to the user
    const check = await client.query(
      `SELECT id FROM calendar_connections WHERE id = $1 AND user_id = $2`,
      [connectionId, currentUser.userId]
    );
    if (check.rows.length === 0) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }

    // Delete all calendar entries from providers first
    const { deleted, errors } = await deleteAllEntriesForConnection(connectionId, currentUser.userId);

    // Delete the connection itself (cascade will clean up any remaining entry rows)
    await client.query(
      `DELETE FROM calendar_connections WHERE id = $1 AND user_id = $2`,
      [connectionId, currentUser.userId]
    );

    res.json({
      message: "Calendar connection removed",
      eventsRemoved: deleted,
      eventErrors: errors,
    });
  } catch (err) {
    console.error("❌ DELETE /api/calendar/connections/:id failed:", err);
    res.status(500).json({ error: "Failed to remove calendar connection" });
  } finally {
    client.release();
  }
});

// DELETE /api/calendar/connections - Remove ALL connections and their synced events
router.delete("/connections", authenticateToken, heavyLimiter, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    // Get all connections for user
    const connResult = await client.query(
      `SELECT id FROM calendar_connections WHERE user_id = $1`,
      [currentUser.userId]
    );

    if (connResult.rows.length === 0) {
      res.status(404).json({ error: "No calendar connections found" });
      return;
    }

    let totalDeleted = 0;
    let totalErrors = 0;

    // Delete all calendar entries from providers for each connection
    for (const row of connResult.rows) {
      const { deleted, errors } = await deleteAllEntriesForConnection(row.id, currentUser.userId);
      totalDeleted += deleted;
      totalErrors += errors;
    }

    // Delete all connections
    const deleteResult = await client.query(
      `DELETE FROM calendar_connections WHERE user_id = $1`,
      [currentUser.userId]
    );

    res.json({
      message: `Removed ${deleteResult.rowCount} calendar connection(s)`,
      connectionsRemoved: deleteResult.rowCount,
      eventsRemoved: totalDeleted,
      eventErrors: totalErrors,
    });
  } catch (err) {
    console.error("❌ DELETE /api/calendar/connections failed:", err);
    res.status(500).json({ error: "Failed to remove calendar connections" });
  } finally {
    client.release();
  }
});

export default router;
