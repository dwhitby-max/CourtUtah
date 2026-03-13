import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const correlationId = crypto.randomUUID();
  req.correlationId = correlationId;
  res.setHeader("X-Correlation-Id", correlationId);

  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const logLine = `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms [${correlationId}]`;

    if (res.statusCode >= 500) {
      console.error(`❌ ${logLine}`);
    } else if (res.statusCode >= 400) {
      console.warn(`⚠️  ${logLine}`);
    } else {
      console.log(`✅ ${logLine}`);
    }
  });

  next();
}
