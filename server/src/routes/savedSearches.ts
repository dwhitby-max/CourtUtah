import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { getPool } from "../db/pool";
import { deleteCalendarEntry } from "../services/calendarSync";

const router = Router();

router.use(authenticateToken);

// GET /api/saved-searches — list user's saved searches
router.get("/", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, search_type, search_value, label, search_params,
              results_count, last_refreshed_at, is_active, created_at
       FROM saved_searches
       WHERE user_id = $1 AND is_active = true AND source = 'auto_search'
       ORDER BY last_refreshed_at DESC NULLS LAST, created_at DESC`,
      [req.user.userId]
    );
    res.json({ savedSearches: result.rows });
  } catch (err) {
    console.error("❌ GET /api/saved-searches failed:", err);
    res.status(500).json({ error: "Failed to fetch saved searches" });
  } finally {
    client.release();
  }
});

// DELETE /api/saved-searches/:id — delete a saved search
router.delete("/:id", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const searchId = parseInt(req.params.id, 10);
  if (isNaN(searchId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const userId = req.user.userId;
  const client = await pool.connect();
  try {
    // Verify the saved search belongs to this user
    const ssResult = await client.query(
      `SELECT id FROM saved_searches WHERE id = $1 AND user_id = $2`,
      [searchId, userId]
    );
    if (ssResult.rows.length === 0) {
      res.status(404).json({ error: "Saved search not found" });
      return;
    }

    // 1. Delete calendar entries from provider (Google/Microsoft/CalDAV)
    //    before the DB cascade removes the rows
    const calEntries = await client.query<{ id: number }>(
      `SELECT id FROM calendar_entries
       WHERE saved_search_id = $1 AND user_id = $2
         AND sync_status NOT IN ('removed', 'completed')`,
      [searchId, userId]
    );
    for (const ce of calEntries.rows) {
      try {
        await deleteCalendarEntry(ce.id, userId);
      } catch (err) {
        console.warn(`⚠️ Failed to delete calendar entry ${ce.id} during search cleanup:`, err instanceof Error ? err.message : err);
      }
    }

    // 2. Delete notifications linked to court events from this saved search.
    //    Notifications reference court_event_id in metadata; find all court events
    //    that belong to this saved search's calendar entries and remove their notifications.
    const courtEventIds = await client.query<{ court_event_id: number }>(
      `SELECT DISTINCT court_event_id FROM calendar_entries
       WHERE saved_search_id = $1 AND user_id = $2`,
      [searchId, userId]
    );
    if (courtEventIds.rows.length > 0) {
      const eventIds = courtEventIds.rows.map(r => r.court_event_id);
      // Delete notifications that reference these court events in metadata
      await client.query(
        `DELETE FROM notifications
         WHERE user_id = $1
           AND type IN ('schedule_change', 'new_match', 'event_cancelled')
           AND (
             metadata->>'courtEventId' = ANY($2::text[])
             OR metadata->>'court_event_id' = ANY($2::text[])
           )`,
        [userId, eventIds.map(String)]
      );
    }

    // 3. Also delete any remaining notifications that match the search label/value
    //    (some notifications may not have courtEventId in metadata)
    const ssInfo = await client.query<{ label: string; search_value: string }>(
      `SELECT label, search_value FROM saved_searches WHERE id = $1`,
      [searchId]
    );
    if (ssInfo.rows.length > 0) {
      const { label, search_value } = ssInfo.rows[0];
      // Clean up notifications whose title contains the search identifier
      if (search_value) {
        await client.query(
          `DELETE FROM notifications
           WHERE user_id = $1
             AND type IN ('schedule_change', 'new_match', 'event_cancelled')
             AND (title ILIKE '%' || $2 || '%' OR message ILIKE '%' || $2 || '%')`,
          [userId, search_value]
        );
      }
    }

    // 4. Delete remaining calendar_entries rows (including 'removed' ones)
    await client.query(
      `DELETE FROM calendar_entries WHERE saved_search_id = $1 AND user_id = $2`,
      [searchId, userId]
    );

    // 5. Delete the saved search itself
    await client.query(
      `DELETE FROM saved_searches WHERE id = $1 AND user_id = $2`,
      [searchId, userId]
    );

    res.json({ message: "Saved search and all related data deleted" });
  } catch (err) {
    console.error("❌ DELETE /api/saved-searches/:id failed:", err);
    res.status(500).json({ error: "Failed to delete saved search" });
  } finally {
    client.release();
  }
});

export default router;
