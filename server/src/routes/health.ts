import { Router, Request, Response } from "express";
import { getPool, testConnection, getPoolStats } from "../db/pool";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  let dbStatus = "disconnected";
  const pool = getPool();

  if (pool) {
    try {
      const connected = await testConnection();
      dbStatus = connected ? "connected" : "disconnected";
    } catch {
      dbStatus = "error";
    }
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
