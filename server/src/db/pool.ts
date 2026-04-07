import { Pool, QueryResult } from "pg";
import { config } from "../config/env";

let pool: Pool | null = null;
let monitorInterval: ReturnType<typeof setInterval> | null = null;

/** Snapshot of pool usage for monitoring and health checks */
export interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  maxConnections: number;
  utilizationPct: number;
  collectedAt: string;
}

/** Threshold above which a warning is logged (% of max connections in use) */
const POOL_WARN_THRESHOLD_PCT = 80;
/** How often to log pool stats (ms) — every 5 minutes */
const POOL_MONITOR_INTERVAL_MS = 5 * 60 * 1000;

export function getPool(): Pool | null {
  if (!config.databaseUrl) {
    console.warn("⚠️  DATABASE_URL not set — database features unavailable");
    return null;
  }

  if (!pool) {
    // Respect the sslmode in DATABASE_URL. Replit's local PostgreSQL uses sslmode=disable.
    let dbUrl = config.databaseUrl;
    const sslDisabled = dbUrl.includes("sslmode=disable");

    // Silence pg v9 deprecation warning about sslmode semantics
    if (!sslDisabled && !dbUrl.includes("uselibpqcompat")) {
      const sep = dbUrl.includes("?") ? "&" : "?";
      dbUrl += `${sep}uselibpqcompat=true`;
    }

    pool = new Pool({
      connectionString: dbUrl,
      ssl: sslDisabled ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000,
    });

    pool.on("error", (err) => {
      console.error("❌ Unexpected PostgreSQL pool error:", err.message);
    });

    pool.on("connect", () => {
      console.log("✅ Database pool client connected");
    });

    // Start periodic pool monitoring
    startPoolMonitor();
  }

  return pool;
}

/**
 * Get current pool statistics. Returns null if pool is not initialized.
 */
export function getPoolStats(): PoolStats | null {
  if (!pool) return null;

  const total = pool.totalCount;
  const idle = pool.idleCount;
  const waiting = pool.waitingCount;
  const max = 5; // matches pool config max
  const activeCount = total - idle;
  const utilizationPct = max > 0 ? Math.round((activeCount / max) * 100) : 0;

  return {
    totalCount: total,
    idleCount: idle,
    waitingCount: waiting,
    maxConnections: max,
    utilizationPct,
    collectedAt: new Date().toISOString(),
  };
}

/**
 * Start periodic pool stats logging. Warns when utilization is high
 * or when clients are waiting for a connection.
 */
function startPoolMonitor(): void {
  if (monitorInterval) return;

  monitorInterval = setInterval(() => {
    const stats = getPoolStats();
    if (!stats) return;

    const logData = {
      total: stats.totalCount,
      idle: stats.idleCount,
      waiting: stats.waitingCount,
      utilization: `${stats.utilizationPct}%`,
    };

    if (stats.waitingCount > 0) {
      console.warn("⚠️  Pool: clients waiting for connection", JSON.stringify(logData));
    } else if (stats.utilizationPct >= POOL_WARN_THRESHOLD_PCT) {
      console.warn(`⚠️  Pool utilization at ${stats.utilizationPct}%`, JSON.stringify(logData));
    } else {
      console.log("📊 Pool stats:", JSON.stringify(logData));
    }
  }, POOL_MONITOR_INTERVAL_MS);

  // Don't block process exit
  monitorInterval.unref();
}

/**
 * Stop pool monitoring — used in graceful shutdown and tests.
 */
export function stopPoolMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

export async function testConnection(): Promise<boolean> {
  const p = getPool();
  if (!p) return false;

  const client = await p.connect();
  try {
    await client.query("SELECT 1");
    return true;
  } catch (err) {
    console.error("❌ Database connection test failed:", err);
    return false;
  } finally {
    client.release();
  }
}

export async function query(text: string, params?: unknown[]): Promise<QueryResult> {
  const p = getPool();
  if (!p) {
    throw new Error("Database pool not available");
  }

  const client = await p.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}
