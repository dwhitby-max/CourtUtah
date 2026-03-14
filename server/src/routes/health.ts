import { Router, Request, Response } from "express";
import { getPool, testConnection, getPoolStats } from "../db/pool";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  let dbStatus = "unknown";
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
