import { Pool } from "pg";
import fs from "fs";
import path from "path";

async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn("⚠️  DATABASE_URL not set — skipping migrations");
    return;
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });

  const migrationsDir = path.join(process.cwd(), "server", "migrations");

  console.log("🔄 Running migrations from:", migrationsDir);

  const client = await pool.connect();
  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) PRIMARY KEY,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Get already-executed migrations
    const executed = await client.query("SELECT filename FROM schema_migrations ORDER BY filename");
    const executedSet = new Set(executed.rows.map((r: { filename: string }) => r.filename));

    // Read migration files
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (executedSet.has(file)) {
        console.log(`⏭️  Skipping already-executed: ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      console.log(`▶️  Running: ${file}`);

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`✅ Completed: ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`❌ Failed: ${file}`, err);
        throw err;
      }
    }

    console.log("✅ All migrations completed");
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error("⚠️  Migration runner failed (non-fatal):", err.message || err);
  // Don't exit with error — let the server start anyway
});
