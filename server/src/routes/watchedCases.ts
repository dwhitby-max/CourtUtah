import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { getPool } from "../db/pool";
import { runWatchedCaseSearch, createCalendarEntriesForWatchedCase, WatchedCaseRow } from "../services/schedulerService";
import { syncCalendarEntry, deleteCalendarEntry } from "../services/calendarSync";

const router = Router();

router.use(authenticateToken);

// GET /api/watched-cases
router.get("/", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT wc.*,
        (SELECT COUNT(*) FROM calendar_entries ce WHERE ce.watched_case_id = wc.id) as matching_events_count
       FROM watched_cases wc
       WHERE wc.user_id = $1 AND wc.is_active = true
       ORDER BY wc.last_refreshed_at DESC NULLS LAST, wc.created_at DESC`,
      [currentUser.userId]
    );

    res.json({ watchedCases: result.rows });
  } catch (err) {
    console.error("❌ GET /api/watched-cases failed:", err);
    res.status(500).json({ error: "Failed to fetch watched cases" });
  } finally {
    client.release();
  }
});

// POST /api/watched-cases
router.post("/", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const { searchType, searchValue, label, monitorChanges, autoAddNew, searchParams } = req.body;

  if (!searchType || !searchValue || !label) {
    res.status(400).json({ error: "searchType, searchValue, and label are required" });
    return;
  }

  const validTypes = ["defendant_name", "case_number", "court_name", "court_date", "defendant_otn", "citation_number", "judge_name", "attorney", "search_watch"];
  if (!validTypes.includes(searchType)) {
    res.status(400).json({ error: `searchType must be one of: ${validTypes.join(", ")}` });
    return;
  }

  const client = await pool.connect();
  let watchedCase: Record<string, unknown>;
  try {
    // Enforce plan limits on search_watch entries
    if (searchType === "search_watch") {
      const userPlan = await client.query<{ subscription_plan: string }>(
        "SELECT subscription_plan FROM users WHERE id = $1",
        [currentUser.userId]
      );
      const plan = userPlan.rows[0]?.subscription_plan || "free";

      // Free plan: no watched searches at all
      if (plan === "free") {
        res.status(403).json({
          error: "Watched Cases is a Pro feature. Upgrade to Pro to continuously monitor searches and get notified of new hearings.",
          upgradeRequired: true,
        });
        return;
      }

      // Pro plan: max 5
      const watchCount = await client.query<{ cnt: string }>(
        `SELECT COUNT(*) as cnt FROM watched_cases
         WHERE user_id = $1 AND search_type = 'search_watch' AND is_active = true`,
        [currentUser.userId]
      );
      if (parseInt(watchCount.rows[0].cnt, 10) >= 5) {
        res.status(403).json({
          error: "You can have up to 5 watched searches. Remove an existing one first.",
        });
        return;
      }
    }

    // For search_watch type, store the full search params so the scheduler
    // can re-run the exact same search (without date constraints, up to 4 weeks)
    const result = await client.query(
      `INSERT INTO watched_cases (user_id, search_type, search_value, label, monitor_changes, auto_add_new, search_params)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [currentUser.userId, searchType, searchValue, label, !!monitorChanges, !!autoAddNew,
       searchParams ? JSON.stringify(searchParams) : null]
    );
    watchedCase = result.rows[0];
  } catch (err) {
    console.error("❌ POST /api/watched-cases failed:", err);
    res.status(500).json({ error: "Failed to create watched case" });
    return;
  } finally {
    client.release();
  }

  // Run the search immediately against utcourts.gov (after releasing the client)
  let searchResult = { eventsFound: 0, newEntries: 0, changes: 0 };
  try {
    searchResult = await runWatchedCaseSearch(watchedCase.id as number);
  } catch (err) {
    console.error("⚠️ Immediate search failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  res.status(201).json({
    ...watchedCase,
    initialSearch: searchResult,
  });
});

