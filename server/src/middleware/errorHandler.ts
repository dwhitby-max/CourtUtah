import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { config } from "../config/env";
import { captureException } from "../services/sentryService";

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const correlationId = req.correlationId || crypto.randomUUID();

  console.error(`❌ [${correlationId}]`, err.stack || err.message);

  // Report to Sentry with correlation ID
  captureException(err, {
    correlationId,
    tags: {
      method: req.method,
      path: req.path,
    },
    extra: {
      queryKeys: Object.keys(req.query),
      statusCode: 500,
    },
  });

  if (config.nodeEnv === "production") {
    res.status(500).json({
      error: "An unexpected error occurred",
      correlationId,
    });
  } else {
    res.status(500).json({
      error: err.message,
      correlationId,
    });
  }
}
