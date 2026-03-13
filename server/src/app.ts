import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import healthRouter from "./routes/health";
import apiRouter from "./routes/index";
import { globalLimiter } from "./middleware/rateLimiter";
import { errorHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";
import { config } from "./config/env";

const app = express();

app.set("trust proxy", 1);

// 1. Health checks FIRST (before middleware) — Rule 17.2
app.use("/health", healthRouter);
app.use("/api/status", healthRouter);

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 5. Rate limiting
app.use(globalLimiter);

// 6. API routes (BEFORE static files) — Rule 17.2
app.use("/api", apiRouter);

// 7. Static files (client build) — Rule 17.7 use process.cwd()
app.use(express.static(path.join(process.cwd(), "client", "build")));

// 8. SPA fallback (LAST) — Rule 17.2
app.get("*", (_req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.sendFile(path.join(process.cwd(), "client", "build", "index.html"));
});

// 9. Error handler
app.use(errorHandler);

export default app;