// POST /api/watched-cases/auto-sync — enable/disable auto-sync for events already on the user's calendar
router.post("/auto-sync", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const { courtEventIds, enable } = req.body;
  if (!Array.isArray(courtEventIds) || courtEventIds.length === 0) {
    res.status(400).json({ error: "courtEventIds array is required" });
    return;
  }

  // Filter out invalid IDs (negative IDs are live results not yet persisted)
  const validIds = courtEventIds.filter((id: unknown) => typeof id === "number" && id > 0);
  if (validIds.length === 0) {
    res.status(400).json({ error: "No valid court event IDs provided. Events must be persisted before enabling auto-sync." });
    return;
  }

  const client = await pool.connect();
  try {
    // Look up court events to get case numbers and defendant names
    const events = await client.query<{ id: number; case_number: string; defendant_name: string; court_name: string }>(
      `SELECT id, case_number, defendant_name, court_name FROM court_events WHERE id = ANY($1)`,
      [validIds]
    );

    if (enable) {
      const watchedCaseIds: number[] = [];
      const seen = new Set<string>();

      for (const event of events.rows) {
        const searchType = event.case_number ? "case_number" : "defendant_name";
        const searchValue = event.case_number || event.defendant_name;
        if (!searchValue) continue;
        const dedup = `${searchType}:${searchValue.toUpperCase()}`;
        if (seen.has(dedup)) continue;
        seen.add(dedup);

        // Check if a watched case already exists for this case
        const existing = await client.query(
          `SELECT id FROM watched_cases
           WHERE user_id = $1 AND search_type = $2 AND UPPER(search_value) = UPPER($3) AND is_active = true
           LIMIT 1`,
          [currentUser.userId, searchType, searchValue]
        );

        if (existing.rows.length > 0) {
          await client.query(
            `UPDATE watched_cases SET monitor_changes = true, auto_add_new = true, updated_at = NOW() WHERE id = $1`,
            [existing.rows[0].id]
          );
          watchedCaseIds.push(existing.rows[0].id);
        } else {
          const label = event.case_number
            ? `${event.case_number} - ${event.defendant_name || "Unknown"} (${event.court_name || ""})`
            : `${event.defendant_name} (${event.court_name || ""})`;

          const result = await client.query(
            `INSERT INTO watched_cases (user_id, search_type, search_value, label, monitor_changes, auto_add_new, source)
             VALUES ($1, $2, $3, $4, true, true, 'auto_sync')
             RETURNING id`,
            [currentUser.userId, searchType, searchValue, label]
          );
          watchedCaseIds.push(result.rows[0].id);
        }
      }

      res.json({
        enabled: true,
        watchedCaseIds,
        casesMonitored: watchedCaseIds.length,
        message: `Auto-sync enabled for ${watchedCaseIds.length} case${watchedCaseIds.length !== 1 ? "s" : ""}. Calendar entries will update automatically when changes are detected.`,
      });
    } else {
      // Disable: find watched cases matching these court events and turn off monitorChanges
      const caseNumbers = [...new Set(events.rows.map(e => e.case_number).filter(Boolean))];
      const defNames = [...new Set(events.rows.filter(e => !e.case_number).map(e => e.defendant_name).filter(Boolean))];

      let updated = 0;
      if (caseNumbers.length > 0) {
        const result = await client.query(
          `UPDATE watched_cases SET monitor_changes = false, auto_add_new = false, updated_at = NOW()
           WHERE user_id = $1 AND search_type = 'case_number'
             AND UPPER(search_value) = ANY($2) AND is_active = true`,
          [currentUser.userId, caseNumbers.map(c => c.toUpperCase())]
        );
        updated += result.rowCount || 0;
      }
      if (defNames.length > 0) {
        const result = await client.query(
          `UPDATE watched_cases SET monitor_changes = false, auto_add_new = false, updated_at = NOW()
           WHERE user_id = $1 AND search_type = 'defendant_name'
             AND UPPER(search_value) = ANY($2) AND is_active = true`,
          [currentUser.userId, defNames.map(n => n.toUpperCase())]
        );
        updated += result.rowCount || 0;
      }

      res.json({
        enabled: false,
        casesUpdated: updated,
        message: `Auto-sync disabled for ${updated} case${updated !== 1 ? "s" : ""}.`,
      });
    }
  } catch (err) {
    console.error("❌ POST /api/watched-cases/auto-sync failed:", err);
    res.status(500).json({ error: "Failed to update auto-sync settings" });
  } finally {
    client.release();
  }
});

