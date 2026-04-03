import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { getPool } from "../db/pool";

const router = Router();
router.use(authenticateToken);

// GET /api/export-templates
router.get("/", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const pool = getPool();
  if (!pool) { res.status(500).json({ error: "Database unavailable" }); return; }
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT id, name, field_keys, sort_levels FROM export_templates WHERE user_id = $1 ORDER BY created_at",
      [req.user.userId]
    );
    const templates = result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      fieldKeys: r.field_keys,
      sortLevels: r.sort_levels,
    }));
    res.json({ templates });
  } finally {
    client.release();
  }
});

// POST /api/export-templates
router.post("/", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { name, fieldKeys, sortLevels } = req.body;
  if (!name || !Array.isArray(fieldKeys) || fieldKeys.length === 0) {
    res.status(400).json({ error: "Name and at least one field are required" });
    return;
  }
  const pool = getPool();
  if (!pool) { res.status(500).json({ error: "Database unavailable" }); return; }
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO export_templates (user_id, name, field_keys, sort_levels)
       VALUES ($1, $2, $3, $4) RETURNING id, name, field_keys, sort_levels`,
      [req.user.userId, name, JSON.stringify(fieldKeys), JSON.stringify(sortLevels || [])]
    );
    const r = result.rows[0];
    res.status(201).json({ id: r.id, name: r.name, fieldKeys: r.field_keys, sortLevels: r.sort_levels });
  } finally {
    client.release();
  }
});

// PUT /api/export-templates/:id
router.put("/:id", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid template ID" }); return; }
  const { name, fieldKeys, sortLevels } = req.body;
  if (!name || !Array.isArray(fieldKeys) || fieldKeys.length === 0) {
    res.status(400).json({ error: "Name and at least one field are required" });
    return;
  }
  const pool = getPool();
  if (!pool) { res.status(500).json({ error: "Database unavailable" }); return; }
  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE export_templates SET name = $1, field_keys = $2, sort_levels = $3, updated_at = NOW()
       WHERE id = $4 AND user_id = $5 RETURNING id, name, field_keys, sort_levels`,
      [name, JSON.stringify(fieldKeys), JSON.stringify(sortLevels || []), id, req.user.userId]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: "Template not found" }); return; }
    const r = result.rows[0];
    res.json({ id: r.id, name: r.name, fieldKeys: r.field_keys, sortLevels: r.sort_levels });
  } finally {
    client.release();
  }
});

// DELETE /api/export-templates/:id
router.delete("/:id", async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid template ID" }); return; }
  const pool = getPool();
  if (!pool) { res.status(500).json({ error: "Database unavailable" }); return; }
  const client = await pool.connect();
  try {
    const result = await client.query(
      "DELETE FROM export_templates WHERE id = $1 AND user_id = $2",
      [id, req.user.userId]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: "Template not found" }); return; }
    res.json({ success: true });
  } finally {
    client.release();
  }
});

export default router;
