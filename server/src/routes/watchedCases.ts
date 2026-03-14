import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { getPool } from "../db/pool";

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
  try {
    const result = await client.query(
      `INSERT INTO watched_cases (user_id, search_type, search_value, label)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [currentUser.userId, searchType, searchValue, label]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("❌ POST /api/watched-cases failed:", err);
    res.status(500).json({ error: "Failed to create watched case" });
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

// POST /api/watched-cases/:id/sync
router.post("/:id/sync", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const currentUser = req.user;
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const wcResult = await client.query(
      `SELECT * FROM watched_cases WHERE id = $1 AND user_id = $2`,
      [req.params.id, currentUser.userId]
    );

    if (wcResult.rows.length === 0) {
      res.status(404).json({ error: "Watched case not found" });
      return;
    }

    const wc = wcResult.rows[0];

    const calResult = await client.query(
      `SELECT id FROM calendar_connections WHERE user_id = $1 AND is_active = true LIMIT 1`,
      [currentUser.userId]
    );

    if (calResult.rows.length === 0) {
      res.status(400).json({ error: "No active calendar connection. Please connect a calendar first." });
      return;
    }

    const calConnectionId = calResult.rows[0].id;

    const columnMap: Record<string, string> = {
      defendant_name: "defendant_name",
      case_number: "case_number",
      court_name: "court_name",
      court_date: "event_date",
      defendant_otn: "defendant_otn",
      citation_number: "citation_number",
      judge_name: "judge_name",
      attorney: "prosecuting_attorney",
    };

    const column = columnMap[wc.search_type];
    const useExact = wc.search_type === "court_date";
    let whereClause: string;
    let searchVal: string;

    if (wc.search_type === "attorney") {
      whereClause = `(UPPER(prosecuting_attorney) LIKE $1 OR UPPER(defense_attorney) LIKE $1)`;
      searchVal = `%${wc.search_value.toUpperCase()}%`;
    } else if (useExact) {
      whereClause = `${column} = $1`;
      searchVal = wc.search_value;
    } else {
      whereClause = `UPPER(${column}) LIKE $1`;
      searchVal = `%${wc.search_value.toUpperCase()}%`;
    }

    const eventsResult = await client.query(
      `SELECT id FROM court_events WHERE ${whereClause}`,
      [searchVal]
    );

    let created = 0;
    for (const event of eventsResult.rows) {
      const existingEntry = await client.query(
        `SELECT id FROM calendar_entries
         WHERE watched_case_id = $1 AND court_event_id = $2 AND calendar_connection_id = $3`,
        [wc.id, event.id, calConnectionId]
      );

      if (existingEntry.rows.length === 0) {
        await client.query(
          `INSERT INTO calendar_entries (user_id, watched_case_id, court_event_id, calendar_connection_id)
           VALUES ($1, $2, $3, $4)`,
          [currentUser.userId, wc.id, event.id, calConnectionId]
        );
        created++;
      }
    }

    res.json({
      message: `Created ${created} calendar entries for ${eventsResult.rows.length} matching events`,
      entriesCreated: created,
      eventsMatched: eventsResult.rows.length,
    });
  } catch (err) {
    console.error("❌ POST /api/watched-cases/:id/sync failed:", err);
    res.status(500).json({ error: "Failed to sync watched case" });
  } finally {
    client.release();
  }
});

export default router;