// PATCH /api/watched-cases/:id — update watched case settings (autoAddNew, monitorChanges)
router.patch("/:id", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const watchedCaseId = parseInt(req.params.id, 10);
  if (isNaN(watchedCaseId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { autoAddNew, monitorChanges, autoAddToCalendar } = req.body;
  const client = await pool.connect();
  try {
    const existing = await client.query(
      `SELECT id, search_params FROM watched_cases WHERE id = $1 AND user_id = $2 AND is_active = true`,
      [watchedCaseId, currentUser.userId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Watched case not found" });
      return;
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (autoAddNew !== undefined || autoAddToCalendar !== undefined) {
      const val = autoAddNew !== undefined ? autoAddNew : autoAddToCalendar;
      updates.push(`auto_add_new = $${paramIdx++}`);
      values.push(!!val);

      // Also update search_params._autoAddToCalendar for backward compat
      const params = existing.rows[0].search_params || {};
      if (val) {
        params._autoAddToCalendar = "true";
      } else {
        delete params._autoAddToCalendar;
      }
      updates.push(`search_params = $${paramIdx++}`);
      values.push(JSON.stringify(params));
    }

    if (monitorChanges !== undefined) {
      updates.push(`monitor_changes = $${paramIdx++}`);
      values.push(!!monitorChanges);
    }

    if (updates.length === 0) {
      res.json({ message: "Nothing to update" });
      return;
    }

    updates.push(`updated_at = NOW()`);
    values.push(watchedCaseId, currentUser.userId);
    await client.query(
      `UPDATE watched_cases SET ${updates.join(", ")} WHERE id = $${paramIdx++} AND user_id = $${paramIdx}`,
      values
    );

    // If autosync was just turned ON, immediately create calendar entries
    // for existing matching events (don't wait for the next daily cron)
    let entriesCreated = 0;
    const autoSyncEnabled = (autoAddNew === true || autoAddToCalendar === true);
    if (autoSyncEnabled) {
      try {
        const wcResult = await client.query<WatchedCaseRow>(
          `SELECT id, user_id, search_type, search_value, label, monitor_changes,
                  auto_add_new, search_params, COALESCE(source, 'manual') as source
           FROM watched_cases WHERE id = $1`,
          [watchedCaseId]
        );
        if (wcResult.rows.length > 0) {
          entriesCreated = await createCalendarEntriesForWatchedCase(wcResult.rows[0], client);
          if (entriesCreated > 0) {
            console.log(`📅 Auto-sync enabled: created ${entriesCreated} calendar entries for watched case ${watchedCaseId}`);
          }
        }
      } catch (err) {
        console.warn(`⚠️ Failed to auto-create calendar entries:`, err instanceof Error ? err.message : err);
      }
    }

    res.json({ message: "Watched case updated", entriesCreated });
  } catch (err) {
    console.error("❌ PATCH /api/watched-cases/:id failed:", err);
    res.status(500).json({ error: "Failed to update watched case" });
  } finally {
    client.release();
  }
});

// DELETE /api/watched-cases/calendar-entries/all — remove ALL synced calendar entries for the user
// NOTE: Must be registered BEFORE /:id to avoid Express matching "calendar-entries" as an :id param
router.delete("/calendar-entries/all", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const entries = await client.query(
      `SELECT id FROM calendar_entries WHERE user_id = $1`,
      [currentUser.userId]
    );

    let removed = 0;
    let errors = 0;
    for (const row of entries.rows) {
      const success = await deleteCalendarEntry(row.id, currentUser.userId);
      if (success) removed++;
      else errors++;
    }

    res.json({ message: `Removed ${removed} calendar event${removed !== 1 ? "s" : ""}`, removed, errors });
  } catch (err) {
    console.error("❌ DELETE /api/watched-cases/calendar-entries/all failed:", err);
    res.status(500).json({ error: "Failed to remove calendar entries" });
  } finally {
    client.release();
  }
});

// GET /api/watched-cases/:id/calendar-entries — list synced calendar entries for a watched case
router.get("/:id/calendar-entries", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const watchedCaseId = parseInt(req.params.id, 10);
  if (isNaN(watchedCaseId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT ce.id AS calendar_entry_id, ce.sync_status, ce.created_at AS synced_at,
              ev.id AS court_event_id, ev.case_number, ev.defendant_name,
              ev.event_date, ev.event_time, ev.court_name, ev.court_room,
              ev.hearing_type, ev.judge_name, ev.is_virtual
       FROM calendar_entries ce
       JOIN court_events ev ON ev.id = ce.court_event_id
       WHERE ce.watched_case_id = $1 AND ce.user_id = $2
       ORDER BY ev.event_date ASC, ev.event_time ASC`,
      [watchedCaseId, currentUser.userId]
    );

    res.json({ calendarEntries: result.rows });
  } catch (err) {
    console.error("❌ GET /api/watched-cases/:id/calendar-entries failed:", err);
    res.status(500).json({ error: "Failed to fetch calendar entries" });
  } finally {
    client.release();
  }
});

// DELETE /api/watched-cases/:id
router.delete("/:id", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const watchedCaseId = parseInt(req.params.id, 10);
  if (isNaN(watchedCaseId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const client = await pool.connect();
  try {
    // Verify ownership
    const check = await client.query(
      `SELECT id FROM watched_cases WHERE id = $1 AND user_id = $2`,
      [watchedCaseId, currentUser.userId]
    );
    if (check.rows.length === 0) {
      res.status(404).json({ error: "Watched case not found" });
      return;
    }

    // Detach calendar entries but leave them on the user's calendar
    await client.query(
      `UPDATE calendar_entries SET watched_case_id = NULL, updated_at = NOW()
       WHERE watched_case_id = $1 AND user_id = $2`,
      [watchedCaseId, currentUser.userId]
    );

    await client.query(
      `DELETE FROM watched_cases WHERE id = $1 AND user_id = $2`,
      [watchedCaseId, currentUser.userId]
    );

    res.json({ message: "Watched case deleted" });
  } catch (err) {
    console.error("❌ DELETE /api/watched-cases/:id failed:", err);
    res.status(500).json({ error: "Failed to delete watched case" });
  } finally {
    client.release();
  }
});

// POST /api/watched-cases/:id/sync — re-run live search and sync calendar entries
router.post("/:id/sync", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const wcResult = await client.query(
      `SELECT id FROM watched_cases WHERE id = $1 AND user_id = $2`,
      [req.params.id, currentUser.userId]
    );

    if (wcResult.rows.length === 0) {
      res.status(404).json({ error: "Watched case not found" });
      return;
    }
  } finally {
    client.release();
  }

  try {
    const result = await runWatchedCaseSearch(parseInt(req.params.id, 10));
    res.json({
      message: `Found ${result.eventsFound} events, created ${result.newEntries} new calendar entries`,
      eventsFound: result.eventsFound,
      newEntries: result.newEntries,
      changes: result.changes,
    });
  } catch (err) {
    console.error("❌ POST /api/watched-cases/:id/sync failed:", err);
    res.status(500).json({ error: "Failed to sync watched case" });
  }
});

// GET /api/watched-cases/pending-updates — get recent changes for user's watched events
router.get("/pending-updates", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT ce.id, ce.court_event_id, ce.sync_status,
              ev.case_number, ev.defendant_name, ev.event_date, ev.event_time,
              ev.court_name, ev.hearing_type,
              cl.field_changed, cl.old_value, cl.new_value, cl.detected_at
       FROM calendar_entries ce
       JOIN court_events ev ON ev.id = ce.court_event_id
       JOIN change_log cl ON cl.court_event_id = ce.court_event_id
       WHERE ce.user_id = $1 AND cl.detected_at > NOW() - INTERVAL '7 days'
       ORDER BY cl.detected_at DESC`,
      [currentUser.userId]
    );
    res.json({ pendingUpdates: result.rows });
  } catch (err) {
    console.error("❌ GET /api/watched-cases/pending-updates failed:", err);
    res.status(500).json({ error: "Failed to fetch pending updates" });
  } finally {
    client.release();
  }
});

