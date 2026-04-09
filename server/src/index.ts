import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import jwt from "jsonwebtoken";
import app from "./app";
import { verifyToken } from "./middleware/auth";
import { config } from "./config/env";
import { testConnection, getPool } from "./db/pool";
import { stopPoolMonitor } from "./db/pool";
import { startScheduler } from "./services/schedulerService";
import { cleanupOrphanedCalendarEntries } from "./services/calendarSync";
import { setSocketServer } from "./services/notificationService";
import { initSentry, flushSentry } from "./services/sentryService";
import type { ServerToClientEvents, ClientToServerEvents } from "@shared/types";

// Initialize Sentry early (lazy — noop if SENTRY_DSN not set, Rule 17.5)
initSentry();

// Startup environment validation
console.log("🔧 Environment check:");
console.log(`   NODE_ENV: ${config.nodeEnv}`);
console.log(`   PORT: ${config.port}`);
console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? "OK" : "MISSING"}`);
console.log(`   JWT_SECRET: ${config.jwtSecret ? "OK" : "MISSING"}`);
console.log(`   ENCRYPTION_KEY: ${process.env.ENCRYPTION_KEY ? "OK" : "MISSING"}`);
console.log(`   GOOGLE_CLIENT_ID: ${config.google.clientId ? "OK" : "MISSING"}`);
console.log(`   GOOGLE_CLIENT_SECRET: ${config.google.clientSecret ? "OK" : "MISSING"}`);
console.log(`   GOOGLE_REDIRECT_URI: ${config.google.redirectUri || "MISSING"}`);
console.log(`   CWD: ${process.cwd()}`);

const server = createServer(app);

// Socket.io server — shares the same HTTP server (Rule 15: single port)
const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(server, {
  path: "/socket.io",
  cors: {
    origin: config.nodeEnv === "production"
      ? (config.corsOrigin || false)
      : "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// Authenticate Socket.IO connections via JWT in handshake
io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    return next(new Error("Authentication required"));
  }
  try {
    const payload = verifyToken(token);
    socket.data.user = payload;
    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
});

io.on("connection", (socket) => {
  const userId = socket.data.user?.userId;
  console.log(`🔌 Socket connected: ${socket.id} (user:${userId})`);

  // Auto-join the authenticated user's room
  if (userId) {
    const room = `user:${userId}`;
    socket.join(room);
  }

  socket.on("disconnect", () => {
    console.log(`🔌 Socket disconnected: ${socket.id}`);
  });
});

// Pass Socket.io instance to notification service for real-time push
setSocketServer(io);

/**
 * ONE-TIME: Re-trigger all saved searches for a user with force_refresh.
 * Bypasses same-day cache. Runs searches sequentially to avoid overloading.
 * Safe to remove after the first successful deployment.
 */
async function triggerSearchesForUser(email: string): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  // Wait for the server to be ready to accept requests
  await new Promise((r) => setTimeout(r, 3000));

  const client = await pool.connect();
  try {
    const userResult = await client.query(
      "SELECT id, email FROM users WHERE email = $1",
      [email]
    );
    if (userResult.rows.length === 0) {
      console.log(`⏭️ One-time trigger: user ${email} not found, skipping`);
      return;
    }
    const { id: userId } = userResult.rows[0];

    const searchResult = await client.query(
      `SELECT id, label, search_params FROM watched_cases
       WHERE user_id = $1 AND source = 'auto_search' AND is_active = true
       ORDER BY last_refreshed_at DESC NULLS LAST`,
      [userId]
    );

    if (searchResult.rows.length === 0) {
      console.log(`⏭️ One-time trigger: no saved searches for ${email}`);
      return;
    }

    console.log(`🔄 One-time trigger: re-running ${searchResult.rows.length} saved searches for ${email}`);

    // Build a short-lived token for this user
    const token = jwt.sign({ userId, email }, config.jwtSecret, { expiresIn: "10m" });

    const queryMap: Record<string, string> = {
      defendantName: "defendant_name", caseNumber: "case_number",
      courtName: "court_name", courtNames: "court_names", allCourts: "all_courts",
      courtDate: "court_date", dateFrom: "date_from", dateTo: "date_to",
      defendantOtn: "defendant_otn", citationNumber: "citation_number",
      charges: "charges", judgeName: "judge_name", attorney: "attorney",
    };

    for (const row of searchResult.rows) {
      const params = typeof row.search_params === "string" ? JSON.parse(row.search_params) : row.search_params;
      if (!params) continue;

      const queryParams: Record<string, string> = { force_refresh: "true" };
      for (const [jsonKey, queryKey] of Object.entries(queryMap)) {
        if (params[jsonKey]) queryParams[queryKey] = params[jsonKey];
      }

      const qs = new URLSearchParams(queryParams).toString();
      const url = `http://${config.host}:${config.port}/api/search?${qs}`;

      try {
        console.log(`  🔍 Triggering search #${row.id}: ${row.label}`);
        const res = await fetch(url, {
          headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
        });
        const data = await res.json();
        if (res.ok) {
          console.log(`  ✅ Search #${row.id} complete: ${data.resultsCount} results`);
        } else {
          console.warn(`  ⚠️ Search #${row.id} failed: ${data.error || res.status}`);
        }
      } catch (err) {
        console.warn(`  ⚠️ Search #${row.id} error:`, err instanceof Error ? err.message : err);
      }

      // Small delay between searches to avoid overloading
      await new Promise((r) => setTimeout(r, 2000));
    }

    console.log(`✅ One-time trigger complete for ${email}`);
  } finally {
    client.release();
  }
}

// Listen FIRST — before any async work (Rule 17.1)
server.listen(config.port, config.host, () => {
  console.log(`✅ Server listening on ${config.host}:${config.port}`);
  console.log(`   Environment: ${config.nodeEnv}`);
});

// THEN async initialization (non-fatal)
(async () => {
  try {
    const dbConnected = await testConnection();
    if (dbConnected) {
      console.log("✅ Database connected");

      // Clean up orphaned calendar entries from dedup migration 037
      cleanupOrphanedCalendarEntries().catch(err =>
        console.warn("⚠️  Orphan calendar cleanup failed:", err)
      );

      // ONE-TIME: Re-trigger all saved searches for dwhitby@gmail.com after
      // parser/enrichment fixes deployed 2026-04-09. Safe to remove after first run.
      triggerSearchesForUser("dwhitby@gmail.com").catch(err =>
        console.warn("⚠️  One-time search trigger failed:", err)
      );
    } else {
      console.warn("⚠️  Database connection failed — DB features unavailable");
    }
  } catch (err) {
    console.error("❌ Database connection error:", err);
  }

  try {
    startScheduler();
    console.log("✅ Scheduler started");
  } catch (err) {
    console.error("Scheduler failed to start:", err);
  }
})();

// Graceful shutdown — close Socket.io, HTTP server, and DB pool on SIGTERM/SIGINT
function gracefulShutdown(signal: string): void {
  console.log(`\n⚠️  Received ${signal} — shutting down gracefully`);

  stopPoolMonitor();

  // Flush pending Sentry events before exit
  flushSentry(2000).catch(() => {});

  io.close(() => {
    console.log("✅ Socket.io server closed");
  });

  server.close(() => {
    console.log("✅ HTTP server closed");
    process.exit(0);
  });

  // Force exit after 10 seconds if connections hang
  setTimeout(() => {
    console.error("❌ Forced shutdown after 10s timeout");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Global error handlers — prevent silent crashes
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
});

export default server;
