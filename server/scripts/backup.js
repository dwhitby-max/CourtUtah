#!/usr/bin/env node

/**
 * Database Backup Script
 *
 * Exports the full PostgreSQL schema and all table data as JSON files,
 * commits to an orphan `backups` branch, and pushes to GitHub.
 *
 * Usage:
 *   node server/scripts/backup.js              # full backup + git push
 *   node server/scripts/backup.js --local      # local only, no git push
 */

const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL environment variable is required");
  process.exit(1);
}

const LOCAL_ONLY = process.argv.includes("--local");
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const BACKUPS_DIR = path.join(PROJECT_ROOT, "backups");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const BACKUP_PATH = path.join(BACKUPS_DIR, TIMESTAMP);
const LATEST_PATH = path.join(BACKUPS_DIR, "latest");

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

function createPool() {
  const sslDisabled = DATABASE_URL.includes("sslmode=disable");
  return new Pool({
    connectionString: DATABASE_URL,
    ssl: sslDisabled ? false : { rejectUnauthorized: false },
    max: 2,
    connectionTimeoutMillis: 10000,
  });
}

async function getTableNames(pool) {
  const res = await pool.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  return res.rows.map((r) => r.tablename);
}

async function getSchema(pool) {
  const res = await pool.query(`
    SELECT
      t.table_name,
      c.column_name,
      c.data_type,
      c.column_default,
      c.is_nullable,
      c.character_maximum_length
    FROM information_schema.tables t
    JOIN information_schema.columns c
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name, c.ordinal_position
  `);

  // Also grab indexes
  const indexes = await pool.query(`
    SELECT
      tablename,
      indexname,
      indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `);

  return { columns: res.rows, indexes: indexes.rows };
}

async function exportTable(pool, tableName) {
  const res = await pool.query(`SELECT * FROM "${tableName}"`);
  return res.rows;
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function copyDir(src, dest) {
  ensureDir(dest);
  if (!fs.existsSync(src)) return;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function rmDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function git(cmd) {
  return execSync(`git ${cmd}`, {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function getCurrentBranch() {
  return git("rev-parse --abbrev-ref HEAD");
}

function branchExists(name) {
  try {
    git(`rev-parse --verify ${name}`);
    return true;
  } catch {
    return false;
  }
}

function pushBackupBranch() {
  // Determine remote — prefer 'origin', fall back to first available
  let remote = "origin";
  try {
    const remotes = git("remote").split("\n").filter(Boolean);
    if (!remotes.includes("origin") && remotes.length > 0) {
      remote = remotes[0];
    }
  } catch {
    // no remotes — skip push
    console.warn("⚠️  No git remote found — skipping push");
    return;
  }

  console.log(`📤 Pushing backups branch to ${remote}...`);
  git(`push ${remote} backups --force`);
  console.log("✅ Pushed to remote");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("🗄️  Starting database backup...");
  console.log(`   Timestamp : ${TIMESTAMP}`);
  console.log(`   Local only: ${LOCAL_ONLY}`);
  console.log("");

  const pool = createPool();

  try {
    // 1. Test connection
    await pool.query("SELECT 1");
    console.log("✅ Database connected");

    // 2. Export schema
    console.log("📋 Exporting schema...");
    const schema = await getSchema(pool);
    ensureDir(BACKUP_PATH);
    writeJSON(path.join(BACKUP_PATH, "schema.json"), schema);
    console.log(
      `   ${schema.columns.length} columns, ${schema.indexes.length} indexes`
    );

    // 3. Export all tables
    const tables = await getTableNames(pool);
    console.log(`📦 Exporting ${tables.length} tables...`);

    const manifest = {
      timestamp: TIMESTAMP,
      createdAt: new Date().toISOString(),
      tables: {},
      totalRows: 0,
    };

    for (const table of tables) {
      const rows = await exportTable(pool, table);
      writeJSON(path.join(BACKUP_PATH, `${table}.json`), rows);
      manifest.tables[table] = { rowCount: rows.length };
      manifest.totalRows += rows.length;
      console.log(`   ✅ ${table}: ${rows.length} rows`);
    }

    // 4. Write manifest
    writeJSON(path.join(BACKUP_PATH, "manifest.json"), manifest);
    console.log(
      `\n📊 Manifest: ${tables.length} tables, ${manifest.totalRows} total rows`
    );

    // 5. Copy to latest/
    rmDir(LATEST_PATH);
    copyDir(BACKUP_PATH, LATEST_PATH);
    console.log("📁 Copied to backups/latest/");

    // 6. Git operations (unless --local)
    if (!LOCAL_ONLY) {
      const originalBranch = getCurrentBranch();
      console.log(`\n🔀 Current branch: ${originalBranch}`);

      try {
        // Stash any uncommitted changes on current branch
        let stashed = false;
        try {
          const status = git("status --porcelain");
          if (status) {
            git("stash push -m backup-script-autostash");
            stashed = true;
          }
        } catch {
          // ignore
        }

        // Switch to orphan backups branch
        if (branchExists("backups")) {
          git("checkout backups");
        } else {
          git("checkout --orphan backups");
          // Remove all tracked files from index on new orphan branch
          git("rm -rf --cached .");
          // Clean the working tree of old files (but keep backups/)
          try {
            git("clean -fd -e backups");
          } catch {
            // ignore clean errors
          }
        }

        // Stage backup files
        git(`add "${BACKUP_PATH}" "${LATEST_PATH}"`);
        git(
          `commit -m "Backup ${TIMESTAMP}" --author="Backup Script <backup@utcourtcalendar.app>"`
        );

        // Push
        pushBackupBranch();

        // Return to original branch
        git(`checkout ${originalBranch}`);

        // Restore stash if needed
        if (stashed) {
          try {
            git("stash pop");
          } catch {
            console.warn(
              "⚠️  Could not restore stash — check `git stash list`"
            );
          }
        }

        console.log(`\n✅ Backup committed to 'backups' branch and pushed`);
      } catch (err) {
        // Always try to get back to the original branch
        try {
          git(`checkout ${originalBranch}`);
        } catch {
          // ignore
        }
        throw err;
      }
    } else {
      console.log(`\n✅ Local backup saved to ${BACKUP_PATH}`);
    }

    console.log("🎉 Backup complete!");
  } catch (err) {
    console.error("❌ Backup failed:", err.message || err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
