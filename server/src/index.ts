import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import app from "./app";
import { config } from "./config/env";
import { testConnection } from "./db/pool";
import { stopPoolMonitor } from "./db/pool";
import { startScheduler } from "./services/schedulerService";
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
      ? (config.corsOrigin || true)
      : "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

io.on("connection", (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  socket.on("join", (userId: number) => {
    const room = `user:${userId}`;
    socket.join(room);
    console.log(`🔌 Socket ${socket.id} joined room ${room}`);
  });

  socket.on("disconnect", () => {
    console.log(`🔌 Socket disconnected: ${socket.id}`);
  });
});

// Pass Socket.io instance to notification service for real-time push
setSocketServer(io);

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