// POST /api/watched-cases/confirm-update/:entryId — confirm and sync a pending calendar update
router.post("/confirm-update/:entryId", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const entryId = parseInt(req.params.entryId, 10);
  if (isNaN(entryId)) { res.status(400).json({ error: "Invalid entry ID" }); return; }

  const client = await pool.connect();
  try {
    const entry = await client.query(
      `SELECT id FROM calendar_entries WHERE id = $1 AND user_id = $2 AND sync_status = 'pending_update'`,
      [entryId, req.user.userId]
    );
    if (entry.rows.length === 0) {
      res.status(404).json({ error: "Pending update not found" });
      return;
    }

    await client.query(
      `UPDATE calendar_entries SET sync_status = 'pending', updated_at = NOW() WHERE id = $1`,
      [entryId]
    );

    const success = await syncCalendarEntry(entryId);
    res.json({ message: success ? "Calendar updated" : "Update queued, will retry", synced: success });
  } catch (err) {
    console.error("❌ POST /api/watched-cases/confirm-update failed:", err);
    res.status(500).json({ error: "Failed to confirm update" });
  } finally {
    client.release();
  }
});

// POST /api/watched-cases/dismiss-update/:entryId — dismiss a pending update (keep old calendar event)
router.post("/dismiss-update/:entryId", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const entryId = parseInt(req.params.entryId, 10);
  if (isNaN(entryId)) { res.status(400).json({ error: "Invalid entry ID" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE calendar_entries SET sync_status = 'synced', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND sync_status = 'pending_update'
       RETURNING id`,
      [entryId, req.user.userId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Pending update not found" });
      return;
    }
    res.json({ message: "Update dismissed" });
  } catch (err) {
    console.error("❌ POST /api/watched-cases/dismiss-update failed:", err);
    res.status(500).json({ error: "Failed to dismiss update" });
  } finally {
    client.release();
  }
});

// DELETE /api/watched-cases/:id/calendar-entries — remove all synced calendar entries for a watched case
router.delete("/:id/calendar-entries", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const watchedCaseId = parseInt(req.params.id, 10);
  if (isNaN(watchedCaseId)) { res.status(400).json({ error: "Invalid watched case ID" }); return; }

  const client = await pool.connect();
  try {
    // Verify ownership
    const wcResult = await client.query(
      `SELECT id FROM watched_cases WHERE id = $1 AND user_id = $2`,
      [watchedCaseId, currentUser.userId]
    );
    if (wcResult.rows.length === 0) {
      res.status(404).json({ error: "Watched case not found" });
      return;
    }

    // Only remove calendar entries directly linked to THIS watched case.
    // Entries linked to other watched cases (or manually added) are left untouched.
    const entries = await client.query(
      `SELECT ce.id FROM calendar_entries ce
       WHERE ce.user_id = $1
         AND ce.watched_case_id = $2
         AND ce.sync_status != 'removed'`,
      [currentUser.userId, watchedCaseId]
    );

    let removed = 0;
    let errors = 0;
    for (const row of entries.rows) {
      const success = await deleteCalendarEntry(row.id, currentUser.userId);
      if (success) removed++;
      else errors++;
    }

    res.json({ message: `Removed ${removed} calendar event${removed !== 1 ? "s" : ""}`, removed, errors });
  } catch (err) {
    console.error("❌ DELETE /api/watched-cases/:id/calendar-entries failed:", err);
    res.status(500).json({ error: "Failed to remove calendar entries" });
  } finally {
    client.release();
  }
});

export default router;
