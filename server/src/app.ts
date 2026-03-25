import "express-async-errors";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import healthRouter from "./routes/health";
import apiRouter from "./routes/index";
import { globalLimiter } from "./middleware/rateLimiter";
import { errorHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";
import { config } from "./config/env";

const app = express();

app.set("trust proxy", 1);

// Resolve client build directory — try multiple __dirname-based strategies:
// Compiled JS location: server/dist/server/src/app.js
// Strategy 1: dist/server/src → ../../../../client/build (monorepo standard)
// Strategy 2: dist/server/src → ../../../client/build (flat dist)
function resolveClientBuild(): string {
  const candidates = [
    path.resolve(__dirname, "..", "..", "..", "..", "client", "build"),
    path.resolve(__dirname, "..", "..", "..", "client", "build"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) {
      console.log(`📁 Client build found at: ${dir}`);
      return dir;
    }
  }
  console.warn(`⚠️  Client build not found in any candidate path. Tried: ${candidates.join(", ")}`);
  return candidates[0]; // fallback
}

const CLIENT_BUILD = resolveClientBuild();

// 1. Health checks FIRST (before ALL middleware) — must respond within 5s for Replit autoscale
app.use("/health", healthRouter);
app.use("/api/status", healthRouter);
app.get("/__replit_health", (_req, res) => res.status(200).json({ status: "ok" }));

// 2. Request logging (correlation IDs on all requests)
app.use(requestLogger);

// 3. Security middleware
app.use(helmet({ contentSecurityPolicy: false }));

// CORS: in production, restrict to CORS_ORIGIN or same-origin (false).
// In development, allow all origins for Vite proxy.
const corsOrigin = config.nodeEnv === "production"
  ? (config.corsOrigin || false)
  : "*";
app.use(cors({ origin: corsOrigin }));

// 4. Body parsers
// Stripe webhook needs raw body for signature verification — must be before express.json()
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 5. Rate limiting
app.use(globalLimiter);

// 6. API routes (BEFORE static files)
app.use("/api", apiRouter);

// 7. Static files (client build)
app.use(express.static(CLIENT_BUILD));

// 8. SPA fallback (LAST)
const indexHtml = path.join(CLIENT_BUILD, "index.html");
app.get("*", (_req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.sendFile(indexHtml, (err) => {
    if (err) {
      console.error("❌ Failed to serve index.html:", err.message);
      res.status(500).send("Application is starting up. Please refresh in a moment.");
    }
  });
});

// 9. Error handler
app.use(errorHandler);

export default app;
