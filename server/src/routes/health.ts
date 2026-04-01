import { Router, Request, Response } from "express";
import { getPool, testConnection, getPoolStats } from "../db/pool";
import dns from "dns";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  let dbStatus = "unknown";
  let dbDiag: Record<string, unknown> = {};
  const pool = getPool();

  if (pool) {
    // Race the DB check against a 3s timeout so we never exceed Replit's 5s health-check deadline
    try {
      const connected = await Promise.race([
        testConnection(),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error("db check timeout")), 3000)
        ),
      ]);
      dbStatus = connected ? "connected" : "disconnected";
    } catch {
      dbStatus = "timeout";
    }

    // Diagnostic: resolve DB host IP and count users
    try {
      const dbUrl = process.env.DATABASE_URL || "";
      const hostMatch = dbUrl.match(/@([^:/]+)/);
      const dbHost = hostMatch ? hostMatch[1] : "unknown";
      const resolvedIp = await new Promise<string>((resolve) => {
        dns.lookup(dbHost, (err, addr) => resolve(err ? `error: ${err.message}` : addr));
      });
      const client = await pool.connect();
      try {
        const serverAddr = await client.query("SELECT inet_server_addr() as ip, inet_server_port() as port");
        const userCount = await client.query("SELECT count(*) as count FROM users");
        dbDiag = {
          host: dbHost,
          resolvedIp,
          serverAddr: serverAddr.rows[0]?.ip,
          serverPort: serverAddr.rows[0]?.port,
          userCount: parseInt(userCount.rows[0]?.count || "0", 10),
          dbUrl: dbUrl.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@"),
        };
      } finally {
        client.release();
      }
    } catch (diagErr) {
      dbDiag = { error: diagErr instanceof Error ? diagErr.message : String(diagErr) };
    }
  } else {
    dbStatus = "no_pool";
  }

  const poolStats = getPoolStats();

  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    port: process.env.PORT,
    database: dbStatus,
    dbDiag,
    pool: poolStats
      ? {
          total: poolStats.totalCount,
          idle: poolStats.idleCount,
          waiting: poolStats.waitingCount,
          max: poolStats.maxConnections,
          utilizationPct: poolStats.utilizationPct,
        }
      : null,
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
  });
});

export default router;
