import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { getPool } from "../db/pool";
import { runWatchedCaseSearch } from "../services/schedulerService";
import { syncCalendarEntry } from "../services/calendarSync";

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
       WHERE wc.user_id = $1
       ORDER BY wc.created_at DESC`,
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

  const { searchType, searchValue, label } = req.body;

  if (!searchType || !searchValue || !label) {
    res.status(400).json({ error: "searchType, searchValue, and label are required" });
    return;
  }

  const validTypes = ["defendant_name", "case_number", "court_name", "court_date", "defendant_otn", "citation_number", "judge_name", "attorney"];
  if (!validTypes.includes(searchType)) {
    res.status(400).json({ error: `searchType must be one of: ${validTypes.join(", ")}` });
    return;
  }

  const client = await pool.connect();
  let watchedCase: Record<string, unknown>;
  try {
    const result = await client.query(
      `INSERT INTO watched_cases (user_id, search_type, search_value, label)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [currentUser.userId, searchType, searchValue, label]
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

// DELETE /api/watched-cases/:id
router.delete("/:id", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `DELETE FROM watched_cases WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, currentUser.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Watched case not found" });
      return;
    }

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

// GET /api/watched-cases/pending-updates — get calendar entries awaiting user confirmation
router.get("/pending-updates", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
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
       LEFT JOIN change_log cl ON cl.court_event_id = ce.court_event_id
         AND cl.detected_at = (SELECT MAX(detected_at) FROM change_log WHERE court_event_id = ce.court_event_id)
       WHERE ce.user_id = $1 AND ce.sync_status = 'pending_update'
       ORDER BY cl.detected_at DESC`,
      [req.user.userId]
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

export default router;
